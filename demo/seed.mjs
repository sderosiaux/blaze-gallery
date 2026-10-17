// @ts-check
/**
 * Fills the demo bucket with the library described in demo/photos.json, then
 * has the running app index it, so `docker compose --profile demo up` ends
 * on a browsable gallery with no manual step.
 *
 * Photos come from Lorem Picsum (Unsplash photos, Unsplash License; authors
 * in demo/CREDITS.md). Picsum strips metadata, so each photo gets the EXIF
 * the timeline reads: DateTimeOriginal from the manifest, Orientation 1.
 * Downloads are untrusted bytes: they stay in memory, are only ever decoded
 * by sharp, and are rejected unless they are a JPEG of the requested size.
 *
 * Idempotent: keys already in the bucket are not downloaded again; the sync
 * and the thumbnail warm-up only do what is missing.
 */
import { readFileSync } from "node:fs";
import {
  CreateBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";

/**
 * @typedef {object} DemoPhoto
 * @property {string} key       object key: "<album>/<file>.jpg"
 * @property {string} taken     local date and time the photo stands for (ISO, no zone)
 * @property {number} picsum    Lorem Picsum id
 * @property {number} width     size requested from picsum (long edge 1600, original ratio)
 * @property {number} height
 * @property {string} author
 * @property {string} unsplash
 */

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;

/** @param {string} name */
function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`[demo-seed] ${message}\n`);
}

/** @type {DemoPhoto[]} */
const photos = JSON.parse(
  readFileSync(new URL("./photos.json", import.meta.url), "utf8"),
);

const bucket = env("BACKBLAZE_BUCKET");
const appUrl = env("DEMO_APP_URL").replace(/\/$/, "");
const apiKey = env("API_KEY");
const s3 = new S3Client({
  endpoint: env("BACKBLAZE_ENDPOINT"),
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: env("BACKBLAZE_ACCESS_KEY"),
    secretAccessKey: env("BACKBLAZE_SECRET_KEY"),
  },
});

/**
 * Calls `probe` every `everyMs` until it returns a value, for at most `forMs`.
 * An error thrown by `probe` stops the wait: a probe that expects a service
 * still starting turns its connection errors into `undefined` itself.
 * @template T
 * @param {string} what
 * @param {() => Promise<T | undefined>} probe
 * @param {{ everyMs?: number, forMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function poll(what, probe, { everyMs = 1000, forMs = 300_000 } = {}) {
  const deadline = Date.now() + forMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/** HTTP status of an AWS SDK error, undefined when no response came back */
function httpStatus(/** @type {unknown} */ error) {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return undefined;
  }
  const metadata = /** @type {{ httpStatusCode?: number }} */ (error.$metadata);
  return metadata.httpStatusCode;
}

async function ensureBucket() {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    log(`created bucket ${bucket}`);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
      throw error;
    }
  }
}

/** @returns {Promise<Set<string>>} */
async function existingKeys() {
  const keys = new Set();
  /** @type {string | undefined} */
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.add(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** "2018-08-09T10:12:40" -> "2018:08:09 10:12:40", the EXIF date form */
function exifDate(/** @type {string} */ iso) {
  return iso.replace("T", " ").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$1:$2:$3");
}

/** @param {DemoPhoto} photo */
async function download(photo) {
  const url = `https://picsum.photos/id/${photo.picsum}/${photo.width}/${photo.height}.jpg`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (!type.startsWith("image/jpeg"))
        throw new Error(`not a JPEG: ${type}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_DOWNLOAD_BYTES) throw new Error("too large");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_DOWNLOAD_BYTES) throw new Error("too large");
      return body;
    } catch (error) {
      if (attempt === 3) {
        throw new Error(
          `picsum ${photo.picsum}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      log(`picsum ${photo.picsum}: retrying (${String(error)})`);
    }
  }
}

/** @param {DemoPhoto} photo */
async function withExif(photo, /** @type {Buffer} */ downloaded) {
  const image = sharp(downloaded, { limitInputPixels: 4000 * 4000 });
  const meta = await image.metadata();
  if (
    meta.format !== "jpeg" ||
    meta.width !== photo.width ||
    meta.height !== photo.height
  ) {
    throw new Error(
      `picsum ${photo.picsum}: expected a ${photo.width}x${photo.height} JPEG, got ${meta.format} ${meta.width}x${meta.height}`,
    );
  }
  const date = exifDate(photo.taken);
  return image
    .withExif({
      IFD0: { Orientation: "1", DateTime: date, Artist: photo.author },
      IFD2: { DateTimeOriginal: date, DateTimeDigitized: date },
    })
    .jpeg({ quality: 86 })
    .toBuffer();
}

/** @param {DemoPhoto[]} missing */
async function upload(missing) {
  const queue = [...missing];
  let done = 0;
  const worker = async () => {
    for (let photo = queue.shift(); photo; photo = queue.shift()) {
      const body = await withExif(photo, await download(photo));
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: photo.key,
          Body: body,
          ContentType: "image/jpeg",
        }),
      );
      done++;
      if (done % 10 === 0 || done === missing.length) {
        log(`uploaded ${done}/${missing.length}`);
      }
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Record<string, unknown>>}
 */
async function api(path, init = {}) {
  const response = await fetch(`${appUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = /** @type {Record<string, unknown>} */ (await response.json());
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

/** Resolves once the sync queue holds no pending or running job */
async function syncQueueDrained(/** @type {string} */ what) {
  await poll(what, async () => {
    const status = await api("/api/sync/status");
    return Array.isArray(status.activeJobs) && status.activeJobs.length === 0
      ? true
      : undefined;
  });
}

/** Folders that hold photos directly, from the manifest keys */
function albums() {
  return [
    ...new Set(photos.map((p) => p.key.slice(0, p.key.lastIndexOf("/")))),
  ];
}

async function indexInApp() {
  await poll("the app", () =>
    fetch(`${appUrl}/api/health`).then(
      (response) => (response.ok ? true : undefined),
      () => undefined,
    ),
  );

  log("full sync");
  await api("/api/sync/full", { method: "POST" });
  await syncQueueDrained("the full sync");

  // The timeline reads date_taken, which a full scan leaves for later
  log("reading EXIF");
  for (const folderPath of albums()) {
    await api("/api/sync/folder", {
      method: "POST",
      body: JSON.stringify({ folderPath, type: "metadata_scan" }),
    });
  }
  await syncQueueDrained("the metadata scans");

  log("building thumbnails");
  for (const folder of albums()) {
    /** @type {string | null} */
    let after = null;
    do {
      const query = new URLSearchParams({ folder });
      if (after) query.set("after", after);
      const batch = await api(`/api/thumbnails/warm?${query.toString()}`, {
        method: "POST",
      });
      after = typeof batch.next === "string" ? batch.next : null;
    } while (after);
  }
}

async function main() {
  await poll("the S3 server", () =>
    ensureBucket().then(
      () => true,
      (/** @type {unknown} */ error) => {
        // No HTTP answer yet: the server is still starting. An answer that
        // is an error (bad credentials...) will not get better by waiting.
        if (httpStatus(error) === undefined) return undefined;
        throw error;
      },
    ),
  );
  const present = await existingKeys();
  const missing = photos.filter((photo) => !present.has(photo.key));
  log(
    `${photos.length} photos in the manifest, ${photos.length - missing.length} already in s3://${bucket}`,
  );
  if (missing.length > 0) await upload(missing);

  await indexInApp();
  log(`ready: ${photos.length} photos in ${albums().length} albums`);
}

main().catch((/** @type {unknown} */ error) => {
  process.stderr.write(
    `[demo-seed] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
