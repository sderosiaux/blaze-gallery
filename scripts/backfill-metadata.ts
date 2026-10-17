/**
 * Fills photos.metadata (date taken, display dimensions, camera, GPS,
 * orientation) for every image that has none, from the first 64 KB of the
 * file (256 KB when the EXIF segment runs past it).
 *
 * Resumable: only rows with metadata IS NULL are picked, so re-running
 * continues where it stopped. Heads that hold nothing usable are marked
 * metadata_status = 'failed' and skipped afterwards; network errors leave the
 * row untouched for the next run.
 *
 * Uses its own S3 client on purpose: the app client logs every call into
 * s3_audit_logs, which would add one row per photo.
 *
 * Usage:
 *   npx tsx scripts/backfill-metadata.ts [--concurrency 16] [--limit N] [--dry-run]
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { probeWithReader } from "../src/lib/imageProbe";
import type { PhotoMetadata } from "../src/types";
import { out, requireEnv } from "./cli";

dotenv.config({ quiet: true });

interface Options {
  concurrency: number;
  limit: number;
  dryRun: boolean;
}

interface Counts {
  processed: number;
  withDimensions: number;
  withDate: number;
  withPreview: number;
  empty: number;
  errors: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { concurrency: 16, limit: Infinity, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--concurrency" || arg === "--limit") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${arg} expects a positive integer`);
      }
      if (arg === "--concurrency") options.concurrency = value;
      else options.limit = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** HTTP status the AWS SDK attached to a failure, when it did */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return undefined;
  }
  const meta = error.$metadata;
  return typeof meta === "object" &&
    meta !== null &&
    "httpStatusCode" in meta &&
    typeof meta.httpStatusCode === "number"
    ? meta.httpStatusCode
    : undefined;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const queue = items.entries();
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (const [index, item] of queue) {
        results[index] = await fn(item);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

type Outcome =
  | { id: string; kind: "metadata"; metadata: PhotoMetadata; preview: boolean }
  | { id: string; kind: "empty" }
  | { id: string; kind: "error"; message: string };

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bucket = requireEnv("BACKBLAZE_BUCKET");
  const s3 = new S3Client({
    endpoint: requireEnv("BACKBLAZE_ENDPOINT"),
    region: "us-east-1",
    forcePathStyle: true,
    maxAttempts: 4,
    credentials: {
      accessKeyId: requireEnv("BACKBLAZE_ACCESS_KEY"),
      secretAccessKey: requireEnv("BACKBLAZE_SECRET_KEY"),
    },
  });
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 4,
  });

  const readRange = (key: string) => async (start: number, end: number) => {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
        }),
      );
      return response.Body
        ? Buffer.from(await response.Body.transformToByteArray())
        : Buffer.alloc(0);
    } catch (error) {
      // Empty object: nothing to read
      if (httpStatus(error) === 416) return Buffer.alloc(0);
      throw error;
    }
  };

  const probe = async (row: {
    id: string;
    s3_key: string;
  }): Promise<Outcome> => {
    try {
      const result = await probeWithReader(readRange(row.s3_key));
      return result.metadata
        ? {
            id: row.id,
            kind: "metadata",
            metadata: result.metadata,
            preview: Boolean(result.preview),
          }
        : { id: row.id, kind: "empty" };
    } catch (error) {
      return {
        id: row.id,
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };

  // Set from the SIGINT handler: an object, so the loop below sees it change
  const signal = { stopping: false };
  process.on("SIGINT", () => {
    if (signal.stopping) process.exit(130);
    signal.stopping = true;
    out("\nStopping after the current batch (Ctrl-C again to abort now)");
  });

  const { rows: countRows } = await pool.query<{ remaining: number }>(
    `SELECT COUNT(*)::int AS remaining FROM photos
     WHERE metadata IS NULL AND metadata_status <> 'failed' AND mime_type LIKE 'image/%'`,
  );
  const remaining = countRows[0]?.remaining ?? 0;
  const target = Math.min(remaining, options.limit);
  out(
    `${remaining} images without metadata; processing ${target}` +
      ` (concurrency ${options.concurrency}${options.dryRun ? ", dry run" : ""})`,
  );

  const counts: Counts = {
    processed: 0,
    withDimensions: 0,
    withDate: 0,
    withPreview: 0,
    empty: 0,
    errors: 0,
  };
  const batchSize = Math.max(options.concurrency * 8, 100);
  const started = Date.now();
  let lastId = "0";

  while (!signal.stopping && counts.processed < target) {
    const { rows } = await pool.query<{ id: string; s3_key: string }>(
      `SELECT id, s3_key FROM photos
       WHERE metadata IS NULL AND metadata_status <> 'failed'
         AND mime_type LIKE 'image/%' AND id > $1
       ORDER BY id
       LIMIT $2`,
      [lastId, Math.min(batchSize, target - counts.processed)],
    );
    const lastRow = rows[rows.length - 1];
    if (lastRow === undefined) break;
    lastId = lastRow.id;

    const outcomes = await mapWithConcurrency(rows, options.concurrency, probe);
    const found = outcomes.filter(
      (o): o is Extract<Outcome, { kind: "metadata" }> => o.kind === "metadata",
    );
    const empty = outcomes.filter((o) => o.kind === "empty").map((o) => o.id);
    const errors = outcomes.filter(
      (o): o is Extract<Outcome, { kind: "error" }> => o.kind === "error",
    );

    if (!options.dryRun) {
      if (found.length > 0) {
        await pool.query(
          `UPDATE photos p
           SET metadata = v.metadata, metadata_status = 'extracted'
           FROM (SELECT unnest($1::bigint[]) AS id, unnest($2::jsonb[]) AS metadata) v
           WHERE p.id = v.id AND p.metadata IS NULL`,
          [
            found.map((o) => o.id),
            found.map((o) => JSON.stringify(o.metadata)),
          ],
        );
      }
      if (empty.length > 0) {
        await pool.query(
          `UPDATE photos SET metadata_status = 'failed'
           WHERE id = ANY($1::bigint[]) AND metadata IS NULL`,
          [empty],
        );
      }
    }

    counts.processed += rows.length;
    counts.withDimensions += found.filter((o) => o.metadata.dimensions).length;
    counts.withDate += found.filter((o) => o.metadata.date_taken).length;
    counts.withPreview += found.filter((o) => o.preview).length;
    counts.empty += empty.length;
    counts.errors += errors.length;
    for (const error of errors.slice(0, 3)) {
      out(`  error on photo ${error.id}: ${error.message}`);
    }

    const elapsed = (Date.now() - started) / 1000;
    const rate = counts.processed / elapsed;
    const eta =
      rate > 0 ? Math.round((target - counts.processed) / rate / 60) : 0;
    out(
      `${new Date().toISOString()} ${counts.processed}/${target}` +
        ` | dims ${counts.withDimensions} date ${counts.withDate} preview ${counts.withPreview}` +
        ` | empty ${counts.empty} errors ${counts.errors}` +
        ` | ${rate.toFixed(1)}/s, ~${eta} min left | last id ${lastId}`,
    );
  }

  out(
    `Done${options.dryRun ? " (dry run, nothing written)" : ""}: processed ${counts.processed},` +
      ` with dims ${counts.withDimensions}, with date ${counts.withDate},` +
      ` with preview ${counts.withPreview}, marked failed ${options.dryRun ? 0 : counts.empty}` +
      `${options.dryRun ? ` (would mark ${counts.empty})` : ""}, errors (left for next run) ${counts.errors}`,
  );

  await pool.end();
  s3.destroy();
}

main().catch((error) => {
  console.error(
    "Backfill failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
