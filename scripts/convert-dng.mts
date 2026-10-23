/**
 * One-off DNG export with Adobe's renderer and the saved Camera Raw settings.
 * Requires a frozen inventory.json / per-folder plan.json under --dir.
 * prepare is read-only remotely. convert / apply require --replace-originals.
 * Reuses convert-nef.mts's verified upload, same-ID update and version deletion.
 * One photo at a time bounds local working storage, and journals allow resuming.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "dotenv";
import {
  S3Client,
  GetObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { orientJpeg, parseImageHead } from "../src/lib/imageProbe";

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const action = args[0];
assert(["prepare", "convert", "apply"].includes(action ?? ""));
if (action !== "prepare") assert(args.includes("--replace-originals"));
const root = path.resolve(option("--dir") ?? "data/conversions/dng-20261021");
const converter = path.resolve(
  option("--converter") ??
    path.join(
      root,
      "tooling/DNGConverter/Adobe DNG Converter.app/Contents/MacOS/Adobe DNG Converter",
    ),
);
const env = {
  ...parse(await fs.readFile(".env")),
  ...parse(await fs.readFile(".env.local")),
};
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: env.BACKBLAZE_ENDPOINT,
  credentials: {
    accessKeyId: env.BACKBLAZE_ACCESS_KEY!,
    secretAccessKey: env.BACKBLAZE_SECRET_KEY!,
  },
});
interface Source {
  id: string;
  folder_id: number;
  path: string;
  filename: string;
  size: string;
  s3_key: string;
  etag: string;
  metadata: Record<string, unknown>;
}
const inventory = JSON.parse(
  await fs.readFile(path.join(root, "inventory.json"), "utf8"),
) as {
  bucket: string;
  sources: Source[];
};
const facesBefore = JSON.parse(
  await fs.readFile(path.join(root, "faces-before.json"), "utf8"),
) as { id: string; photo_id: string; box: number[]; landmarks: number[] }[];
assert.equal(inventory.bucket, env.BACKBLAZE_BUCKET);
const hash = (b: Buffer, algorithm = "sha256") =>
  crypto.createHash(algorithm).update(b).digest("hex");
const local = (source: Source, suffix: string) =>
  path.join(root, String(source.folder_id), source.id + "." + suffix);
async function save(file: string, data: unknown) {
  await fs.writeFile(file + ".tmp", JSON.stringify(data, null, 2), {
    mode: 0o600,
  });
  await fs.rename(file + ".tmp", file);
}
async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
async function state(source: Source) {
  const file = local(source, "json");
  return (await exists(file))
    ? JSON.parse(await fs.readFile(file, "utf8"))
    : undefined;
}
async function versions(key: string) {
  const found: {
    id: string;
    etag: string;
    latest: boolean;
    marker: boolean;
  }[] = [];
  let keyMarker: string | undefined, versionMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: inventory.bucket,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );
    for (const v of page.Versions ?? [])
      if (v.Key === key && v.VersionId)
        found.push({
          id: v.VersionId,
          etag: v.ETag?.replace(/"/g, "") ?? "",
          latest: !!v.IsLatest,
          marker: false,
        });
    for (const v of page.DeleteMarkers ?? [])
      if (v.Key === key && v.VersionId)
        found.push({
          id: v.VersionId,
          etag: "",
          latest: !!v.IsLatest,
          marker: true,
        });
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  return found;
}
type Metadata = Record<string, unknown>;
async function metadata(file: string): Promise<Metadata> {
  const { stdout } = await run(
    "exiftool",
    [
      "-json",
      "-G1",
      "-n",
      "-EXIF:all",
      "-XMP:all",
      "-IPTC:all",
      "-FileType",
      "-DNGVersion",
      "-DefaultCropSize",
      "-DefaultCropOrigin",
      "-Preview:all",
      "-PreviewApplicationName",
      "-PreviewApplicationVersion",
      "-PreviewSettingsDigest",
      "-PreviewColorSpace",
      file,
    ],
    { maxBuffer: 16 * 1024 ** 2 },
  );
  const [result] = JSON.parse(stdout);
  delete result.SourceFile;
  return result;
}
const fields = [
  "DateTimeOriginal",
  "CreateDate",
  "Make",
  "Model",
  "LensModel",
  "ISO",
  "ExposureTime",
  "FNumber",
  "FocalLength",
  "GPSLatitude",
  "GPSLongitude",
];
async function coreExif(file: string): Promise<Metadata> {
  const { stdout } = await run("exiftool", [
    "-json",
    "-n",
    ...fields.map((f) => "-" + f),
    "-Orientation",
    "-ColorSpace",
    file,
  ]);
  const [result] = JSON.parse(stdout);
  delete result.SourceFile;
  return result;
}
const pixelHash = async (jpeg: Buffer) =>
  hash(await sharp(jpeg, { failOn: "warning" }).raw().toBuffer());
function expectedDimensions(meta: Metadata) {
  const value = Object.entries(meta).find(([key]) =>
    key.endsWith(":DefaultCropSize"),
  )?.[1];
  assert(typeof value === "string", "Missing full sensor crop dimensions");
  const [w, h] = value.split(" ").map(Number);
  assert(w && h && w > 1000 && h > 1000);
  let x = 1,
    y = 1;
  if (meta["XMP-crs:HasCrop"] === true) {
    x = Number(meta["XMP-crs:CropRight"]) - Number(meta["XMP-crs:CropLeft"]);
    y = Number(meta["XMP-crs:CropBottom"]) - Number(meta["XMP-crs:CropTop"]);
    assert(x > 0 && x <= 1 && y > 0 && y <= 1, "Invalid saved crop");
  }
  const candidates = [[w * x, h * y]];
  if (Number(meta["IFD0:Orientation"]) >= 5) candidates.push([w * y, h * x]);
  // Older Camera Raw crops store opposite corners before straightening.
  const angle = (Number(meta["XMP-crs:CropAngle"] ?? 0) * Math.PI) / 180;
  if (angle) {
    for (const [width, height] of [...candidates]) {
      candidates.push([
        Math.abs(width! * Math.cos(angle) + height! * Math.sin(angle)),
        Math.abs(height! * Math.cos(angle) - width! * Math.sin(angle)),
      ]);
    }
  }
  return { sensor: [w, h], candidates };
}
async function faceGeometry(
  source: Source,
  before: Metadata,
  input: string,
  jpeg: Buffer,
) {
  const faces = facesBefore.filter((f) => f.photo_id === source.id);
  if (!faces.length) return null;
  const geometryChanged =
    before["XMP-crs:HasCrop"] === true ||
    [
      "PerspectiveVertical",
      "PerspectiveHorizontal",
      "PerspectiveRotate",
      "LensManualDistortionAmount",
    ].some((k) => Number(before["XMP-crs:" + k] ?? 0) !== 0);
  if (!geometryChanged)
    return {
      method: "No crop or geometric edit",
      matrix: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      faces: faces.map((f) => f.id),
    };
  const references = Object.keys(before)
    .filter((tag) => /:(JpgFromRaw|PreviewImage)$/.test(tag))
    .map((tag) => {
      const group = tag.split(":")[0]!;
      return {
        tag,
        width: Number(before[group + ":ImageWidth"]),
        height: Number(before[group + ":ImageHeight"]),
        app: String(before[group + ":PreviewApplicationName"] ?? ""),
      };
    })
    .filter((p) => p.app.startsWith("Adobe") && p.width && p.height)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  assert(
    references[0],
    "Missing original preview for face-coordinate verification",
  );
  const reference = (
    await run("exiftool", ["-b", "-" + references[0].tag, input], {
      encoding: "buffer",
      maxBuffer: 32 * 1024 ** 2,
    })
  ).stdout;
  const audit = path.join(root, "geometry");
  await fs.mkdir(audit, { recursive: true, mode: 0o700 });
  const oldFile = path.join(audit, source.id + "-before.jpg");
  const newFile = path.join(audit, source.id + "-after.jpg");
  for (const [buffer, file] of [
    [reference, oldFile],
    [jpeg, newFile],
  ] as const) {
    await sharp(await orientJpeg(buffer, Number(before["IFD0:Orientation"])))
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 94 })
      .toFile(file);
  }
  const { stdout } = await run(
    path.resolve("worker/.venv/bin/python"),
    ["scripts/dng-geometry.py", oldFile, newFile],
    { timeout: 60000 },
  );
  const geometry = JSON.parse(stdout);
  const identity = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  if (
    geometry.matrix.every((row: number[], y: number) =>
      row.every((v, x) => Math.abs(v - identity[y]![x]!) < 0.0005),
    )
  ) {
    geometry.matrix = identity;
    geometry.method += "; unchanged frame (subpixel fit noise)";
  }
  for (const face of faces) {
    const [x, y, w, h] = face.box;
    const m = geometry.matrix as number[][];
    const cx = x! + w! / 2,
      cy = y! + h! / 2;
    const px = m[0]![0]! * cx + m[0]![1]! * cy + m[0]![2]!;
    const py = m[1]![0]! * cx + m[1]![1]! * cy + m[1]![2]!;
    assert(
      px >= 0 && px <= 1 && py >= 0 && py <= 1,
      "A saved crop removes a detected face: " + face.id,
    );
  }
  return { ...geometry, faces: faces.map((f) => f.id) };
}
async function prepare(source: Source) {
  if (await state(source)) return;
  const disk = await fs.statfs(root);
  assert(
    disk.bavail * disk.bsize > 10 * 1024 ** 3,
    "Less than 10 GiB free locally",
  );
  assert(/\.dng$/i.test(source.s3_key));
  const sourceVersions = await versions(source.s3_key);
  assert.equal(sourceVersions.length, 1, "Unknown source versions");
  const original = sourceVersions[0]!;
  assert(original.latest && !original.marker && original.etag === source.etag);
  const key = source.s3_key.replace(/\.dng$/i, ".jpg");
  assert.equal(
    (await versions(key)).length,
    0,
    "JPEG destination already exists",
  );
  const work = path.join(root, "working", source.id);
  await fs.mkdir(work, { recursive: true, mode: 0o700 });
  const pilotSource = path.join(root, "pilot", source.id + ".dng");
  const input = (await exists(pilotSource))
    ? pilotSource
    : path.join(work, source.id + ".dng");
  if (!(await exists(input))) {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: inventory.bucket,
        Key: source.s3_key,
        VersionId: original.id,
        IfMatch: '"' + source.etag + '"',
      }),
    );
    assert.equal(response.VersionId, original.id);
    assert(response.Body);
    const data = Buffer.from(await response.Body.transformToByteArray());
    assert.equal(data.length, Number(source.size));
    assert.equal(
      hash(data, "md5"),
      source.etag,
      "Downloaded original checksum",
    );
    await fs.writeFile(input, data, { mode: 0o600 });
  }
  const downloaded = await fs.readFile(input);
  assert.equal(downloaded.length, Number(source.size));
  assert.equal(hash(downloaded, "md5"), source.etag);
  const before = await metadata(input);
  assert.equal(before["File:FileType"], "DNG");
  const preserved = await coreExif(input);
  assert(preserved.DateTimeOriginal && preserved.Make && preserved.Model);
  assert([1, 2, 3, 4, 5, 6, 7, 8].includes(Number(preserved.Orientation)));
  const pilotRendered = path.join(
    root,
    "pilot",
    "rendered",
    source.id + ".dng",
  );
  const outputDirectory = path.join(work, "rendered");
  await fs.mkdir(outputDirectory, { recursive: true });
  const rendered = (await exists(pilotRendered))
    ? pilotRendered
    : path.join(outputDirectory, source.id + ".dng");
  if (!(await exists(rendered))) {
    await run(converter, ["-c", "-p2", "-d", outputDirectory, input], {
      timeout: 180000,
    });
    assert(await exists(rendered), "Adobe did not create its output");
  }
  const after = await metadata(rendered);
  const previews = Object.entries(after)
    .filter(
      ([tag, value]) =>
        /:(JpgFromRaw|PreviewImage)$/.test(tag) && typeof value === "string",
    )
    .map(([tag]) => {
      const group = tag.split(":")[0]!;
      return {
        tag,
        group,
        width: Number(after[group + ":ImageWidth"]),
        height: Number(after[group + ":ImageHeight"]),
        application: after[group + ":PreviewApplicationName"],
      };
    })
    .filter(
      (p) => p.application === "Adobe DNG Converter" && p.width && p.height,
    )
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const preview = previews[0];
  assert(preview, "No Adobe-rendered JPEG");
  assert.equal(
    Number(after[preview.group + ":PreviewColorSpace"]),
    2,
    "Non-sRGB preview",
  );
  assert.equal(
    after["IFD0:Orientation"],
    preserved.Orientation,
    "Unexpected Adobe rotation",
  );
  const expected = expectedDimensions(before);
  assert(
    expected.candidates.some(
      ([w, h]) =>
        Math.abs(preview.width - w!) <= 4 && Math.abs(preview.height - h!) <= 4,
    ),
    "JPEG is not the full resolution of the saved crop: " +
      JSON.stringify({
        actual: [preview.width, preview.height],
        expected,
        angle: before["XMP-crs:CropAngle"],
      }),
  );
  const extracted = await run("exiftool", ["-b", "-" + preview.tag, rendered], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 ** 2,
  });
  const jpeg = extracted.stdout;
  const info = await sharp(jpeg, { failOn: "warning" }).metadata();
  assert.equal(info.format, "jpeg");
  assert.equal(info.width, preview.width);
  assert.equal(info.height, preview.height);
  const beforePixels = await pixelHash(jpeg);
  const destination = local(source, "jpg");
  await fs.writeFile(destination, jpeg, { mode: 0o600 });
  const thumbnail = path.join(work, "thumbnail.jpg");
  await sharp(jpeg)
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toFile(thumbnail);
  await run(
    "exiftool",
    [
      "-overwrite_original",
      "-n",
      "-TagsFromFile",
      input,
      "-EXIF:all",
      "-XMP:all",
      "-IPTC:all",
      "-XMP-crs:all=",
      "-Orientation=" + preserved.Orientation,
      "-ColorSpace=1",
      "-ImageWidth=" + info.width,
      "-ImageHeight=" + info.height,
      "-ExifImageWidth=" + info.width,
      "-ExifImageHeight=" + info.height,
      "-ThumbnailImage<=" + thumbnail,
      "-Software=Adobe DNG Converter 18.7; verified JPEG export",
      destination,
    ],
    { maxBuffer: 4 * 1024 ** 2 },
  );
  const exportedExif = await coreExif(destination);
  for (const field of fields)
    assert.deepEqual(
      exportedExif[field],
      preserved[field],
      "Metadata changed: " + field,
    );
  assert.equal(exportedExif.Orientation, preserved.Orientation);
  assert.equal(exportedExif.ColorSpace, 1);
  const output = await fs.readFile(destination);
  assert.equal(
    await pixelHash(output),
    beforePixels,
    "JPEG pixels changed during metadata copy",
  );
  assert(output.length < Number(source.size) * 0.95, "No useful space saving");
  const { result, needsMore } = await parseImageHead(
    output.subarray(0, 256 * 1024),
  );
  assert(
    !needsMore &&
      result.metadata?.dimensions &&
      result.metadata.date_taken &&
      result.metadata.camera,
  );
  const date =
    String(preserved.DateTimeOriginal).replace(
      /^(\d{4}):(\d{2}):(\d{2}) /,
      "$1-$2-$3T",
    ) + ".000Z";
  assert.equal(result.metadata.date_taken, date, "Wrong capture date");
  assert.equal(result.metadata.orientation, preserved.Orientation);
  const swap = Number(preserved.Orientation) >= 5;
  assert.deepEqual(result.metadata.dimensions, {
    width: swap ? info.height : info.width,
    height: swap ? info.width : info.height,
  });
  const geometry = await faceGeometry(source, before, input, jpeg);
  await save(local(source, "json"), {
    source,
    sourceVersion: original.id,
    key,
    bytes: output.length,
    sha256: hash(output),
    md5: hash(output, "md5"),
    pixelHash: beforePixels,
    width: info.width,
    height: info.height,
    metadata: result.metadata,
    state: "prepared",
    render: {
      engine: "Adobe DNG Converter 18.7",
      options: ["-c", "-p2"],
      previewTag: preview.tag,
      settingsDigest: after[preview.group + ":PreviewSettingsDigest"],
      sensor: expected.sensor,
      sourceMetadata: before,
      previousCatalogDate: source.metadata?.date_taken,
      captureDate: result.metadata.date_taken,
      geometry,
    },
  });
  // No deletion of remote originals happens here. Only local working files.
  await fs.rm(input, { force: true });
  await fs.rm(rendered, { force: true });
  await fs.rm(work, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      prepared: source.id,
      jpegBytes: output.length,
      dimensions: result.metadata.dimensions,
      date: result.metadata.date_taken,
    }),
  );
}
async function apply(source: Source) {
  if ((await state(source))?.state === "done") return;
  assert(
    ["prepared", "uploaded", "indexed"].includes((await state(source))?.state),
    "Only verified prepared photos can be applied",
  );
  const { stdout } = await run(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/convert-nef.mts",
      "apply",
      "--dir",
      path.join(root, String(source.folder_id)),
      "--limit",
      "1",
      "--concurrency",
      "1",
      "--replace-originals",
    ],
    { timeout: 180000, maxBuffer: 1024 ** 2 },
  );
  assert.equal(
    (await state(source))?.state,
    "done",
    "Replacement did not finish for expected ID: " + stdout,
  );
}
async function progress(active: string | null, error?: string) {
  const all = (await Promise.all(inventory.sources.map(state))).filter(Boolean);
  const done = all.filter((r) => r.state === "done");
  const report = {
    updatedAt: new Date().toISOString(),
    active,
    total: inventory.sources.length,
    prepared: all.length,
    replaced: done.length,
    originalBytes: done.reduce((s, r) => s + Number(r.source.size), 0),
    jpegBytes: done.reduce((s, r) => s + r.bytes, 0),
    freedBytes: done.reduce((s, r) => s + Number(r.source.size) - r.bytes, 0),
    error: error ?? null,
  };
  await save(path.join(root, "progress.json"), report);
  console.log(JSON.stringify(report));
}
async function retryNetwork(operation: () => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= 3 ||
        !/ECONNRESET|ETIMEDOUT|EAI_AGAIN|SSL|TLS|socket|Connection terminated|Timeout|SlowDown|ServiceUnavailable/i.test(
          message,
        )
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
const preparing = new Map<number, Promise<{ error?: unknown }>>();
try {
  const ids = option("--ids")?.split(",");
  const limit = Number(option("--limit") ?? Infinity);
  assert(limit > 0 && (Number.isInteger(limit) || limit === Infinity));
  const selection = inventory.sources
    .filter((s) => !ids || ids.includes(s.id))
    .slice(0, limit);
  // At most two input/render jobs, with replacements strictly in folder order.
  // Pending preparation errors are collected, never unhandled rejections.
  const start = (i: number) => {
    if (i >= selection.length || preparing.has(i)) return;
    preparing.set(
      i,
      (action === "apply"
        ? Promise.resolve()
        : retryNetwork(() => prepare(selection[i]!))
      ).then(
        () => ({}),
        (error) => ({ error }),
      ),
    );
  };
  start(0);
  start(1);
  for (let i = 0; i < selection.length; i++) {
    const source = selection[i]!;
    await progress(source.id);
    try {
      const ready = await preparing.get(i)!;
      if (ready.error) throw ready.error;
      start(i + 2);
      if (action !== "prepare") await retryNetwork(() => apply(source));
      preparing.delete(i);
    } catch (error) {
      await Promise.allSettled(preparing.values());
      await progress(
        source.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
  await progress(null);
} finally {
  await Promise.allSettled(preparing.values());
  s3.destroy();
}
