/**
 * npm run etags on a real PostgreSQL (lib/testDatabase.ts), the bucket
 * listing given page by page: what it counts, what it writes, and what it
 * never touches.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type { ListingPage } from "./bucketDiff";
import type * as Database from "./database";
import type * as Etags from "./etags";
import type { S3Object } from "./s3";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let etags: typeof Etags;

const MAY = new Date("2024-05-01T12:00:00.000Z");
const md5 = (c: string) => c.repeat(32);

const object = (key: string, etag: string, size = 100): S3Object => ({
  key,
  size,
  lastModified: MAY,
  etag,
});

/** A lister over `pages`, the last one closing the listing */
const lister =
  (pages: S3Object[][]): Etags.Lister =>
  (token) => {
    const at = token === undefined ? 0 : Number(token);
    const objects = pages[at] ?? [];
    const last = at >= pages.length - 1;
    return Promise.resolve<ListingPage>({
      objects,
      isTruncated: !last,
      nextContinuationToken: last ? undefined : String(at + 1),
    });
  };

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  etags = await import("./etags");
  await sql.query(
    `INSERT INTO folders (id, path, name) VALUES (1, 'trip', 'trip')`,
  );
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  for (const [id, etag] of [
    [1, null],
    [2, md5("a")],
    [3, md5("b")],
    [4, null],
    [5, null],
    [6, null],
  ] as const)
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at, etag)
       VALUES ($1, 1, $2, $3, 100, 'image/jpeg', $4, $5)`,
      [id, `p${id}.jpg`, `trip/p${id}.jpg`, MAY.toISOString(), etag],
    );
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

const BUCKET = [
  [
    object("trip/p1.jpg", md5("1")),
    object("trip/p2.jpg", md5("a")),
    // Stored b: left as it is
    object("trip/p3.jpg", md5("c")),
  ],
  [
    // Replaced since the last sync: the sync's to handle
    object("trip/p4.jpg", md5("4"), 999),
    object("trip/notes.txt", md5("n")),
    // A multipart upload
    object("trip/p6.jpg", "0123456789abcdef-3"),
  ],
];

const etagOf = async (id: number) =>
  (
    await sql.query<{ etag: string | null }>(
      "SELECT etag FROM photos WHERE id = $1",
      [id],
    )
  ).rows[0]?.etag;

void describe("npm run etags", () => {
  void test("counts what it would write, and why it leaves the others", async () => {
    const plan = await etags.planEtags(lister(BUCKET));
    assert.deepEqual(
      {
        listed: plan.listed,
        matched: plan.matched,
        alreadySet: plan.alreadySet,
        toSet: plan.toSet.map((t) => t.id),
        conflicts: plan.conflicts.map((c) => c.id),
        stale: plan.stale,
        bucketOnly: plan.bucketOnly,
        photoOnly: plan.photoOnly,
        multipart: plan.multipart,
      },
      {
        listed: 6,
        matched: 5,
        alreadySet: 1,
        toSet: [1, 6],
        conflicts: [3],
        stale: 1,
        bucketOnly: 1,
        photoOnly: 1,
        multipart: 1,
      },
    );
  });

  void test("writes only the missing ETags, nothing else", async () => {
    const plan = await etags.planEtags(lister(BUCKET));
    const { before, after, written } = await etags.applyEtags(plan);
    assert.equal(written, 2);
    assert.equal(after.with_etag, before.with_etag + 2);
    assert.equal(after.others, before.others);
    assert.equal(await etagOf(1), md5("1"));
    assert.equal(await etagOf(6), "0123456789abcdef-3");
    // Never overwritten
    assert.equal(await etagOf(3), md5("b"));
    assert.equal(await etagOf(4), null);
  });

  void test("a folder first: only its photos and its keys", async () => {
    await sql.query(
      `INSERT INTO folders (id, path, name) VALUES (2, 'other', 'other') ON CONFLICT DO NOTHING`,
    );
    await sql.query(
      `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type, modified_at)
       VALUES (9, 2, 'q.jpg', 'other/q.jpg', 100, 'image/jpeg', $1)`,
      [MAY.toISOString()],
    );
    const plan = await etags.planEtags(
      lister([[object("other/q.jpg", md5("9"))]]),
      "other/",
    );
    assert.deepEqual(
      [plan.matched, plan.photoOnly, plan.toSet.map((t) => t.id)],
      [1, 0, [9]],
    );
  });

  void test("a listing cut short writes nothing", async () => {
    const cut: Etags.Lister = () =>
      Promise.resolve({
        objects: [object("trip/p1.jpg", md5("1"))],
        isTruncated: true,
      });
    await assert.rejects(etags.planEtags(cut), /before its last page/);
  });
});
