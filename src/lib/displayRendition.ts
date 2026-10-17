import sharp from "sharp";
import path from "path";
import fs from "fs";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Photo } from "@/types";
import {
  getObjectRange,
  getObjectStream,
  getThumbnailBucketName,
  getThumbnailS3Client,
} from "./s3";
import { getThumbnailsPath, normalizeThumbnailS3Prefix } from "./thumbnails";
import { orientJpeg } from "./imageProbe";
import { extractLargestEmbeddedJpeg, isRawKey } from "./rawPreview";
import { getConfig } from "./config";
import type { QuarterTurn } from "./rotation";
import { prop } from "./narrow";
import { logger } from "./logger";

/**
 * The viewer shows a screen-sized copy of each photo (2048 px on the long
 * side, ~400 KB) instead of the 4–20 MB original. It is made once, on the
 * first request, and kept in the thumbnail storage under its own prefix, so
 * every later view is one small read. The original is only fetched by the
 * browser to zoom past these pixels or to download.
 */

const EDGE = 2048;
const QUALITY = 82;
/** Part of the storage key: bump it and every rendition is made again. */
const VERSION = 1;
/** Each render holds an original (up to tens of MB) and its decoded pixels. */
const MAX_RENDERS = 3;

/** Same as the thumbnail objects; the route answers browsers with its own */
const STORED_CACHE_CONTROL = "public, max-age=31536000, immutable";

type RenditionPhoto = Pick<Photo, "id" | "s3_key" | "mime_type">;

export type DisplayResult =
  | { buffer: Buffer }
  | { error: string; status: 404 | 415 };

/** What sharp in this build can decode; RAW files go through their embedded JPEG instead. */
function decodable(mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  if (
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/tiff",
    ].includes(type)
  ) {
    return true;
  }
  // Prebuilt sharp reads AVIF only: HEIC needs a libvips built with HEVC
  if (type === "image/heic" || type === "image/heif") {
    return sharp.format.heif.input.fileSuffix?.includes(".heic") ?? false;
  }
  return false;
}

class UnsupportedSource extends Error {}

/** Next to the thumbnail prefix: "thumbnails" → "display", "a/thumbnails" → "a/display" */
function storagePrefix(): string {
  const thumbnails = normalizeThumbnailS3Prefix(
    getConfig().thumbnail_s3_prefix,
  );
  const parent = path.posix.dirname(thumbnails);
  return parent === "." ? "display" : path.posix.join(parent, "display");
}

/**
 * Mirrors the thumbnail layout (folder of the original, then name-id). A hand
 * rotation is its own file: turning a photo never serves a stale rendition,
 * and turning it back finds the old one.
 */
function storageKey(photo: RenditionPhoto, rotation: QuarterTurn): string {
  const id = String(photo.id);
  const name = `${id}-v${VERSION}${rotation ? `-r${rotation}` : ""}.jpg`;
  if (getConfig().thumbnail_storage !== "s3") {
    return path.join(getThumbnailsPath(), "display", name);
  }
  const original = photo.s3_key.replace(/^\/+/, "");
  const dir = path.posix.dirname(original);
  const base = path.posix.basename(original, path.posix.extname(original));
  return path.posix.join(
    storagePrefix(),
    dir === "." ? "" : dir,
    `${base}-${name}`,
  );
}

/**
 * EXIF orientations as sharp applies them (see orientJpeg): mirror first,
 * then turn clockwise. Index = orientation - 1.
 */
const ORIENTATIONS = [
  { mirror: false, turn: 0 },
  { mirror: true, turn: 0 },
  { mirror: false, turn: 180 },
  { mirror: true, turn: 180 },
  { mirror: true, turn: 270 },
  { mirror: false, turn: 90 },
  { mirror: true, turn: 90 },
  { mirror: false, turn: 270 },
] as const;

/** The single orientation that does the EXIF one, then the hand rotation on top. */
function withHandRotation(
  orientation: number | undefined,
  rotation: QuarterTurn,
): number {
  const exif = ORIENTATIONS[(orientation ?? 1) - 1] ?? ORIENTATIONS[0];
  const turn = (exif.turn + rotation) % 360;
  const combined = ORIENTATIONS.findIndex(
    (o) => o.mirror === exif.mirror && o.turn === turn,
  );
  return combined + 1;
}

function isNotFound(error: unknown): boolean {
  const name = prop(error, "name");
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    prop(prop(error, "$metadata"), "httpStatusCode") === 404
  );
}

