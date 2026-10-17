/**
 * RAW files got their dimensions from IFD0, which holds a 160×120 strip, so
 * the grid laid them out at the wrong shape. This reads only the IFDs (first
 * 256 KB) to store the sensor size, display-oriented.
 *
 * Usage: npx tsx scripts/fix-raw-dimensions.ts [--dry-run] [--limit N] [--concurrency N]
 * Resumable: rows already corrected (width > 1000) are skipped.
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { readTiffLayout } from "../src/lib/rawPreview";

dotenv.config();

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};
const dryRun = args.includes("--dry-run");
const limit = flag("--limit");
const concurrency = flag("--concurrency") ?? 16;
const valueFlags = new Set(["--limit", "--concurrency"]);
for (const [i, arg] of args.entries()) {
  if (arg === "--dry-run" || valueFlags.has(arg)) continue;
  if (i > 0 && valueFlags.has(args[i - 1])) continue;
  console.error(`Unknown argument: ${arg}`);
  process.exit(2);
}
for (const [name, value] of [
  ["--limit", limit],
  ["--concurrency", concurrency],
] as const) {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    console.error(`${name} expects a positive integer`);
    process.exit(2);
  }
}

const RAW = String.raw`lower(filename) ~ '\.(nef|nrw|cr2|arw|srf|sr2|dng|orf|pef|srw|3fr|erf|kdc|mrw|iiq)$'`;
const HEAD = 256 * 1024;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({
  endpoint: process.env.BACKBLAZE_ENDPOINT,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.BACKBLAZE_ACCESS_KEY!,
    secretAccessKey: process.env.BACKBLAZE_SECRET_KEY!,
  },
});

async function readRange(
  key: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.BACKBLAZE_BUCKET,
      Key: key,
      Range: `bytes=${start}-${end}`,
    }),
  );
  return Buffer.from(await out.Body!.transformToByteArray());
}

async function main() {
  const { rows } = await pool.query<{ id: string; s3_key: string }>(
    `SELECT id, s3_key FROM photos
     WHERE ${RAW}
       AND COALESCE((metadata->'dimensions'->>'width')::int, 0) <= 1000
       AND COALESCE((metadata->'dimensions'->>'height')::int, 0) <= 1000
     ORDER BY id ${limit ? `LIMIT ${limit}` : ""}`,
  );
  console.log(`${rows.length} RAW files to read${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return;

  let done = 0;
  let fixed = 0;
  let unreadable = 0;
  let failed = 0;
  const started = Date.now();

  const worker = async () => {
    for (;;) {
      const row = rows.shift();
      if (!row) return;
      try {
        const { layout } = await readTiffLayout(
          (start, end) => readRange(row.s3_key, start, end),
          HEAD,
        );
        const { width, height, orientation } = layout;
        if (width && height && width > 1000 && height > 1000) {
          const swap = (orientation ?? 1) >= 5;
          await pool.query(
            `UPDATE photos
             SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{dimensions}', $1::jsonb)
             WHERE id = $2`,
            [
              JSON.stringify(
                swap ? { width: height, height: width } : { width, height },
              ),
              row.id,
            ],
          );
          fixed++;
        } else {
          unreadable++;
        }
      } catch (error) {
        failed++;
        console.error(
          `photo ${row.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
      done++;
      if (done % 200 === 0) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(
          `${done} read | fixed ${fixed} | unreadable ${unreadable} | failed ${failed} | ${rate.toFixed(1)}/s`,
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(
    `Done: read ${done}, fixed ${fixed}, unreadable ${unreadable}, failed ${failed}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
