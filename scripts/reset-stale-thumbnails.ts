/**
 * Clears thumbnails generated before thumbnail v2 so they are rebuilt on next view:
 * - RAW files, whose thumbnail was the 160×120 strip of IFD0 (now read from the
 *   embedded JPEG);
 * - photos with EXIF orientation 5–8, whose thumbnail was stored lying down
 *   (sharp did not apply the orientation).
 *
 * Deletes the stored thumbnail object and resets the row to thumbnail_status 'none'.
 *
 * One-shot migration to thumbnail v2, applied on 2026-10-17 (765 rows). It cannot
 * tell v1 from v2 thumbnails, so running it again only regenerates good ones:
 * it reports by default and writes only with --apply.
 *
 * Usage: npx tsx scripts/reset-stale-thumbnails.ts [--apply] [--limit N]
 */

import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const limitIndex = args.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : undefined;
const known = new Set(["--apply", "--limit"]);
for (const [i, arg] of args.entries()) {
  const isLimitValue = i > 0 && args[i - 1] === "--limit";
  if (!known.has(arg) && !isLimitValue) {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("--limit expects a positive integer");
  process.exit(2);
}

const RAW = String.raw`lower(filename) ~ '\.(nef|nrw|cr2|arw|srf|sr2|dng|orf|pef|srw|3fr|erf|kdc|mrw|iiq)$'`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storageIsS3 = process.env.THUMBNAIL_STORAGE === "s3";
const r2 = storageIsS3
  ? new S3Client({
      endpoint: process.env.THUMBNAIL_S3_ENDPOINT,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.THUMBNAIL_S3_ACCESS_KEY!,
        secretAccessKey: process.env.THUMBNAIL_S3_SECRET_KEY!,
      },
    })
  : null;

async function main() {
  const { rows } = await pool.query<{
    id: string;
    thumbnail_path: string | null;
    reason: string;
  }>(
    `SELECT id, thumbnail_path,
            CASE WHEN ${RAW} THEN 'raw' ELSE 'rotated' END AS reason
     FROM photos
     WHERE thumbnail_status = 'generated'
       AND (${RAW} OR (metadata->>'orientation')::int BETWEEN 5 AND 8)
     ORDER BY id
     ${limit ? `LIMIT ${limit}` : ""}`,
  );

  const byReason = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `${rows.length} thumbnails to reset`,
    byReason,
    dryRun ? "(report only, pass --apply to write)" : "",
  );
  if (dryRun) return;

  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.thumbnail_path && r2) {
        await r2.send(
          new DeleteObjectCommand({
            Bucket: process.env.THUMBNAIL_S3_BUCKET,
            Key: row.thumbnail_path,
          }),
        );
        deleted++;
      }
      await pool.query(
        `UPDATE photos SET thumbnail_path = NULL, thumbnail_status = 'none' WHERE id = $1`,
        [row.id],
      );
    } catch (error) {
      failed++;
      console.error(
        `photo ${row.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  console.log(
    `reset ${rows.length - failed}, objects deleted ${deleted}, failed ${failed}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
