/**
 * The Corbeille on a real PostgreSQL (lib/testDatabase.ts): what throwing
 * away hides, what « Garder celle-ci » moves, what the purge erases, with
 * a storage stand-in that records every call.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import type * as Stacks from "./stacks";
import type * as Trash from "./trash";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let trash: typeof Trash;
let stacks: typeof Stacks;

const FOLDER = { id: 1, path: "2020 Voyage" };

async function photo(
  id: number,
  folder: { id: number; path: string },
  taken: string,
  extra: { favorite?: boolean; size?: number } = {},
) {
  await sql.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
       modified_at, metadata, thumbnail_status, thumbnail_path, is_favorite)
     VALUES ($1, $2, $3, $4, $5, 'image/jpeg', now(), $6, 'generated', $7, $8)`,
    [
      id,
      folder.id,
      `p${id}.jpg`,
      `${folder.path}/p${id}.jpg`,
      extra.size ?? 1000 + id,
      { date_taken: `${taken}.000Z` },
      `thumbnails/${folder.path}/p${id}.jpg`,
      extra.favorite ?? false,
    ],
  );
}

async function stack(members: number[]) {
  for (const [i, id] of members.entries())
    await sql.query(
      `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, measures, model)
       VALUES ($1, $2, $3, 1, $4, '{}', 'test')`,
      [id, members[0], i + 1, i === 0 ? "centre" : "burst"],
    );
}

const ids = (photos: { id: number | string }[]) =>
  photos.map((p) => Number(p.id));

const trashedIds = async () =>
  (
    await sql.query<{ id: number }>(
      "SELECT id::int AS id FROM photos WHERE trashed_at IS NOT NULL ORDER BY id",
    )
  ).rows.map((r) => r.id);

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  trash = await import("./trash");
  stacks = await import("./stacks");
  await sql.query(`INSERT INTO folders (id, path, name) VALUES
    (1, '2020 Voyage', '2020 Voyage'), (2, 'books', 'books')`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  // A burst of three, an exact pair, one alone
  await photo(301, FOLDER, "2020-05-01T10:00:00", { favorite: true });
  await photo(302, FOLDER, "2020-05-01T10:00:01", { favorite: true });
  await photo(303, FOLDER, "2020-05-01T10:00:02");
  await stack([301, 302, 303]);
  await photo(311, FOLDER, "2019-01-01T08:00:00", { size: 7777 });
  await photo(312, FOLDER, "2019-01-01T08:00:00", { size: 7777 });
  await sql.query(
    `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
     VALUES (311, 311, 1, 1, 'centre', 311, '{}', 'test'), (312, 311, 2, 1, 'copy', 311, '{}', 'test')`,
  );
  await photo(321, FOLDER, "2018-01-01T08:00:00");
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

/** Storage that records what the purge asks of it; `refuse` names keys it answers 403 to. */
function store(refuse: string[] = []) {
  const calls: string[] = [];
  const s: Trash.PurgeStore = {
    deleteOriginal: (key) => {
      calls.push(`original ${key}`);
      if (refuse.includes(key))
        return Promise.reject(
          Object.assign(new Error("not entitled"), {
            $metadata: { httpStatusCode: 403 },
          }),
        );
      return Promise.resolve(["v1", "v2"]);
    },
    deleteDerived: (photo) => {
      calls.push(`derived ${photo.s3_key}`);
      return Promise.resolve();
    },
  };
  return { s, calls };
}

