/**
 * One-off storage cleanup: keep the camera's full-resolution JPEG, with its
 * EXIF, without re-encoding pixels. Preparation only reads remote storage.
 *
 * npx tsx scripts/convert-nef.mts convert --folder-id 19973 --dir data/conversions/quebec --replace-originals
 * npx tsx scripts/convert-nef.mts prepare --folder-id 19973 --dir data/conversions/quebec
 * npx tsx scripts/convert-nef.mts apply --dir data/conversions/quebec --replace-originals
 *
 * The local per-photo journal makes both phases resumable. Apply verifies a
 * read-back of the uploaded JPEG before updating the same photo ID and then
 * deleting the pinned NEF version and the local JPEG working copy. An existing JPEG stops the operation; it never
 * deletes an unknown version. HDR DNGs and other RAWs need a separate export.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "dotenv";
import { Client, Pool } from "pg";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { parseTiffHead } from "../src/lib/rawPreview";
import { parseImageHead } from "../src/lib/imageProbe";
import type { PhotoMetadata } from "../src/types";

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const directory = path.resolve(option("--dir") ?? "data/conversions/nef");
const limit = Number(option("--limit") ?? Infinity);
const parallel = Number(option("--concurrency") ?? 4);
assert(limit > 0 && (Number.isInteger(limit) || limit === Infinity));
assert(Number.isInteger(parallel) && parallel > 0 && parallel <= 8);
const env = {
  ...parse(await fs.readFile(".env")),
  ...parse(await fs.readFile(".env.local").catch(() => Buffer.alloc(0))),
};
const bucket = env.BACKBLAZE_BUCKET!;
assert(bucket && env.DATABASE_URL);
const s3 = new S3Client({
  region: "us-east-1",
  endpoint: env.BACKBLAZE_ENDPOINT,
  credentials: {
    accessKeyId: env.BACKBLAZE_ACCESS_KEY!,
    secretAccessKey: env.BACKBLAZE_SECRET_KEY!,
  },
});
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  application_name: "blaze-nef-cleanup",
  max: parallel,
  statement_timeout: 30000,
});
const hash = (b: Buffer, algorithm = "sha256") =>
  crypto.createHash(algorithm).update(b).digest("hex");
const tag = (s: string | undefined) => s?.replace(/"/g, "");
const local = (id: string, suffix: string) =>
  path.join(directory, `${id}.${suffix}`);
async function save(file: string, value: unknown) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2), {
    mode: 0o600,
  });
  await fs.rename(`${file}.tmp`, file);
}
interface Source {
  id: string;
  s3_key: string;
  filename: string;
  size: string;
  etag: string;
  targetKey?: string;
  metadata: Record<string, unknown>;
}
interface RecordState {
  source: Source;
  sourceVersion: string;
  key: string;
  bytes: number;
  sha256: string;
  md5: string;
  pixelHash: string;
  width: number;
  height: number;
  metadata: PhotoMetadata;
  state: "prepared" | "uploaded" | "indexed" | "done";
  targetVersion?: string;
}
interface Plan {
  folderId: number;
  folderPath: string;
  bucket: string;
  sources: Source[];
}
async function state(id: string): Promise<RecordState | undefined> {
  try {
    return JSON.parse(await fs.readFile(local(id, "json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function versions(key: string) {
  const found: {
    id: string;
    etag: string | undefined;
    latest: boolean;
    marker: boolean;
    modifiedAt?: Date;
  }[] = [];
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );
    for (const v of page.Versions ?? []) {
      if (v.Key === key && v.VersionId)
        found.push({
          id: v.VersionId,
          etag: tag(v.ETag),
          latest: !!v.IsLatest,
          marker: false,
          modifiedAt: v.LastModified,
        });
    }
    for (const v of page.DeleteMarkers ?? []) {
      if (v.Key === key && v.VersionId)
        found.push({
          id: v.VersionId,
          etag: undefined,
          latest: !!v.IsLatest,
          marker: true,
          modifiedAt: v.LastModified,
        });
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  return found;
}
async function read(
  key: string,
  version: string,
  etag: string,
  range?: string,
) {
  const object = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      VersionId: version,
      IfMatch: `"${etag}"`,
      Range: range,
    }),
  );
  assert.equal(object.VersionId, version);
  assert.equal(tag(object.ETag), etag);
  assert(object.Body);
  return Buffer.from(await object.Body.transformToByteArray());
}
const fields = [
  "DateTimeOriginal",
  "CreateDate",
  "Make",
  "Model",
  "LensModel",
  "Orientation",
  "ColorSpace",
  "ISO",
  "ExposureTime",
  "FNumber",
  "FocalLength",
  "GPSLatitude",
  "GPSLongitude",
];
async function exif(file: string) {
  const result = await run("exiftool", [
    "-json",
    "-n",
    ...fields.map((f) => `-${f}`),
    "-Software",
    file,
  ]);
  const [data] = JSON.parse(result.stdout) as Record<string, unknown>[];
  assert(data);
  delete data.SourceFile;
  return data;
}
async function pixels(buffer: Buffer) {
  return hash(await sharp(buffer, { failOn: "warning" }).raw().toBuffer());
}
async function prepare(source: Source) {
  if (await state(source.id)) return;
  const disk = await fs.statfs(directory);
  assert(
    disk.bavail * disk.bsize > 5 * 1024 ** 3,
    "Less than 5 GiB free locally: apply the prepared batch before continuing",
  );
  const originalVersions = await versions(source.s3_key);
  assert.equal(
    originalVersions.length,
    1,
    "Multiple source versions need review",
  );
  const original = originalVersions[0]!;
  assert(original.latest && !original.marker && original.etag === source.etag);
  const head = await read(
    source.s3_key,
    original.id,
    source.etag,
    "bytes=0-1572863",
  );
  const layout = parseTiffHead(head);
  assert.equal(layout.unreachable.length, 0, "Unusual NEF layout needs review");
  const candidate = layout.candidates.sort((a, b) => b.length - a.length)[0];
  assert(
    candidate &&
      candidate.length > 100000 &&
      candidate.length < 32 * 1024 * 1024,
  );
  assert(
    candidate.offset > 0 &&
      candidate.offset + candidate.length <= Number(source.size),
  );
  const end = Math.max(
    head.length,
    ...layout.candidates.map((c) => c.offset + c.length),
  );
  assert(end < 32 * 1024 * 1024 && end <= Number(source.size));
  const prefix =
    end > head.length
      ? Buffer.concat([
          head,
          await read(
            source.s3_key,
            original.id,
            source.etag,
            `bytes=${head.length}-${end - 1}`,
          ),
        ])
      : head;
  assert.equal(prefix.length, end);
  const jpeg = prefix.subarray(
    candidate.offset,
    candidate.offset + candidate.length,
  );
  const info = await sharp(jpeg, { failOn: "warning" }).metadata();
  assert.equal(info.format, "jpeg");
  assert(info.width && info.height && layout.width && layout.height);
  // Nikon's optical-black sensor border is not part of the rendered image.
  assert(
    info.width >= layout.width * 0.98 && info.height >= layout.height * 0.98,
    "Embedded JPEG is not full resolution",
  );
  assert(info.width <= layout.width && info.height <= layout.height);
  const sourceHead = local(source.id, "NEF");
  const destination = local(source.id, "jpg");
  await fs.writeFile(sourceHead, prefix, { mode: 0o600 });
  await fs.writeFile(destination, jpeg, { mode: 0o600 });
  const before = await exif(sourceHead);
  assert.equal(before.Model, "NIKON D7200");
  assert.equal(
    before.ColorSpace,
    1,
    "Non-sRGB source needs a colour-managed export",
  );
  assert.match(String(before.Software), /^Ver\./, "Edited RAW needs review");
  assert([1, 2, 3, 4, 5, 6, 7, 8].includes(Number(before.Orientation)));
  await run("exiftool", [
    "-overwrite_original",
    "-n",
    "-TagsFromFile",
    sourceHead,
    "-EXIF:all",
    "-XMP:all",
    "-IPTC:all",
    "-Orientation",
    "-ColorSpace",
    `-ExifImageWidth=${info.width}`,
    `-ExifImageHeight=${info.height}`,
    destination,
  ]);
  const after = await exif(destination);
  for (const field of fields)
    assert.deepEqual(after[field], before[field], `Metadata changed: ${field}`);
  const output = await fs.readFile(destination);
  const pixelHash = await pixels(jpeg);
  assert.equal(await pixels(output), pixelHash, "JPEG pixels changed");
  assert(
    output.length < Number(source.size) * 0.95,
    "Insufficient space saving",
  );
  const { result } = await parseImageHead(output.subarray(0, 256 * 1024));
  assert(
    result.metadata?.dimensions &&
      result.metadata.date_taken &&
      result.metadata.camera,
  );
  assert.equal(result.metadata.orientation, layout.orientation);
  if (source.metadata?.date_taken)
    assert.equal(result.metadata.date_taken, source.metadata.date_taken);
  const record: RecordState = {
    source,
    sourceVersion: original.id,
    key: source.targetKey ?? source.s3_key.replace(/\.nef$/i, ".jpg"),
    bytes: output.length,
    sha256: hash(output),
    md5: hash(output, "md5"),
    pixelHash,
    width: info.width,
    height: info.height,
    metadata: result.metadata,
    state: "prepared",
  };
  await save(local(source.id, "json"), record);
  await fs.unlink(sourceHead);
}
async function verifyUploaded(record: RecordState) {
  assert(record.targetVersion);
  const uploaded = await read(record.key, record.targetVersion, record.md5);
  assert.equal(uploaded.length, record.bytes);
  assert.equal(hash(uploaded), record.sha256, "Remote read-back differs");
  assert.equal(
    await pixels(uploaded),
    record.pixelHash,
    "Remote JPEG does not decode identically",
  );
  const latest = await s3.send(
    new HeadObjectCommand({ Bucket: bucket, Key: record.key }),
  );
  assert.equal(
    latest.VersionId,
    record.targetVersion,
    "A newer JPEG was uploaded",
  );
  assert.equal(latest.ContentLength, record.bytes);
  assert.equal(tag(latest.ETag), record.md5);
  assert.equal(latest.ContentType, "image/jpeg");
  assert(latest.LastModified);
  const all = await versions(record.key);
  assert.equal(all.length, 1, "Unexpected destination versions");
  assert.equal(all[0]!.id, record.targetVersion);
  // HTTP Last-Modified is rounded to seconds; B2 listings retain
  // milliseconds. Sync compares against listings, so keep their precision.
  const modifiedAt = all[0]!.modifiedAt;
  assert(modifiedAt);
  return modifiedAt;
}
async function apply(source: Source) {
  const record = await state(source.id);
  assert(record, "Missing prepared JPEG");
  if (record.state === "done") return;
  const output = await fs.readFile(local(source.id, "jpg"));
  assert.equal(hash(output), record.sha256);
  const oldVersions = await versions(source.s3_key);
  assert(
    oldVersions.every(
      (v) =>
        v.id === record.sourceVersion && v.etag === source.etag && !v.marker,
    ),
    "Source was changed",
  );
  const db = await pool.connect();
  let dbError: unknown;
  try {
    await db.query("BEGIN");
    const current = (
      await db.query("SELECT * FROM photos WHERE id=$1 FOR UPDATE", [source.id])
    ).rows[0];
    assert(
      current && current.trashed_at === null,
      "Photo was removed or trashed",
    );
    assert(
      current.s3_key === source.s3_key || current.s3_key === record.key,
      "Photo was moved",
    );
    if (current.s3_key === source.s3_key) {
      assert.equal(current.etag, source.etag);
      assert.equal(String(current.size), source.size);
      assert.equal(
        oldVersions.length,
        1,
        "Original is missing before replacement",
      );
    } else {
      assert.equal(current.etag, record.md5);
      assert.equal(Number(current.size), record.bytes);
    }
    const targets = await versions(record.key);
    if (!record.targetVersion) {
      // Recover an upload that completed just before its journal was saved.
      if (targets.length) {
        assert.equal(targets.length, 1, "Destination already exists");
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: record.key }),
        );
        assert.equal(
          head.Metadata?.["blaze-source-version"],
          record.sourceVersion,
          "Unrelated destination",
        );
        assert.equal(head.Metadata?.["blaze-source-id"], source.id);
        assert.equal(tag(head.ETag), record.md5);
        record.targetVersion = head.VersionId;
      } else {
        // B2 has no conditional PutObject. Require an empty version listing
        // above and exactly our version on read-back before replacing the NEF.
        const put = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: record.key,
            Body: output,
            ContentType: "image/jpeg",
            ContentLength: output.length,
            ContentMD5: crypto
              .createHash("md5")
              .update(output)
              .digest("base64"),
            Metadata: {
              "blaze-source-version": record.sourceVersion,
              "blaze-source-id": source.id,
              "blaze-sha256": record.sha256,
            },
          }),
        );
        assert.equal(tag(put.ETag), record.md5);
        record.targetVersion = put.VersionId;
      }
      assert(record.targetVersion);
      record.state = "uploaded";
      await save(local(source.id, "json"), record);
    } else {
      assert.equal(targets.length, 1);
      assert.equal(targets[0]!.id, record.targetVersion);
    }
    const remote = await verifyUploaded(record);
    // Keep ID, faces, favourites, hand rotation, collections and existing
    // thumbnails: the rendered photo and the filename stem are unchanged.
    await db.query(
      `UPDATE photos SET s3_key=$2, filename=$3, size=$4, mime_type='image/jpeg',
      etag=$5, modified_at=$6, metadata=COALESCE(metadata,'{}'::jsonb)||$7::jsonb,
      metadata_status='extracted', last_synced=now() WHERE id=$1`,
      [
        source.id,
        record.key,
        path.posix.basename(record.key),
        record.bytes,
        record.md5,
        remote.toISOString(),
        JSON.stringify(record.metadata),
      ],
    );
    await db.query("COMMIT");
    record.state = "indexed";
    await save(local(source.id, "json"), record);
    // Database already serves the verified replacement. A failure here leaves
    // a redundant original, never a photo whose file has disappeared.
    const stillOld = await versions(source.s3_key);
    assert(
      stillOld.every(
        (v) =>
          v.id === record.sourceVersion && v.etag === source.etag && !v.marker,
      ),
      "Original changed during conversion",
    );
    if (stillOld.length) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: source.s3_key,
          VersionId: record.sourceVersion,
        }),
      );
    }
    assert.equal(
      (await versions(source.s3_key)).length,
      0,
      "Original version remains",
    );
    record.state = "done";
    await save(local(source.id, "json"), record);
    // The verified remote JPEG is now the photo. Keep the small journal,
    // not a second local copy of every converted image.
    await fs.rm(local(source.id, "jpg"), { force: true });
  } catch (error) {
    dbError = error;
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release(dbError instanceof Error ? dbError : undefined);
  }
}
async function withNetworkRetry(operation: () => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= 3 ||
        !/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|SSL|TLS|socket|Connection terminated|Timeout|SlowDown|ServiceUnavailable|InternalError/i.test(
          message,
        )
      )
        throw error;
      console.log(JSON.stringify({ networkRetry: attempt }));
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
}
async function main() {
  const action = args[0];
  assert(action === "prepare" || action === "apply" || action === "convert");
  if (action !== "prepare") {
    assert(
      args.includes("--replace-originals"),
      "Replacement requires --replace-originals",
    );
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let plan: Plan;
  try {
    plan = JSON.parse(
      await fs.readFile(path.join(directory, "plan.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    assert(action === "prepare" || action === "convert");
    const folderId = Number(option("--folder-id"));
    assert(Number.isInteger(folderId) && folderId > 0);
    const folder = (
      await pool.query("SELECT path FROM folders WHERE id=$1", [folderId])
    ).rows[0];
    assert(folder);
    const sources = (
      await pool.query(
        `SELECT id::text, filename, s3_key, size::text, etag, metadata
      FROM photos WHERE folder_id=$1 AND lower(filename) LIKE '%.nef'
      AND mime_type='image/x-nikon-nef' AND trashed_at IS NULL ORDER BY filename`,
        [folderId],
      )
    ).rows as Source[];
    assert(sources.length);
    plan = { folderId, folderPath: folder.path as string, bucket, sources };
    await save(path.join(directory, "plan.json"), plan);
  }
  assert.equal(plan.bucket, bucket);
  if (option("--folder-id"))
    assert.equal(plan.folderId, Number(option("--folder-id")));
  const pending: Source[] = [];
  for (const source of plan.sources) {
    const record = await state(source.id);
    if (action === "prepare" ? !record : record?.state !== "done")
      pending.push(source);
  }
  const work = pending.slice(0, limit);
  console.log(
    JSON.stringify({
      action,
      folder: plan.folderPath,
      total: plan.sources.length,
      pending: pending.length,
      thisRun: work.length,
    }),
  );
  let guard: Client | undefined;
  let timer: NodeJS.Timeout | undefined;
  let failed = false;
  let completed = 0;
  try {
    if (action !== "prepare" && work.length > 0) {
      assert(
        args.includes("--replace-originals"),
        "Apply requires --replace-originals",
      );
      // A full/folder sync must not observe the upload/index/delete transition.
      // Registered jobs cannot start until the maintenance session releases its
      // share locks. No table contents or settings are changed by this guard.
      guard = new Client({
        connectionString: env.DATABASE_URL,
        application_name: "blaze-nef-maintenance-guard",
        lock_timeout: 5000,
      });
      await guard.connect();
      await guard.query("BEGIN");
      await guard.query("SET LOCAL idle_in_transaction_session_timeout=0");
      await guard.query("LOCK TABLE sync_jobs, task_leases IN SHARE MODE");
      assert.equal(
        (
          await guard.query(
            "SELECT 1 FROM sync_jobs WHERE status='running' LIMIT 1",
          )
        ).rowCount,
        0,
        "Wait for active sync",
      );
      assert.equal(
        (
          await guard.query(
            "SELECT 1 FROM task_leases WHERE expires_at>now() LIMIT 1",
          )
        ).rowCount,
        0,
        "Wait for active worker",
      );
      await guard.query("SELECT pg_advisory_xact_lock($1)", [0x626c617a6567]);
      timer = setInterval(() => {
        void guard?.query("SELECT 1").catch(() => {
          failed = true;
        });
      }, 15000);
    }
    let cursor = 0;
    await Promise.all(
      Array.from({ length: parallel }, async () => {
        while (!failed) {
          const source = work[cursor++];
          if (!source) return;
          try {
            // At most `parallel` photos are on disk: each worker prepares,
            // verifies, replaces and removes its working copy before the next.
            await withNetworkRetry(async () => {
              if (action === "prepare" || action === "convert")
                await prepare(source);
              if (action === "apply" || action === "convert")
                await apply(source);
            });
            completed++;
            if (completed % 25 === 0 || completed === work.length)
              console.log(
                JSON.stringify({ action, completed, thisRun: work.length }),
              );
          } catch (error) {
            failed = true;
            console.error(
              JSON.stringify({
                id: source.id,
                filename: source.filename,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
      }),
    );
  } finally {
    if (timer) clearInterval(timer);
    if (guard) {
      await guard.query("ROLLBACK").catch(() => {});
      await guard.end();
    }
  }
  const records = (
    await Promise.all(plan.sources.map((p) => state(p.id)))
  ).filter((p): p is RecordState => !!p);
  const done = records.filter((p) => p.state === "done");
  const summary = {
    folder: plan.folderPath,
    planned: plan.sources.length,
    prepared: records.length,
    replaced: done.length,
    sourceBytes: records.reduce((s, r) => s + Number(r.source.size), 0),
    jpegBytes: records.reduce((s, r) => s + r.bytes, 0),
    freedBytes: done.reduce((s, r) => s + Number(r.source.size) - r.bytes, 0),
    failed,
  };
  await save(path.join(directory, "summary.json"), summary);
  console.log(JSON.stringify(summary));
  if (failed) process.exitCode = 1;
}
try {
  await main();
} finally {
  await pool.end();
  s3.destroy();
}
