/**
 * « Annuler » after « Restaurer celle-ci », on a real PostgreSQL: the
 * marks come from what the server kept at the restore, never from the
 * request, and the photo stays out when putting it back would hide its
 * stack or its photo kept is gone.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import type * as Database from "@/lib/database";
import type * as Trash from "@/lib/trash";
import type * as Route from "./route";
import { startTestDatabase, type TestDatabase } from "@/lib/testDatabase";

const APP = "https://photos.example";
let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let trash: typeof Trash;
let route: typeof Route;

before(async () => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: APP,
    GOOGLE_AUTH_ENABLED: "false",
  });
  db = await startTestDatabase();
  sql = db.client;
  database = await import("@/lib/database");
  trash = await import("@/lib/trash");
  route = await import("./route");
  await sql.query(
    `INSERT INTO folders (id, path, name) VALUES (1, 'trip', 'trip')`,
  );
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  for (const id of [1, 2])
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at,
         metadata, thumbnail_status)
       VALUES ($1, 1, $2, $3, 1000, 'image/jpeg', now(), '{}', 'generated')`,
      [id, `p${id}.jpg`, `trip/p${id}.jpg`],
    );
  await sql.query(
    `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
     VALUES (1, 1, 1, 1, 'centre', 1, '{}', 'test'), (2, 1, 2, 1, 'copy', 1, '{}', 'test')`,
  );
  // 2 thrown away 5 days ago in a lot, 1 kept in its place; then restored
  const lot = trash.newLot("auto", "copies.other");
  await database.runTransaction((client) =>
    trash.markTrashed(client, [{ id: 2, keep: 1 }], lot),
  );
  await sql.query(
    "UPDATE photos SET trashed_at = now() - interval '5 days' WHERE id = 2",
  );
  assert.equal(await trash.restorePhotos([2]), 1);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

const putBack = async (body: Record<string, unknown>) => {
  const response = await route.POST(
    new NextRequest(`${APP}/api/trash/put-back`, {
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

const marks = async (id: number) =>
  (
    await sql.query<{ days: number; by: string; batch: string; kept: number }>(
      `SELECT round(extract(epoch FROM now() - trashed_at) / 86400)::int AS days,
              trashed_by AS by, trash_batch AS batch, trashed_for::int AS kept
       FROM photos WHERE id = $1`,
      [id],
    )
  ).rows[0];

void describe("POST /api/trash/put-back", () => {
  void test("the marks the server kept, whatever the request says", async () => {
    // A forged request: a date of 2020 would have the next purge erase it
    const answer = await putBack({
      id: 2,
      trashed_at: "2020-01-01T00:00:00.000Z",
      trashed_by: "owner",
      trash_batch: "owner-photos-20200101T000000Z-0000",
      trashed_for: null,
    });
    assert.equal(answer.status, 200);
    const back = await marks(2);
    assert.equal(back?.days, 5);
    assert.equal(back.by, "auto");
    assert.match(back.batch, /^auto-copies\.other-/);
    assert.equal(back.kept, 1);
    // Once: the kept marks are used up
    await trash.restorePhotos([2]);
    await sql.query("DELETE FROM trash_undo");
    assert.equal((await putBack({ id: 2 })).data.code, "UNDO_EXPIRED");
  });

  void test("too late, or never restored: it stays in the gallery", async () => {
    await sql.query(
      "UPDATE trash_undo SET restored_at = now() - interval '16 minutes'",
    );
    const late = await putBack({ id: 2 });
    assert.deepEqual([late.status, late.data.code], [409, "UNDO_EXPIRED"]);
    assert.equal(
      (
        await sql.query(
          "SELECT 1 FROM photos WHERE id = 2 AND trashed_at IS NULL",
        )
      ).rowCount,
      1,
    );
  });

  void test("the photo kept thrown away meanwhile: 409, nothing moves", async () => {
    await trash.trashPhotos([1]);
    const answer = await putBack({ id: 2 });
    assert.deepEqual([answer.status, answer.data.code], [409, "KEPT_GONE"]);
    assert.equal(
      (
        await sql.query(
          "SELECT 1 FROM photos WHERE id = 2 AND trashed_at IS NULL",
        )
      ).rowCount,
      1,
    );
  });

  void test("while « Garder » or a pass holds the stacks: 409", async () => {
    await sql.query("SELECT pg_advisory_lock($1)", [0x626c617a6567]);
    try {
      const answer = await putBack({ id: 2 });
      assert.deepEqual(
        [answer.status, answer.data.code],
        [409, "PASS_RUNNING"],
      );
    } finally {
      await sql.query("SELECT pg_advisory_unlock($1)", [0x626c617a6567]);
    }
  });
});
