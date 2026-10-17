import type { PhotoMetadata } from "@/types";
import { prop } from "./narrow";

/**
 * Reads what a photo says about itself from its first bytes: EXIF metadata
 * (date taken, dimensions, camera, GPS, orientation) and the JPEG thumbnail
 * cameras embed in APP1. 64 KB covers the APP1 segment of nearly every JPEG
 * (APP1 is capped at 64 KB by the spec, but an APP0 before it can push its
 * tail past the window, hence the 256 KB retry).
 */

export const HEAD_BYTES = 64 * 1024;
export const RETRY_BYTES = 256 * 1024;

export interface ImageHeadProbe {
  metadata?: PhotoMetadata;
  /** Embedded EXIF thumbnail, already rotated to display orientation, as JPEG */
  preview?: Buffer;
}

export interface ParsedImageHead {
  result: ImageHeadProbe;
  /** True when the buffer ends inside the EXIF segment or could not be parsed */
  needsMore: boolean;
}

/** Fetches up to `end + 1` bytes of the object; injected so scripts can bypass the app's S3 client */
export type RangeReader = (start: number, end: number) => Promise<Buffer>;

export async function probeImageHead(
  s3Key: string,
  options: { request?: Request } = {},
): Promise<ImageHeadProbe> {
  const [{ getObjectRange }, { getConfig }] = await Promise.all([
    import("./s3"),
    import("./config"),
  ]);
  const bucket = getConfig().backblaze_bucket;
  return probeWithReader((start, end) =>
    getObjectRange(bucket, s3Key, start, end, options.request),
  );
}

export async function probeWithReader(
  read: RangeReader,
): Promise<ImageHeadProbe> {
  const head = await read(0, HEAD_BYTES - 1);
  const first = await parseImageHead(head);
  // A buffer shorter than the window is the whole file: nothing more to read
  if (!first.needsMore || head.length < HEAD_BYTES) {
    return first.result;
  }
  const larger = await read(0, RETRY_BYTES - 1);
  const second = await parseImageHead(larger);
  return hasContent(second.result) || !hasContent(first.result)
    ? second.result
    : first.result;
}

export async function parseImageHead(buffer: Buffer): Promise<ParsedImageHead> {
  if (buffer.length === 0) {
    return { result: {}, needsMore: false };
  }

  const truncatedExif = isJpeg(buffer) && jpegExifSegmentTruncated(buffer);

  let tags: unknown;
  try {
    const ExifReader = await import("exifreader");
    tags = ExifReader.load(buffer, { expanded: true });
  } catch {
    return { result: {}, needsMore: true };
  }

  const orientation = readOrientation(tags);
  const metadata = buildMetadata(tags, orientation);
  const preview = await extractPreview(tags, orientation);

  return {
    result: {
      ...(metadata ? { metadata } : {}),
      ...(preview ? { preview } : {}),
    },
    needsMore: truncatedExif,
  };
}

export function hasContent(probe: ImageHeadProbe): boolean {
  return probe.metadata !== undefined || probe.preview !== undefined;
}

function buildMetadata(
  tags: unknown,
  orientation: number | undefined,
): PhotoMetadata | undefined {
  const metadata: PhotoMetadata = {};

  const exif = prop(tags, "exif");
  const dateTaken =
    parseExifDate(prop(exif, "DateTimeOriginal")) ??
    parseExifDate(prop(exif, "DateTimeDigitized")) ??
    parseExifDate(prop(exif, "DateTime"));
  if (dateTaken) metadata.date_taken = dateTaken;

  const dimensions = readDimensions(tags, orientation);
  if (dimensions) metadata.dimensions = dimensions;

  const make = cleanString(prop(exif, "Make"));
  const model = cleanString(prop(exif, "Model"));
  if (make !== undefined || model !== undefined) {
    metadata.camera = {
      ...(make ? { make } : {}),
      ...(model ? { model } : {}),
    };
  }

  const gps = prop(tags, "gps");
  const latitude = prop(gps, "Latitude");
  const longitude = prop(gps, "Longitude");
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  ) {
    metadata.location = { latitude, longitude };
  }

  if (orientation) metadata.orientation = orientation;

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * EXIF dates are wall-clock "YYYY:MM:DD HH:MM:SS" without a zone. They are kept
 * as wall clock and serialized with a Z suffix (format with timeZone "UTC").
 */
