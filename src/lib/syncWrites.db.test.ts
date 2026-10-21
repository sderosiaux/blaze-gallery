/**
 * What the sync writes over a photo of the Corbeille, on a real PostgreSQL
 * (lib/testDatabase.ts): the same file listed again keeps it there, a new
 * file on its key brings it back (the purge would erase it), and the
 * bucket's ETag is kept for the exact-copy rule.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;

const MAY = "2024-05-01T12:00:00.000Z";
const JUNE = "2024-06-01T12:00:00.000Z";

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  await sql.query(
    `INSERT INTO folders (id, path, name) VALUES (1, 'trip', 'trip')`,
  );
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  await sql.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at,
       metadata, metadata_status, thumbnail_status, etag,
       trashed_at, trashed_by, trash_batch, trashed_for)
     VALUES (7, 1, 'a.jpg', 'trip/a.jpg', 100, 'image/jpeg', $1,
       '{"camera_model": "X"}', 'extracted', 'generated', $2,
       now(), 'auto', 'auto-copies-x', 8)`,
    [MAY, null],
  );
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

async function row() {
  const result = await sql.query<{
    etag: string | null;
    trashed: boolean;
    by: string | null;
    batch: string | null;
    kept: string | null;
    metadata_status: string;
  }>(
    `SELECT etag, trashed_at IS NOT NULL AS trashed, trashed_by AS by,
            trash_batch AS batch, trashed_for::text AS kept, metadata_status
     FROM photos WHERE id = 7`,
  );
  return result.rows[0];
}

const upsert = (size: number, modified: string, etag: string) =>
  database.createOrUpdatePhoto({
    folder_id: 1,
    filename: "a.jpg",
    s3_key: "trip/a.jpg",
    size,
    mime_type: "image/jpeg",
    modified_at: modified,
    etag,
  });

void describe("the sync over the Corbeille", () => {
  void test("the same file listed again stays in the Corbeille, and gets its ETag", async () => {
    await upsert(100, MAY, '"abc"');
    assert.deepEqual(await row(), {
      etag: "abc",
      trashed: true,
      by: "auto",
      batch: "auto-copies-x",
      kept: "8",
      metadata_status: "extracted",
    });
  });

  void test("a new file on the key comes back from the Corbeille", async () => {
    await upsert(200, JUNE, "def");
    assert.deepEqual(await row(), {
      etag: "def",
      trashed: false,
      by: null,
      batch: null,
      kept: null,
      metadata_status: "none",
    });
  });

  void test("another ETag at the same size and date is a new file too", async () => {
    await sql.query("UPDATE photos SET etag = 'abc' WHERE id = 7");
    await upsert(100, MAY, "abd");
    const now = await row();
    assert.ok(now);
    assert.equal(now.trashed, false);
    assert.equal(now.etag, "abd");
  });

  void test("a replaced file from the full scan comes back from the Corbeille", async () => {
    await database.resetReplacedPhotos([
      {
        id: 7,
        size: 300,
        modified_at: JUNE,
        etag: "ghi",
        thumbnail_status: "pending",
      },
    ]);
    assert.deepEqual(await row(), {
      etag: "ghi",
      trashed: false,
      by: null,
      batch: null,
      kept: null,
      metadata_status: "none",
    });
  });

  void test("a new photo keeps the ETag it was listed with", async () => {
    await database.insertNewPhotos([
      {
        folder_id: 1,
        filename: "b.jpg",
        s3_key: "trip/b.jpg",
        size: 10,
        mime_type: "image/jpeg",
        modified_at: MAY,
        etag: "0123",
        metadata_status: "none",
        thumbnail_status: "pending",
      },
    ]);
    const result = await sql.query<{ etag: string }>(
      "SELECT etag FROM photos WHERE s3_key = 'trip/b.jpg'",
    );
    assert.equal(result.rows[0]?.etag, "0123");
  });
});
