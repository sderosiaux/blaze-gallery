/** Refresh derivatives after every DNG replacement has passed its final audit. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { parse } from "dotenv";
import { Pool } from "pg";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

assert(process.argv.includes("--apply"), "Requires --apply");
const root = path.resolve("data/conversions/dng-20261021");
const env = {
  ...parse(await fs.readFile(".env")),
  ...parse(await fs.readFile(".env.local")),
};
assert.equal(env.THUMBNAIL_STORAGE, "s3");
const inventory = JSON.parse(
  await fs.readFile(path.join(root, "inventory.json"), "utf8"),
);
const audit = JSON.parse(
  await fs.readFile(path.join(root, "verified-report.json"), "utf8"),
);
assert.equal(audit.converted, inventory.sources.length);
assert.equal(audit.held.length, 0);
assert.equal(audit.databaseMismatches, 0);
const originalFaces = JSON.parse(
  await fs.readFile(path.join(root, "faces-before.json"), "utf8"),
);
const db = new Pool({
  connectionString: env.DATABASE_URL,
  max: 4,
  application_name: "blaze-dng-derivatives",
});
const s3 = new S3Client({
  endpoint: env.BACKBLAZE_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: env.BACKBLAZE_ACCESS_KEY!,
    secretAccessKey: env.BACKBLAZE_SECRET_KEY!,
  },
});
const r2 = new S3Client({
  endpoint: env.THUMBNAIL_S3_ENDPOINT,
  region: "auto",
  forcePathStyle: true,
  // R2 accepts Content-MD5 but rejects an additional SDK-generated CRC32.
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: env.THUMBNAIL_S3_ACCESS_KEY!,
    secretAccessKey: env.THUMBNAIL_S3_SECRET_KEY!,
  },
});
const hash = (b: Buffer, algorithm = "sha256") =>
  crypto.createHash(algorithm).update(b).digest("hex");
const records = new Map<string, any>();
for (const source of inventory.sources) {
  const r = JSON.parse(
    await fs.readFile(
      path.join(root, String(source.folder_id), source.id + ".json"),
      "utf8",
    ),
  );
  assert.equal(r.state, "done");
  records.set(source.id, r);
}
const close = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < 0.000001);
const clamp = (v: number) => Math.min(1, Math.max(0, v));
let facesChanged = 0,
  thumbnails = 0;
async function refreshFaces() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [0x626c617a6567]);
    for (const original of originalFaces) {
      const record = records.get(original.photo_id);
      assert(record);
      const g = record.render.geometry;
      assert(
        g && g.faces.includes(original.id),
        "Missing verified face geometry",
      );
      let m = g.matrix as number[][];
      const identity = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      if (
        m.every((row, y) =>
          row.every((v, x) => Math.abs(v - identity[y]![x]!) < 0.0005),
        )
      )
        m = identity;
      const point = (x: number, y: number) => [
        m[0]![0]! * x + m[0]![1]! * y + m[0]![2]!,
        m[1]![0]! * x + m[1]![1]! * y + m[1]![2]!,
      ];
      const [x, y, w, h] = original.box as number[];
      const corners = [
        [x!, y!],
        [x! + w!, y!],
        [x!, y! + h!],
        [x! + w!, y! + h!],
      ].map(([a, b]) => point(a!, b!));
      const minX = clamp(Math.min(...corners.map((p) => p[0]!)));
      const maxX = clamp(Math.max(...corners.map((p) => p[0]!)));
      const minY = clamp(Math.min(...corners.map((p) => p[1]!)));
      const maxY = clamp(Math.max(...corners.map((p) => p[1]!)));
      assert(
        maxX > minX && maxY > minY,
        "Detected face is outside the exported photo",
      );
      const box = [minX, minY, maxX - minX, maxY - minY];
      const landmarks: number[] = [];
      for (let i = 0; i < original.landmarks.length; i += 2)
        landmarks.push(
          ...point(original.landmarks[i], original.landmarks[i + 1]),
        );
      const current = (
        await client.query(
          "SELECT photo_id::text,box,landmarks,person_id::text,assignment FROM faces WHERE id=$1 FOR UPDATE",
          [original.id],
        )
      ).rows[0];
      assert(current && current.photo_id === original.photo_id);
      if (close(current.box, box) && close(current.landmarks, landmarks))
        continue;
      assert(
        close(current.box, original.box) &&
          close(current.landmarks, original.landmarks),
        "Face coordinates changed independently",
      );
      // Keep the ID, person/assignment, embedding and original detection measurements.
      await client.query(
        "UPDATE faces SET box=$2::real[],landmarks=$3::real[] WHERE id=$1",
        [original.id, box, landmarks],
      );
      facesChanged++;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function refreshThumbnail(source: any) {
  const record = records.get(source.id);
  assert(record);
  const current = (
    await db.query(
      "SELECT id::text,s3_key,etag,thumbnail_path,metadata FROM photos WHERE id=$1 AND trashed_at IS NULL",
      [source.id],
    )
  ).rows[0];
  assert(
    current && current.s3_key === record.key && current.etag === record.md5,
  );
  const rotation = Number(current.metadata?.user_rotation ?? 0);
  assert([0, 90, 180, 270].includes(rotation));
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: inventory.bucket,
      Key: record.key,
      VersionId: record.targetVersion,
      IfMatch: '"' + record.md5 + '"',
    }),
  );
  assert(response.Body && response.VersionId === record.targetVersion);
  const jpeg = Buffer.from(await response.Body.transformToByteArray());
  assert.equal(hash(jpeg), record.sha256);
  const upright = await sharp(jpeg, { failOn: "warning" })
    .rotate()
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const thumbnail = rotation
    ? await sharp(upright).rotate(rotation).jpeg({ quality: 80 }).toBuffer()
    : upright;
  const originalPath = source.thumbnail_path as string;
  assert(
    originalPath &&
      !originalPath.startsWith("/") &&
      !originalPath.includes("../"),
  );
  const key =
    originalPath.replace(/\.[^.]+$/, "") +
    "-dng-" +
    record.md5.slice(0, 12) +
    "-r" +
    rotation +
    ".jpeg";
  const sha256 = hash(thumbnail);
  const sample =
    inventory.sources.findIndex((s: any) => s.id === source.id) % 20 === 0;
  await fs.writeFile(
    path.join(root, "qa", source.id + "-after.jpg"),
    thumbnail,
    { mode: 0o600 },
  );
  if (sample && current.thumbnail_path && current.thumbnail_path !== key) {
    try {
      const old = await r2.send(
        new GetObjectCommand({
          Bucket: env.THUMBNAIL_S3_BUCKET,
          Key: current.thumbnail_path,
        }),
      );
      assert(old.Body);
      await fs.writeFile(
        path.join(root, "qa", source.id + "-before.jpg"),
        Buffer.from(await old.Body.transformToByteArray()),
        { mode: 0o600 },
      );
    } catch (error: any) {
      // A missing old cache entry cannot prevent rebuilding its replacement.
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
    }
  }
  await r2.send(
    new PutObjectCommand({
      Bucket: env.THUMBNAIL_S3_BUCKET,
      Key: key,
      Body: thumbnail,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
      ContentMD5: crypto.createHash("md5").update(thumbnail).digest("base64"),
      Metadata: {
        "blaze-source-id": source.id,
        "blaze-source-etag": record.md5,
        "blaze-sha256": sha256,
      },
    }),
  );
  const check = await r2.send(
    new GetObjectCommand({ Bucket: env.THUMBNAIL_S3_BUCKET, Key: key }),
  );
  assert(check.Body);
  const uploaded = Buffer.from(await check.Body.transformToByteArray());
  assert.equal(hash(uploaded), sha256, "Thumbnail read-back mismatch");
  const update = await db.query(
    "UPDATE photos SET thumbnail_path=$2,thumbnail_status='generated' WHERE id=$1 AND s3_key=$3 AND etag=$4 AND thumbnail_path IS NOT DISTINCT FROM $5 AND COALESCE((metadata->>'user_rotation')::int,0)=$6 RETURNING id",
    [source.id, key, record.key, record.md5, current.thumbnail_path, rotation],
  );
  assert.equal(update.rowCount, 1, "Photo changed during thumbnail refresh");
  if (current.thumbnail_path && current.thumbnail_path !== key) {
    const count = (
      await db.query(
        "SELECT count(*)::int AS n FROM photos WHERE thumbnail_path=$1",
        [current.thumbnail_path],
      )
    ).rows[0].n;
    if (count === 0)
      await r2.send(
        new DeleteObjectCommand({
          Bucket: env.THUMBNAIL_S3_BUCKET,
          Key: current.thumbnail_path,
        }),
      );
  }
  const info = await sharp(uploaded).metadata();
  await fs.writeFile(
    path.join(root, "derivatives", source.id + ".json"),
    JSON.stringify(
      {
        id: source.id,
        key,
        sha256,
        bytes: uploaded.length,
        width: info.width,
        height: info.height,
        sourceEtag: record.md5,
        userRotation: rotation,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  thumbnails++;
  if (thumbnails % 20 === 0) console.log(JSON.stringify({ thumbnails }));
}
try {
  await refreshFaces();
  await fs.mkdir(path.join(root, "derivatives"), {
    recursive: true,
    mode: 0o700,
  });
  await fs.mkdir(path.join(root, "qa"), { recursive: true, mode: 0o700 });
  let cursor = 0;
  const jobs = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      while (cursor < inventory.sources.length)
        await refreshThumbnail(inventory.sources[cursor++]);
    }),
  );
  for (const result of jobs)
    if (result.status === "rejected") throw result.reason;
  const faceIds = originalFaces.map((f: any) => f.id);
  const currentFaces = (
    await db.query(
      "SELECT id::text,person_id::text,assignment,box,landmarks FROM faces WHERE id=ANY($1::bigint[])",
      [faceIds],
    )
  ).rows;
  assert.equal(currentFaces.length, originalFaces.length);
  const identityChanges = currentFaces.filter((f) => {
    const original = originalFaces.find((o: any) => o.id === f.id);
    return (
      original.person_id !== f.person_id || original.assignment !== f.assignment
    );
  }).length;
  const report = {
    verifiedAt: new Date().toISOString(),
    thumbnails,
    faceCoordinatesUpdated: currentFaces.filter((f) => {
      const original = originalFaces.find((o: any) => o.id === f.id);
      return (
        !close(f.box, original.box) || !close(f.landmarks, original.landmarks)
      );
    }).length,
    faceCoordinatesUpdatedThisRun: facesChanged,
    facesPreserved: currentFaces.length,
    identityChanges,
  };
  await fs.writeFile(
    path.join(root, "derivatives-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  await db.end();
  s3.destroy();
  r2.destroy();
}
