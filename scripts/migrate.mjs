// @ts-check
/**
 * Applies db/schema.sql: creates whatever is missing, changes nothing else.
 *
 * The Docker image runs it before `node server.js` on every start, so a fresh
 * database is ready before the first request and an existing one is left as
 * it is. Outside Docker: `npm run db:migrate` once, then after each update.
 *
 * Plain JavaScript on purpose: the production image ships Next's standalone
 * output, which has `pg` but no TypeScript runner.
 */
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

// Same number for every instance: two containers starting together take turns.
// Transaction-scoped: behind a transaction pooler (Neon's pooled endpoint) a
// session lock outlives this script on the shared server connection and blocks
// every later migration.
const MIGRATION_LOCK = 7_235_101;

/** @param {pg.Client} client */
async function applySchema(client) {
  const schema = readFileSync(
    new URL("../db/schema.sql", import.meta.url),
    "utf8",
  );
  await client.query("BEGIN");
  try {
    // Fail instead of waiting forever behind a long write on an existing table
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await client.query(schema);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // TLS follows the URL: sslmode=require for a hosted database, disable on
  // the compose network.
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await applySchema(client);
  } finally {
    await client.end();
  }
  process.stdout.write("[migrate] schema up to date\n");
}

main().catch((/** @type {unknown} */ error) => {
  process.stderr.write(
    `[migrate] failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