async function readStored(key: string): Promise<Buffer | undefined> {
  if (getConfig().thumbnail_storage !== "s3") {
    try {
      return await fs.promises.readFile(key);
    } catch (error) {
      if (prop(error, "code") === "ENOENT") return undefined;
      throw error;
    }
  }
  try {
    const response = await getThumbnailS3Client().send(
      new GetObjectCommand({ Bucket: getThumbnailBucketName(), Key: key }),
    );
    return response.Body
      ? Buffer.from(await response.Body.transformToByteArray())
      : undefined;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function store(key: string, buffer: Buffer): Promise<void> {
  if (getConfig().thumbnail_storage !== "s3") {
    await fs.promises.mkdir(path.dirname(key), { recursive: true });
    await fs.promises.writeFile(key, buffer);
    return;
  }
  await getThumbnailS3Client().send(
    new PutObjectCommand({
      Bucket: getThumbnailBucketName(),
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: STORED_CACHE_CONTROL,
    }),
  );
  logger.debug(`[DISPLAY] Stored ${key} (${buffer.length} bytes)`);
}

async function render(
  photo: RenditionPhoto,
  rotation: QuarterTurn,
  request?: Request,
): Promise<Buffer> {
  const bucket = getConfig().backblaze_bucket;

  if (isRawKey(photo.s3_key)) {
    const embedded = await extractLargestEmbeddedJpeg((start, end) =>
      getObjectRange(bucket, photo.s3_key, start, end, request),
    );
    if (!embedded) throw new UnsupportedSource("No embedded JPEG");
    // Resized before orientJpeg, which re-encodes at full size otherwise;
    // the square box fits the same whichever way the photo turns.
    const resized = await sharp(embedded.jpeg, { failOn: "error" })
      .resize(EDGE, EDGE, { fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 0 })
      .toBuffer();
    return orientJpeg(
      resized,
      withHandRotation(embedded.orientation, rotation),
    );
  }

  if (!decodable(photo.mime_type)) {
    throw new UnsupportedSource(`Not decodable: ${photo.mime_type}`);
  }
  const body = await getObjectStream(bucket, photo.s3_key, request);
  if (!body) throw new Error("Empty S3 response body");
  const original = Buffer.from(await body.transformToByteArray());
  try {
    const upright = sharp(original)
      .rotate()
      .resize(EDGE, EDGE, { fit: "inside", withoutEnlargement: true })
      // JPEG has no alpha: transparent areas become white, like the stage
      .flatten({ background: "#ffffff" });
    if (!rotation) {
      return await upright.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
    }
    // sharp ignores rotate(angle) after the EXIF rotate() of the same
    // pipeline: the hand rotation is a second pass, lossless in between.
    const pixels = await upright.png({ compressionLevel: 0 }).toBuffer();
    return await sharp(pixels)
      .rotate(rotation)
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    // Unknown format or broken file: the same answer every time, and a
    // browser may still show the original (a truncated JPEG, for one)
    if (
      error instanceof Error &&
      (error.message.includes("unsupported image format") ||
        error.message.includes("VipsJpeg:") ||
        error.message.includes("premature end of JPEG file") ||
        error.message.includes("JPEG datastream contains no image"))
    ) {
      throw new UnsupportedSource(error.message);
    }
    throw error;
  }
}

let active = 0;
const waiting: (() => void)[] = [];

async function withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active < MAX_RENDERS) active++;
  else
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  try {
    return await task();
  } finally {
    // Newest first: arrowing through an album queues the photos skipped
    // past, and the one on screen now is the last asked for. The slot passes
    // straight to it, so a request arriving meanwhile can't take it.
    const next = waiting.pop();
    if (next) next();
    else active--;
  }
}

/** Renders still running or not yet stored: a second request reuses the buffer. */
const inflight = new Map<string, Promise<Buffer>>();
/** Photos sharp can't read, so the original isn't downloaded again for nothing. */
const unsupported = new Set<string>();

function renderOnce(
  photo: RenditionPhoto,
  rotation: QuarterTurn,
  key: string,
  request?: Request,
): Promise<Buffer> {
  const running = inflight.get(key);
  if (running) return running;
  // Stored before answering: a serverless function may be frozen as soon as
  // its response is sent, and a write left running then never lands. Only
  // the first view of a photo pays for it. A failed write is logged and only
  // costs a render next time; render failures are the caller's to report.
  const rendered = withRenderSlot(() => render(photo, rotation, request)).then(
    async (buffer) => {
      try {
        await store(key, buffer);
      } catch (error) {
        logger.warn(
          "Display rendition not stored",
          { photoId: photo.id, key },
          error instanceof Error ? error : undefined,
        );
      }
      return buffer;
    },
  );
  inflight.set(key, rendered);
  void rendered
    .catch(() => undefined)
    .finally(() => {
      inflight.delete(key);
    });
  return rendered;
}

/**
 * `rotation` comes from the URL, not from the photo row: each URL is cached
 * as immutable, so it must always mean the same pixels, even when a request
 * crosses the write of a new rotation.
 */
export async function getDisplayRendition(
  photo: RenditionPhoto,
  rotation: QuarterTurn,
  request?: Request,
): Promise<DisplayResult> {
  if (photo.mime_type.toLowerCase().startsWith("video/")) {
    return { error: "not_applicable", status: 404 };
  }
  const key = storageKey(photo, rotation);
  if (unsupported.has(key)) {
    return { error: "unsupported_format", status: 415 };
  }

  try {
    const stored = await readStored(key);
    if (stored) return { buffer: stored };
  } catch (error) {
    // Storage unreadable: still worth rendering, the viewer is waiting
    logger.warn(
      "Display rendition unreadable",
      { photoId: photo.id, key },
      error instanceof Error ? error : undefined,
    );
  }

  try {
    return { buffer: await renderOnce(photo, rotation, key, request) };
  } catch (error) {
    if (error instanceof UnsupportedSource) {
      unsupported.add(key);
      logger.debug(`[DISPLAY] ${photo.s3_key}: ${error.message}`);
      return { error: "unsupported_format", status: 415 };
    }
    throw error;
  }
}

export function displayHeaders(
  buffer: Buffer,
  cacheControl: string,
): Record<string, string> {
  return {
    "Content-Type": "image/jpeg",
    "Content-Length": buffer.length.toString(),
    "Cache-Control": cacheControl,
  };
}
