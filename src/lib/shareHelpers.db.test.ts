/**
 * A share link and the Corbeille, on a real PostgreSQL (lib/testDatabase.ts):
 * the thumbnail, preview, display, view and download routes all ask
 * validateSharedPhotoAccess, which must not serve a photo thrown away.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { NextRequest } from "next/server";
import type { Client } from "pg";
import type * as Database from "./database";
import type * as ShareHelpers from "./shareHelpers";
import type * as Trash from "./trash";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let shares: typeof ShareHelpers;
let trash: typeof Trash;

const request = () =>
  new NextRequest("http://localhost/api/shares/link/thumbnail/1");

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  shares = await import("./shareHelpers");
  trash = await import("./trash");
  await sql.query(
    `INSERT INTO folders (id, path, name) VALUES (1, '2020 Voyage', '2020 Voyage')`,
  );
  for (const id of [1, 2])
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at)
       VALUES ($1, 1, $2, $3, 1000, 'image/jpeg', now())`,
      [id, `p${id}.jpg`, `2020 Voyage/p${id}.jpg`],
    );
  await sql.query(
    `INSERT INTO shared_folders (folder_id, share_token, folder_path) VALUES (1, 'link', '2020 Voyage')`,
  );
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

void describe("a share link", () => {
  void test("serves no photo in the Corbeille, and serves it again once back", async () => {
    assert.equal(
      (await shares.validateSharedPhotoAccess(request(), "link", "1")).error,
      undefined,
    );
    await trash.trashPhotos([1]);
    for (const check of [
      shares.validateSharedPhotoAccess,
      shares.validateSharedThumbnailAccess,
    ]) {
      const refused = await check(request(), "link", "1");
      assert.equal(refused.error?.status, 404);
      assert.equal(refused.photo, null);
    }
    // Its neighbour still shows
    assert.equal(
      (await shares.validateSharedPhotoAccess(request(), "link", "2")).error,
      undefined,
    );
    await trash.restorePhotos([1]);
    assert.equal(
      (await shares.validateSharedPhotoAccess(request(), "link", "1")).error,
      undefined,
    );
  });
});
