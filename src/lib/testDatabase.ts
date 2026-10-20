/**
 * A real PostgreSQL for the tests that run SQL: pgvector's image (the
 * version production runs), db/schema.sql applied as scripts/migrate.mjs
 * applies it, DATABASE_URL pointing at it before lib/database.ts opens its
 * pool. Needs Docker; each test file gets its own database.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export interface TestDatabase {
  /** A connection of the test's own, for fixtures */
  client: Client;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    "pgvector/pgvector:pg17",
  ).start();
  const url = container.getConnectionUri();
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"),
  );
  process.env.DATABASE_URL = url;
  return {
    client,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}
