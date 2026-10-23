import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import type * as Database from "@/lib/database";
import type * as Trash from "@/lib/trash";
import type * as Route from "./route";
import { startTestDatabase, type TestDatabase } from "@/lib/testDatabase";

const APP = "https://photos.example";
let db: TestDatabase;
let database: typeof Database;
let trash: typeof Trash;
let route: typeof Route;

before(async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: APP,
    GOOGLE_AUTH_ENABLED: "false",
  });
  db = await startTestDatabase();
  database = await import("@/lib/database");
  trash = await import("@/lib/trash");
  route = await import("./route");
  await db.client.query(
    "INSERT INTO folders (id, path, name) VALUES (1, 'trip', 'trip')",
  );
});

async function stacks(count: number) {
  await db.client.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
       modified_at, metadata, thumbnail_status, etag)
     SELECT id, 1, 'p' || id || '.jpg', 'trip/p' || id || '.jpg', 1000,
       'image/jpeg', now(), '{}', 'generated', md5(((id + 1) / 2)::text)
     FROM generate_series(1, $1::int * 2) id`,
    [count],
  );
  // No embeddings: these copies are identified by their file's MD5.
  await db.client.query(
    `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
     SELECT id, ((id + 1) / 2) * 2 - 1, 2 - id % 2, 1,
       CASE WHEN id % 2 = 1 THEN 'centre' ELSE 'copy' END,
       ((id + 1) / 2) * 2 - 1, '{}', 'test' FROM photos`,
  );
}

beforeEach(async () => {
  await db.client.query(
    "TRUNCATE photos, excluded_folders, task_leases CASCADE",
  );
  await stacks(30);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

async function post(body: Record<string, unknown>, origin = APP) {
  const response = await route.POST(
    new NextRequest(`${APP}/api/stacks/copies`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    data: (await response.json()) as Record<string, unknown>,
  };
}

const selection = { keep: [] as number[], skip: [] as number[] };
const preview = (choices = selection) =>
  post({ action: "preview", ...choices });
const apply = (signature: unknown, choices = selection) =>
  post({ action: "trash", ...choices, signature });
const countTrashed = async () =>
  Number(
    (
      await db.client.query<{ count: string }>(
        "SELECT count(*) FROM photos WHERE trashed_at IS NOT NULL",
      )
    ).rows[0]?.count,
  );

void test("all pages, chosen keeper, skipped stack, and one undo for the whole lot", async () => {
  const choices = { keep: [2], skip: [3] };
  const shown = await preview(choices);
  assert.equal(shown.status, 200);
  assert.equal(shown.data.count, 29);
  assert.equal(shown.data.stacks, 29);
  assert.equal(await countTrashed(), 0);
  const done = await apply(shown.data.signature, choices);
  assert.equal(done.status, 200);
  assert.equal(done.data.count, 29);
  assert.match(String(done.data.lot), /^owner-copies-/);
  assert.equal(await countTrashed(), 29);
  const first = await db.client.query(
    `SELECT id::int, trashed_at IS NOT NULL AS trashed, trashed_for::int AS kept
     FROM photos WHERE id <= 4 ORDER BY id`,
  );
  assert.deepEqual(first.rows, [
    { id: 1, trashed: true, kept: 2 },
    { id: 2, trashed: false, kept: null },
    { id: 3, trashed: false, kept: null },
    { id: 4, trashed: false, kept: null },
  ]);
  const empty = await db.client.query(
    `SELECT group_id FROM photo_groups g JOIN photos p ON p.id = g.photo_id
     GROUP BY group_id HAVING count(*) FILTER (WHERE trashed_at IS NULL) = 0`,
  );
  assert.equal(empty.rowCount, 0);
  assert.equal((await apply(shown.data.signature, choices)).status, 409);
  assert.equal(await trash.restoreLot(String(done.data.lot)), 29);
  assert.equal(await countTrashed(), 0);
});

void test("more than the 5000-photo manual batch limit, without pagination or partial writes", async () => {
  await db.client.query("TRUNCATE photos CASCADE");
  await stacks(5001);
  const shown = await preview();
  assert.equal(shown.data.count, 5001);
  const done = await apply(shown.data.signature);
  assert.equal(done.status, 200);
  assert.equal(await countTrashed(), 5001);
  assert.equal(await trash.restoreLot(String(done.data.lot)), 5001);
});

void test("only the strict Copies identiques tab: no mixed, unknown, multipart, excluded or trashed pairs", async () => {
  await db.client.query(
    "UPDATE photos SET etag = md5('different') WHERE id = 4",
  );
  await db.client.query("UPDATE photos SET etag = NULL WHERE id = 6");
  await db.client.query("UPDATE photos SET etag = etag || '-2' WHERE id = 8");
  await db.client.query(
    "UPDATE photo_groups SET copy_of = NULL WHERE photo_id = 10",
  );
  await db.client.query(
    "UPDATE photos SET s3_key = 'books/' || filename WHERE id IN (11, 12)",
  );
  await db.client.query("INSERT INTO excluded_folders (path) VALUES ('books')");
  await trash.trashPhotos([14]);
  await db.client.query(
    "UPDATE photo_groups SET copy_of = 16 WHERE photo_id = 16",
  );
  const shown = await preview();
  assert.equal(shown.data.count, 23);
  const listed = await (
    await import("@/lib/stacks")
  ).listStacks("copies", null, 24);
  assert.equal(shown.data.count, listed.total.extra);
  assert.equal(shown.data.stacks, listed.total.stacks);
  assert.equal((await apply(shown.data.signature)).status, 200);
  const untouched = await db.client.query(
    "SELECT id FROM photos WHERE id BETWEEN 3 AND 16 AND id <> 14 AND trashed_at IS NOT NULL",
  );
  assert.equal(untouched.rowCount, 0);
});

void test("a different keeper with the same total invalidates the preview", async () => {
  const shown = await preview();
  const changed = await apply(shown.data.signature, { keep: [2], skip: [] });
  assert.deepEqual(
    [changed.status, changed.data.code],
    [409, "STACKS_CHANGED"],
  );
  assert.equal(await countTrashed(), 0);
});

void test("changed content, newly added copies, and already trashed photos invalidate the preview", async () => {
  for (const change of [
    "UPDATE photos SET etag = md5('new file') WHERE id IN (1, 2)",
    "INSERT INTO photo_groups SELECT 61, 1, 3, 1, 'copy', 1, '{}', 'test'",
    "UPDATE photos SET trashed_at = now() WHERE id = 4",
  ]) {
    const shown = await preview();
    if (change.startsWith("INSERT"))
      await db.client.query(
        `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at, etag)
         SELECT 61, 1, 'new.jpg', 'trip/new.jpg', size, mime_type, now(), etag FROM photos WHERE id = 1`,
      );
    await db.client.query(change);
    const beforeCount = await countTrashed();
    const done = await apply(shown.data.signature);
    assert.deepEqual([done.status, done.data.code], [409, "STACKS_CHANGED"]);
    assert.equal(await countTrashed(), beforeCount);
  }
});

void test("invalid choices never silently replace a chosen keeper", async () => {
  for (const keep of [[999], [1, 2]]) {
    assert.equal(
      (await preview({ keep, skip: [] })).data.code,
      "STACKS_CHANGED",
    );
  }
  assert.equal(await countTrashed(), 0);
});

void test("group rebuild lock and worker lease both refuse the write", async () => {
  const shown = await preview();
  await db.client.query("SELECT pg_advisory_lock($1)", [0x626c617a6567]);
  try {
    assert.equal((await apply(shown.data.signature)).data.code, "PASS_RUNNING");
  } finally {
    await db.client.query("SELECT pg_advisory_unlock($1)", [0x626c617a6567]);
  }
  await db.client.query(
    "INSERT INTO task_leases VALUES ('groups', 'test', now() + interval '1 minute')",
  );
  assert.equal((await apply(shown.data.signature)).data.code, "PASS_RUNNING");
  assert.equal(await countTrashed(), 0);
});

void test("concurrent trash of a keeper rolls the whole operation back", async () => {
  const shown = await preview();
  await db.client.query("BEGIN");
  await db.client.query("UPDATE photos SET trashed_at = now() WHERE id = 1");
  const pending = apply(shown.data.signature);
  try {
    // Wait until the apply is waiting for this keeper's row lock.
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      await db.client.query("SELECT pg_stat_clear_snapshot()");
      const active = await db.client.query(
        "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM photos%FOR UPDATE'",
      );
      waiting = active.rows.length > 0;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
  } finally {
    await db.client.query("COMMIT");
  }
  const done = await pending;
  assert.deepEqual([done.status, done.data.code], [409, "STACKS_CHANGED"]);
  assert.equal(await countTrashed(), 1);
});

void test("origin, request shape, preview signature and authentication are required", async () => {
  assert.equal(
    (
      await post(
        { action: "preview", ...selection },
        "https://elsewhere.example",
      )
    ).status,
    403,
  );
  for (const body of [
    {},
    { action: "preview", keep: [-1], skip: [] },
    { action: "preview", keep: [], skip: "all" },
    { action: "trash", ...selection },
    { action: "trash", ...selection, signature: "invalid" },
  ])
    assert.equal((await post(body)).status, 400);
  const { authConfig } = await import("@/lib/auth/config");
  authConfig.enabled = true;
  try {
    assert.equal((await preview()).status, 401);
  } finally {
    authConfig.enabled = false;
  }
  assert.equal(await countTrashed(), 0);
});
