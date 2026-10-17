/**
 * Creates the index behind /api/timeline (keyset on date_taken, id).
 * CONCURRENTLY: no write lock on photos while it builds. Idempotent.
 *
 * Usage: npx tsx scripts/create-timeline-index.ts
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { out } from "./cli";

dotenv.config({ quiet: true });

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const started = Date.now();
    await pool.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_photos_date_taken
      ON photos (((metadata->>'date_taken')), id)
      WHERE (metadata->>'date_taken') IS NOT NULL
    `);
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_photos_date_taken'`,
    );
    out(`${rows[0]?.indexdef ?? "index missing"} (${Date.now() - started} ms)`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Failed to create timeline index:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
