import type { RangeReader } from "./imageProbe";

/**
 * Camera RAW files (NEF, CR2, ARW, DNG, PEF…) are TIFF containers that carry
 * JPEG renditions of the photo next to the sensor data. Reading the IFDs from
 * the head of the file locates them, so a thumbnail costs one ~1 MB range read
 * instead of downloading a 30 MB original (from which sharp would only find
 * the 160×120 strip in IFD0).
 */

const RAW_EXTENSIONS = new Set([
  "nef",
  "nrw",
  "cr2",
  "arw",
  "srf",
  "sr2",
  "dng",
  "orf",
  "pef",
  "srw",
  "3fr",
  "erf",
  "kdc",
  "mrw",
  "iiq",
]);

export function isRawKey(key: string): boolean {
  return RAW_EXTENSIONS.has(key.toLowerCase().split(".").pop() ?? "");
}

/**
 * IFDs of NEF/CR2/ARW sit in the first ~240 KB, and a NEF's medium JPEG
 * (~1.1 MB) usually follows right after: reading 1.5 MB at once gets both in a
 * single round trip, which dominates the cost.
 */
const HEAD_BYTES = 1536 * 1024;
/** Smallest rendition worth using: below this it is the 160 px strip again. */
const MIN_JPEG_BYTES = 120 * 1024;
const MAX_JPEG_BYTES = 12 * 1024 * 1024;

export interface EmbeddedJpeg {
  jpeg: Buffer;
  /** Sensor size in stored orientation, from the largest IFD */
  width?: number;
  height?: number;
  /** IFD0 orientation (1-8): the embedded JPEG is stored unrotated */
  orientation?: number;
}

interface Candidate {
  offset: number;
  length: number;
}

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
  13: 4,
};

export function parseTiffHead(head: Buffer): {
  candidates: Candidate[];
  width?: number;
  height?: number;
  orientation?: number;
} {
  const order = head.toString("latin1", 0, 2);
  if (head.length < 8 || (order !== "II" && order !== "MM")) {
    return { candidates: [] };
  }
  const le = order === "II";
  const u16 = (o: number) => (le ? head.readUInt16LE(o) : head.readUInt16BE(o));
  const u32 = (o: number) => (le ? head.readUInt32LE(o) : head.readUInt32BE(o));

  const candidates: Candidate[] = [];
  let width: number | undefined;
  let height: number | undefined;
  let orientation: number | undefined;
  const seen = new Set<number>();

  // Reads a SHORT/LONG value or the first `max` items of an array
  const values = (
    type: number,
    count: number,
    entry: number,
    max = 16,
  ): number[] => {
    const size = (TYPE_SIZES[type] ?? 1) * count;
    const at = size <= 4 ? entry + 8 : u32(entry + 8);
    const out: number[] = [];
    for (let i = 0; i < Math.min(count, max); i++) {
      const o = at + i * (type === 3 ? 2 : 4);
      if (o + (type === 3 ? 2 : 4) > head.length) break;
      out.push(type === 3 ? u16(o) : u32(o));
    }
    return out;
  };

  const walk = (offset: number, isIfd0: boolean, depth: number) => {
    if (!offset || depth > 4 || seen.has(offset) || offset + 2 > head.length)
      return;
    seen.add(offset);
    const count = u16(offset);
    const tags = new Map<number, number[]>();
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > head.length) break;
      const type = u16(entry + 2);
      if (type !== 3 && type !== 4 && type !== 13) continue;
      tags.set(u16(entry), values(type, u32(entry + 4), entry));
    }
    const one = (tag: number) => tags.get(tag)?.[0];

    if (isIfd0 && one(0x0112)) orientation = one(0x0112);

    const w = one(0x0100);
    const h = one(0x0101);
    if (w && h && (!width || !height || w * h > width * height)) {
      width = w;
      height = h;
    }

    // JPEGInterchangeFormat / Length
    const jpegOffset = one(0x0201);
    const jpegLength = one(0x0202);
    if (jpegOffset && jpegLength)
      candidates.push({ offset: jpegOffset, length: jpegLength });

    // Old-style JPEG stored as a single strip (CR2 IFD0, some DNG previews)
    const compression = one(0x0103);
    const strips = tags.get(0x0111);
    const stripLengths = tags.get(0x0117);
    if (
      (compression === 6 || compression === 7) &&
      strips?.length === 1 &&
      stripLengths?.length === 1
    ) {
      candidates.push({ offset: strips[0], length: stripLengths[0] });
    }

    for (const sub of tags.get(0x014a) ?? []) walk(sub, false, depth + 1);
    const nextAt = offset + 2 + count * 12;
    if (nextAt + 4 <= head.length) walk(u32(nextAt), false, depth + 1);
  };

  walk(u32(4), true, 0);
  return { candidates, width, height, orientation };
}

/** Picks the smallest rendition that is still a real photo, not a strip. */
function pick(candidates: Candidate[]): Candidate | undefined {
  const usable = candidates
    .filter((c) => c.length <= MAX_JPEG_BYTES)
    .sort((a, b) => a.length - b.length);
  return (
    usable.find((c) => c.length >= MIN_JPEG_BYTES) ?? usable[usable.length - 1]
  );
}

export async function extractEmbeddedJpeg(
  read: RangeReader,
): Promise<EmbeddedJpeg | undefined> {
  const head = await read(0, HEAD_BYTES - 1);
  const { candidates, width, height, orientation } = parseTiffHead(head);
  const chosen = pick(candidates);
  if (!chosen) return undefined;

  const end = chosen.offset + chosen.length;
  const jpeg =
    end <= head.length
      ? head.subarray(chosen.offset, end)
      : await read(chosen.offset, end - 1);

  // SOI marker: anything else is not a JPEG we can decode
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return undefined;
  return { jpeg, width, height, orientation };
}
