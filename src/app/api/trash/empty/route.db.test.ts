/**
 * « Vider » on the server, on a real PostgreSQL: the cutoff it imposes and
 * the exact count it requires. Every case is refused or erases nothing,
 * so no storage is reached.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import type * as Database from "@/lib/database";
import type * as Route from "./route";
import { startTestDatabase, type TestDatabase } from "@/lib/testDatabase";

const APP = "https://photos.example";
let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let route: typeof Route;

before(async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: APP,
    GOOGLE_AUTH_ENABLED: "false",
  });
  db = await startTestDatabase();
  sql = db.client;
  database = await import("@/lib/database");
  route = await import("./route");
  await sql.query(
    `INSERT INTO folders (id, path, name) VALUES (1, 'trip', 'trip')`,
  );
  for (const [id, days] of [
    [1, 40],
    [2, 0],
  ] as const)
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at,
         metadata, thumbnail_status, trashed_at)
       VALUES ($1, 1, $2, $3, 1000, 'image/jpeg', now(), '{}', 'generated',
         now() - make_interval(days => $4))`,
      [id, `p${id}.jpg`, `trip/p${id}.jpg`, days],
    );
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

const empty = async (body: Record<string, unknown>) => {
  const response = await route.POST(
    new NextRequest(`${APP}/api/trash/empty`, {
      method: "POST",
      headers: { origin: APP, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
};

// The database's clock: the route checks a cutoff against it, and this
// machine's may run ahead of a container's
const now = async () =>
  (await sql.query<{ t: Date }>("SELECT now() AS t")).rows[0]?.t.toISOString();

void describe("POST /api/trash/empty", () => {
  void test("without all, only what has waited 30 days, and exactly the count shown", async () => {
    // By default the cutoff is 30 days ago: photo 1 only, not 2
    assert.equal((await empty({ expected: 2 })).status, 409);
    const changed = await empty({ expected: 0 });
    assert.equal(changed.status, 409);
    assert.equal(changed.data.code, "TRASH_CHANGED");
    // A cutoff later than 30 days ago needs all
    assert.equal(
      (await empty({ expected: 2, cutoff: await now() })).status,
      400,
    );
  });

  void test("all: everything up to the listing's time, never later than now", async () => {
    assert.equal((await empty({ expected: 2, all: true })).status, 400);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    assert.equal(
      (await empty({ expected: 2, all: true, cutoff: later })).status,
      400,
    );
    // Both are due up to now: one fewer or one more is refused
    assert.equal(
      (await empty({ expected: 1, all: true, cutoff: await now() })).status,
      409,
    );
    assert.equal(
      (await empty({ expected: 3, all: true, cutoff: await now() })).status,
      409,
    );
    // Nothing erased by any of these
    const left = await sql.query("SELECT 1 FROM photos");
    assert.equal(left.rowCount, 2);
  });

  void test("nothing due: an exact zero erases nothing and says so", async () => {
    const early = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const done = await empty({ expected: 0, cutoff: early });
    assert.equal(done.status, 200);
    assert.deepEqual([done.data.purged, done.data.remaining], [0, 0]);
  });
});