function parseExifDate(tag: unknown): string | undefined {
  const raw = cleanString(tag);
  if (!raw) return undefined;
  const match = raw.match(
    /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/,
  );
  if (!match) return undefined;
  const [
    year = NaN,
    month = NaN,
    day = NaN,
    hour = NaN,
    minute = NaN,
    second = NaN,
  ] = match.slice(1).map((part) => parseInt(part, 10));
  if (year < 1900 || year > new Date().getUTCFullYear() + 1) return undefined;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 60) return undefined;
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, Math.min(second, 59)),
  );
  // Rejects overflowing days such as Feb 31
  if (date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function readOrientation(tags: unknown): number | undefined {
  const value = prop(prop(prop(tags, "exif"), "Orientation"), "value");
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 8
    ? value
    : undefined;
}

function readDimensions(
  tags: unknown,
  orientation: number | undefined,
): PhotoMetadata["dimensions"] {
  // The SOF marker (file group) describes the pixels actually stored; EXIF
  // PixelX/YDimension can be stale after an edit, so it is only a fallback.
  const value = (group: string, field: string): unknown =>
    prop(prop(prop(tags, group), field), "value");
  const candidates: [unknown, unknown][] = [
    [value("file", "Image Width"), value("file", "Image Height")],
    [value("pngFile", "Image Width"), value("pngFile", "Image Height")],
    [value("exif", "PixelXDimension"), value("exif", "PixelYDimension")],
    [value("exif", "ImageWidth"), value("exif", "ImageLength")],
  ];
  for (const [w, h] of candidates) {
    const width = Number(w);
    const height = Number(h);
    if (
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0
    ) {
      return orientation && orientation >= 5
        ? { width: height, height: width }
        : { width, height };
    }
  }
  return undefined;
}

async function extractPreview(
  tags: unknown,
  orientation: number | undefined,
): Promise<Buffer | undefined> {
  const thumbnail = prop(tags, "Thumbnail");
  const image = prop(thumbnail, "image");
  if (!image || prop(thumbnail, "type") !== "image/jpeg") return undefined;
  // exifreader hands back a Buffer or an ArrayBuffer depending on the runtime
  const source = Buffer.isBuffer(image)
    ? image
    : image instanceof ArrayBuffer
      ? Buffer.from(image)
      : image instanceof Uint8Array
        ? Buffer.concat([image])
        : undefined;
  if (!source) return undefined;
  if (source.length < 128 || !isJpeg(source)) return undefined;

  try {
    return await orientJpeg(source, orientation);
  } catch {
    return undefined;
  }
}

/**
 * Applies an EXIF orientation to a JPEG that carries none of its own (the
 * embedded thumbnail inherits the IFD0 orientation of the photo).
 * sharp always mirrors before it rotates, which the mapping accounts for.
 */
export async function orientJpeg(
  source: Buffer,
  orientation: number | undefined,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(source, { failOn: "error" });
  switch (orientation) {
    case 2:
      pipeline = pipeline.flop();
      break;
    case 3:
      pipeline = pipeline.rotate(180);
      break;
    case 4:
      pipeline = pipeline.flip();
      break;
    case 5:
      pipeline = pipeline.flip().rotate(90);
      break;
    case 6:
      pipeline = pipeline.rotate(90);
      break;
    case 7:
      pipeline = pipeline.flop().rotate(90);
      break;
    case 8:
      pipeline = pipeline.rotate(270);
      break;
  }
  return pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

/** Walks the JPEG marker segments up to the EXIF APP1 and checks it fits in the buffer */
function jpegExifSegmentTruncated(buffer: Buffer): boolean {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    const marker = buffer[offset + 1] ?? 0;
    // Start of scan or SOF: the metadata segments are behind us
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (marker === 0xda || isStartOfFrame) {
      return false;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isExif =
      marker === 0xe1 &&
      offset + 10 <= buffer.length &&
      buffer.toString("latin1", offset + 4, offset + 10) === "Exif\0\0";
    if (isExif) {
      return offset + 2 + length > buffer.length;
    }
    offset += 2 + length;
  }
  // Ran out of bytes before reaching APP1 or the image data
  return true;
}

function cleanString(tag: unknown): string | undefined {
  const value = prop(tag, "description") ?? prop(tag, "value");
  const text = Array.isArray(value) ? value.join(" ") : value;
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/\0/g, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