void describe("the Corbeille", () => {
  void test("a photo thrown away leaves every list and its stack's front", async () => {
    assert.deepEqual(await trash.trashPhotos([301, 321]), [301, 321]);
    // Again: already there
    assert.deepEqual(await trash.trashPhotos([301]), []);
    const timeline = await database.getTimelinePhotos(
      null,
      50,
      database.NO_PHOTO_FILTER,
    );
    // 302 fronts the burst now, with the two photos left
    assert.deepEqual(ids(timeline), [302, 311]);
    assert.deepEqual(timeline[0]?.stack, { id: 301, count: 2 });
    const folder = await database.getPhotosInFolder(FOLDER.id, true);
    assert.deepEqual(ids(folder).sort(), [302, 311]);
    assert.deepEqual(ids(await database.getStackPhotos(303)), [302, 303]);
    // A list showing every file shows no thrown-away one either
    assert.ok(!ids(await database.getPhotosInFolder(FOLDER.id)).includes(301));
  });

  void test("restore one, or all", async () => {
    await trash.trashPhotos([301, 302, 321]);
    assert.equal(await trash.restorePhotos([302]), 1);
    assert.deepEqual(await trashedIds(), [301, 321]);
    assert.equal(await trash.restorePhotos("all"), 2);
    assert.deepEqual(await trashedIds(), []);
  });

  void test("the Corbeille lists the last thrown away first, page by page", async () => {
    await trash.trashPhotos([321]);
    await sql.query(
      "UPDATE photos SET trashed_at = now() - interval '1 day' WHERE id = 321",
    );
    await trash.trashPhotos([303]);
    const first = await trash.listTrash(null, 1);
    assert.equal(first.total, 2);
    assert.deepEqual(ids(first.photos), [303]);
    assert.ok(first.next);
    const rest = await trash.listTrash(first.next, 1);
    assert.deepEqual(ids(rest.photos), [321]);
    assert.equal(rest.next, null);
  });

  void test("« Garder celle-ci » throws the rest of the stack away, if the count still holds", async () => {
    const wrong = await trash.keepFromStacks([303], 1);
    assert.deepEqual(wrong, { ok: false, trashed: [], count: 2 });
    assert.deepEqual(await trashedIds(), []);
    const done = await trash.keepFromStacks([303, 312], 3);
    assert.equal(done.ok, true);
    assert.deepEqual(done.trashed.sort(), [301, 302, 311]);
    assert.deepEqual(await trashedIds(), [301, 302, 311]);
    // Kept photos stand alone: no stack badge
    const timeline = await database.getTimelinePhotos(
      null,
      50,
      database.NO_PHOTO_FILTER,
    );
    assert.deepEqual(ids(timeline), [303, 312, 321]);
    assert.ok(timeline.every((p) => p.stack === undefined));
  });

  void test("the Doublons page: stacks of each kind with their photos, best first", async () => {
    const all = await stacks.listStacks("all", null, 10);
    assert.deepEqual(
      all.stacks.map((s) => [s.id, ids(s.photos), s.copies]),
      [
        [301, [301, 302, 303], false],
        [311, [311, 312], true],
      ],
    );
    assert.deepEqual(all.total, { stacks: 2, extra: 3 });
    assert.deepEqual(
      (await stacks.listStacks("copies", null, 10)).stacks.map((s) => s.id),
      [311],
    );
    const paged = await stacks.listStacks("all", null, 1);
    assert.ok(paged.next);
    assert.deepEqual(
      (await stacks.listStacks("all", paged.next, 1)).stacks.map((s) => s.id),
      [311],
    );
    // A stack the Corbeille left with one photo is settled
    await trash.trashPhotos([312]);
    assert.deepEqual(
      (await stacks.listStacks("all", null, 10)).stacks.map((s) => s.id),
      [301],
    );
  });

  void test("the purge erases files then rows of what has waited, oldest first", async () => {
    await trash.trashPhotos([301, 321, 311]);
    await sql.query(
      "UPDATE photos SET trashed_at = now() - interval '40 days' WHERE id IN (301, 321)",
    );
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const { s, calls } = store();
    // Dry run: counts and lists, erases nothing
    const dry = await trash.purgeTrash(s, {
      cutoff,
      expected: 10,
      dryRun: true,
    });
    assert.deepEqual(
      [dry.selected, dry.purged.length, dry.remaining],
      [2, 0, 2],
    );
    assert.deepEqual(calls, []);
    // More than expected: refused before anything
    await assert.rejects(
      trash.purgeTrash(s, { cutoff, expected: 1 }),
      trash.PurgeRefused,
    );
    assert.deepEqual(calls, []);
    const report = await trash.purgeTrash(s, { cutoff, expected: 2, batch: 1 });
    assert.deepEqual(
      report.purged.map((p) => [p.id, p.versions]),
      [
        [301, 2],
        [321, 2],
      ],
    );
    assert.equal(report.remaining, 0);
    assert.deepEqual(calls, [
      "original 2020 Voyage/p301.jpg",
      "derived 2020 Voyage/p301.jpg",
      "original 2020 Voyage/p321.jpg",
      "derived 2020 Voyage/p321.jpg",
    ]);
    const left = await sql.query<{ id: number }>(
      "SELECT id::int AS id FROM photos ORDER BY id",
    );
    assert.deepEqual(
      left.rows.map((r) => r.id),
      [302, 303, 311, 312],
    );
    // 311 waited less than 30 days: still in the Corbeille
    assert.deepEqual(await trashedIds(), [311]);
  });

  void test("storage refusing a file stops the purge there; the photo stays", async () => {
    await trash.trashPhotos([301, 302]);
    const { s, calls } = store(["2020 Voyage/p301.jpg"]);
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 2,
    });
    assert.deepEqual(report.refused, {
      id: 301,
      s3_key: "2020 Voyage/p301.jpg",
      status: 403,
    });
    assert.deepEqual(report.purged, []);
    assert.deepEqual(calls, ["original 2020 Voyage/p301.jpg"]);
    assert.deepEqual(await trashedIds(), [301, 302]);
  });

  void test("a photo restored while the purge waits is not erased", async () => {
    await trash.trashPhotos([321]);
    const { s } = store();
    // The purge's cutoff was taken before the photo came back
    const cutoff = new Date();
    await trash.restorePhotos([321]);
    const report = await trash.purgeTrash(s, { cutoff, expected: 1 });
    assert.deepEqual(report.purged, []);
    assert.equal(
      (await sql.query("SELECT 1 FROM photos WHERE id = 321")).rowCount,
      1,
    );
  });
});
