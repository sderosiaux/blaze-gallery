/**
 * The Corbeille on a real PostgreSQL (lib/testDatabase.ts): what throwing
 * away hides, what « Garder celle-ci » moves, what the purge erases, with
 * a storage stand-in that records every call.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import type * as Keep from "./keep";
import type { FileVersion } from "./s3";
import type * as Stacks from "./stacks";
import type * as Trash from "./trash";
import { GROUPS_LOCK } from "./groupsLock";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let trash: typeof Trash;
let stacks: typeof Stacks;
let keep: typeof Keep;

const FOLDER = { id: 1, path: "2020 Voyage" };

const vector = (size: number, at: (i: number) => number) =>
  `[${Array.from({ length: size }, (_, i) => at(i)).join(",")}]`;

/**
 * A photo of the Canon (4000×3000), its embedding along axis `look`
 * (photos of one look: cosine 1; of two: 0).
 */
async function photo(
  id: number,
  folder: { id: number; path: string },
  taken: string,
  extra: {
    favorite?: boolean;
    size?: number;
    look?: number;
    width?: number;
    height?: number;
  } = {},
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
      {
        date_taken: `${taken}.000Z`,
        dimensions: {
          width: extra.width ?? 4000,
          height: extra.height ?? 3000,
        },
        camera: { make: "Canon", model: "R6" },
      },
      `thumbnails/${folder.path}/p${id}.jpg`,
      extra.favorite ?? false,
    ],
  );
  const look = extra.look ?? 0;
  await sql.query(
    `INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES ($1, $2, 'siglip')`,
    [id, vector(768, (i) => (i === look ? 1 : 0))],
  );
}

/** A face of the photo, named `person` (manual) or no one, its embedding along axis `look`. */
async function face(photoId: number, person: number | null, look: number) {
  await sql.query(
    `INSERT INTO faces (photo_id, box, landmarks, det_score, width_px, height_px,
       sharpness, yaw, pitch, embedding, model, person_id, assignment)
     VALUES ($1, '{0.1,0.1,0.2,0.2}', '{0,0,0,0,0,0,0,0,0,0}', 0.9, 200, 200,
       100, 0, 0, $2, 'arcface', $3, $4)`,
    [
      photoId,
      vector(512, (i) => (i === look ? 1 : 0)),
      person,
      person === null ? null : "manual",
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
  keep = await import("./keep");
  await sql.query(`INSERT INTO folders (id, path, name) VALUES
    (1, '2020 Voyage', '2020 Voyage'), (2, 'books', 'books')`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  await sql.query(`INSERT INTO people (id, name) VALUES (1, 'A'), (2, 'B')`);
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

const LONG_AGO = new Date("2000-01-01T00:00:00Z");

/**
 * A bucket that records what the purge asks of it. Each key holds two
 * versions written long ago, the second served, unless `written` dates it
 * otherwise. `refuse`: keys whose deletes it answers 403 to; `stuck`: keys
 * whose deletes it acknowledges but keeps; `missing`: keys it neither
 * lists nor serves; `unlisted`: keys it serves but lists no version of.
 */
function store(
  options: {
    refuse?: string[];
    stuck?: string[];
    missing?: string[];
    unlisted?: string[];
    written?: Record<string, Date>;
  } = {},
) {
  const calls: string[] = [];
  const erased = new Set<string>();
  const has = (list: string[] | undefined, key: string) =>
    list?.includes(key) ?? false;
  const s: Trash.PurgeStore = {
    versions: (key) => {
      calls.push(`versions ${key}`);
      const none =
        (erased.has(key) && !has(options.stuck, key)) ||
        has(options.missing, key) ||
        has(options.unlisted, key);
      const versions: FileVersion[] = none
        ? []
        : [
            { id: "v1", latest: false, marker: false, lastModified: LONG_AGO },
            {
              id: "v2",
              latest: true,
              marker: false,
              lastModified: options.written?.[key] ?? LONG_AGO,
            },
          ];
      return Promise.resolve(versions);
    },
    deleteVersions: (key, versionIds) => {
      calls.push(`delete ${key} ${versionIds.join(",")}`);
      if (has(options.refuse, key))
        return Promise.reject(
          Object.assign(new Error("not entitled"), {
            $metadata: { httpStatusCode: 403 },
          }),
        );
      erased.add(key);
      return Promise.resolve();
    },
    exists: (key) => {
      calls.push(`exists ${key}`);
      return Promise.resolve(has(options.unlisted, key));
    },
    deleteDerived: (photo) => {
      calls.push(`derived ${photo.s3_key}`);
      return Promise.resolve();
    },
  };
  return { s, calls };
}

/** The calls of a photo erased: listed, its versions deleted older first, listed again, then its thumbnail. */
const erasing = (key: string) => [
  `versions ${key}`,
  `delete ${key} v1,v2`,
  `versions ${key}`,
  `derived ${key}`,
];

/** A share link that showed photo `id`, its access log naming it. */
async function shareLog(id: number) {
  await sql.query(
    `INSERT INTO shared_folders (id, folder_id, share_token, folder_path)
     VALUES (1, 1, 'token', '2020 Voyage') ON CONFLICT DO NOTHING`,
  );
  await sql.query(
    `INSERT INTO share_access_logs (shared_folder_id, photo_id, access_type) VALUES (1, $1, 'view')`,
    [id],
  );
}

const loggedPhoto = async () =>
  (
    await sql.query<{ photo: number | null }>(
      "SELECT photo_id::int AS photo FROM share_access_logs",
    )
  ).rows.map((r) => r.photo);

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
    // The folder's card counts what the folder shows: 302 and 311
    const card = (await database.getFolders()).find(
      (f) => f.path === FOLDER.path,
    );
    assert.equal(card?.photo_count, 2);
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
    // Counted now, by the database's clock
    assert.ok(Math.abs(Date.parse(first.as_of) - Date.now()) < 60_000);
    // « Vider »: all, or what has waited TRASH_DAYS, with the space it frees
    assert.equal(first.bytes, 1321 + 1303);
    assert.deepEqual([first.due, first.due_bytes], [0, 0]);
    await sql.query(
      "UPDATE photos SET trashed_at = now() - interval '31 days' WHERE id = 321",
    );
    const aged = await trash.listTrash(null, 1);
    assert.deepEqual([aged.due, aged.due_bytes], [1, 1321]);
    assert.equal(
      Date.parse(aged.as_of) - Date.parse(aged.due_cutoff),
      trash.TRASH_DAYS * 86_400_000,
    );
    assert.deepEqual(ids(first.photos), [303]);
    assert.ok(first.next);
    const rest = await trash.listTrash(first.next, 1);
    assert.deepEqual(ids(rest.photos), [321]);
    assert.equal(rest.next, null);
  });

  void test("« Garder celle-ci » throws the rest of the stack away, if it is still what the owner saw", async () => {
    // One fewer than the stack holds, then as many but not the same
    const fewer = await trash.keepFromStacks([303], [301]);
    assert.deepEqual(fewer, { ok: false, trashed: [], count: 2 });
    const other = await trash.keepFromStacks([303], [301, 321]);
    assert.deepEqual(other, { ok: false, trashed: [], count: 2 });
    assert.deepEqual(await trashedIds(), []);
    const done = await trash.keepFromStacks([303, 312], [311, 302, 301]);
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

  void test("« Garder » throws away only the photos linked to the one kept, and says so first", async () => {
    // A star around 331: 332 twenty seconds after it, 333 twenty before,
    // forty seconds from each other; 334 of another moment, five seconds in
    await photo(331, FOLDER, "2021-03-01T10:00:00");
    await photo(332, FOLDER, "2021-03-01T10:00:20");
    await photo(333, FOLDER, "2021-03-01T09:59:40");
    await photo(334, FOLDER, "2021-03-01T10:00:05", { look: 1 });
    await stack([331, 332, 333, 334]);
    assert.deepEqual(await keep.previewKeep([332, 303]), {
      332: [331],
      303: [301, 302],
    });
    // Sent as the whole stack, as before: refused
    const all = await trash.keepFromStacks([332], [331, 333, 334]);
    assert.deepEqual(all, { ok: false, trashed: [], count: 1 });
    const done = await trash.keepFromStacks([332], [331]);
    assert.deepEqual(done, { ok: true, trashed: [331], count: 1 });
    assert.deepEqual(ids(await database.getStackPhotos(332)), [332, 333, 334]);
  });

  void test("two « Garder » at once on one stack: the second waits, then sees the first", async () => {
    // Another « Garder », keeping 301: it holds the stack's rows
    await sql.query("BEGIN");
    await sql.query(
      "SELECT id FROM photos WHERE id IN (301, 302, 303) ORDER BY id FOR UPDATE",
    );
    let settled = false;
    const second = trash.keepFromStacks([302], [301, 303]).finally(() => {
      settled = true;
    });
    for (const deadline = Date.now() + 10_000; ; ) {
      // Inside a transaction the statistics views keep their first read
      await sql.query("SELECT pg_stat_clear_snapshot()");
      const waiting = await sql.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT p.id FROM photos p JOIN photo_groups m%'`,
      );
      if (waiting.rowCount === 1) break;
      assert.ok(!settled, "the second « Garder » did not wait");
      assert.ok(Date.now() < deadline, "the second « Garder » never waited");
      await new Promise((resolve) => setImmediate(resolve));
    }
    await sql.query(
      "UPDATE photos SET trashed_at = now() WHERE id IN (302, 303)",
    );
    await sql.query("COMMIT");
    // What it was shown going is not what goes now: nothing moves
    assert.deepEqual(await second, { ok: false, trashed: [], count: 1 });
    assert.deepEqual(ids(await database.getStackPhotos(301)), [301]);
  });

  void test("« Garder » takes neither another shape nor a larger photo away", async () => {
    await photo(371, FOLDER, "2021-06-01T10:00:00");
    await photo(372, FOLDER, "2021-06-01T10:00:02");
    // A crop, and an export larger than the photo kept, both with its EXIF time
    await photo(373, FOLDER, "2021-06-01T10:00:02", {
      width: 4000,
      height: 2000,
    });
    await photo(374, FOLDER, "2021-06-01T10:00:01", {
      width: 6000,
      height: 4500,
    });
    await stack([371, 372, 373, 374]);
    assert.deepEqual(await keep.previewKeep([371]), { 371: [372] });
  });

  void test("« Garder » links a burst by the shot's own time, not a fallback EXIF date", async () => {
    await photo(361, FOLDER, "2021-05-01T10:00:00");
    await photo(362, FOLDER, "2021-05-01T10:00:02");
    await photo(363, FOLDER, "2021-05-01T10:00:02");
    await sql.query(
      `UPDATE photos SET metadata = metadata || '{"date_tag": "DateTime"}' WHERE id = 363`,
    );
    await stack([361, 362, 363]);
    // 362 has no date_tag (probed before it was recorded): as before
    assert.deepEqual(await keep.previewKeep([361]), { 361: [362] });
  });

  void test("« Garder » waits for no pass: while one holds the groups lock it moves nothing", async () => {
    await sql.query("SELECT pg_advisory_lock($1)", [GROUPS_LOCK]);
    try {
      assert.deepEqual(await trash.keepFromStacks([302], [301, 303]), {
        ok: false,
        trashed: [],
        count: 0,
        passRunning: true,
      });
    } finally {
      await sql.query("SELECT pg_advisory_unlock($1)", [GROUPS_LOCK]);
    }
    assert.deepEqual(await trashedIds(), []);
  });

  void test("« Garder » refuses to leave a stack with no photo of the gallery", async () => {
    await photo(341, { id: 2, path: "books" }, "2021-04-01T10:00:00");
    await photo(342, FOLDER, "2021-04-01T10:00:01");
    await stack([341, 342]);
    assert.deepEqual(await keep.previewKeep([341]), { 341: [342] });
    const result = await trash.keepFromStacks([341], [342]);
    assert.deepEqual(result, { ok: false, trashed: [], count: 1 });
    assert.deepEqual(await trashedIds(), []);
  });

  void test("« Garder » moves the names of the faces going onto the photo kept", async () => {
    await photo(351, FOLDER, "2021-05-01T10:00:00");
    await photo(352, FOLDER, "2021-05-01T10:00:01");
    await stack([351, 352]);
    // A named on both sides' same face; B only on the one going, its face
    // unlike any of the photo kept
    await face(351, null, 0);
    await face(352, 1, 0);
    await face(352, 2, 7);
    assert.equal((await trash.keepFromStacks([351], [352])).ok, true);
    const named = await sql.query<{
      photo: number;
      person: number;
      assignment: string;
    }>(
      `SELECT photo_id::int AS photo, person_id::int AS person, assignment FROM faces
       WHERE person_id IS NOT NULL ORDER BY photo_id, person_id`,
    );
    assert.deepEqual(
      named.rows.map((r) => [r.photo, r.person, r.assignment]),
      [
        [351, 1, "manual"],
        [352, 1, "manual"],
        [352, 2, "manual"],
      ],
    );
  });

  void test("the Doublons page: stacks of each kind with their photos, best first", async () => {
    // Copies by their rank, but no MD5 read yet: not shown as the same file
    assert.deepEqual(
      (await stacks.listStacks("copies", null, 10)).stacks.map((s) => s.id),
      [],
    );
    await sql.query("UPDATE photos SET etag = $1 WHERE id IN (311, 312)", [
      "c".repeat(32),
    ]);
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
    // Another MD5, or a multipart upload's: not the same file
    for (const etag of ["d".repeat(32), "0123456789abcdef-2"]) {
      await sql.query("UPDATE photos SET etag = $1 WHERE id = 312", [etag]);
      assert.deepEqual(
        (await stacks.listStacks("bursts", null, 10)).stacks.map((s) => s.id),
        [301, 311],
      );
    }
    await sql.query("UPDATE photos SET etag = $1 WHERE id = 312", [
      "c".repeat(32),
    ]);
    const paged = await stacks.listStacks("all", null, 1);
    assert.ok(paged.next);
    assert.deepEqual(
      (await stacks.listStacks("all", paged.next, 1)).stacks.map((s) => s.id),
      [311],
    );
    // Ranks count the photos the gallery shows: 301 gone, 302 is first
    await trash.trashPhotos([301]);
    const [burst] = (await stacks.listStacks("bursts", null, 10)).stacks;
    assert.deepEqual(
      burst?.photos.map((p) => [p.id, p.rank]),
      [
        [302, 1],
        [303, 2],
      ],
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
    const report = await trash.purgeTrash(s, { cutoff, expected: 2 });
    assert.deepEqual(
      report.purged.map((p) => [p.id, p.versions]),
      [
        [301, 2],
        [321, 2],
      ],
    );
    assert.equal(report.remaining, 0);
    assert.deepEqual(calls, [
      ...erasing("2020 Voyage/p301.jpg"),
      ...erasing("2020 Voyage/p321.jpg"),
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

  void test("storage refusing a file stops the purge there; the photo and its share log stay", async () => {
    await trash.trashPhotos([301, 302]);
    await shareLog(301);
    const { s, calls } = store({ refuse: ["2020 Voyage/p301.jpg"] });
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
    assert.deepEqual(calls, [
      "versions 2020 Voyage/p301.jpg",
      "delete 2020 Voyage/p301.jpg v1,v2",
    ]);
    // The row went before the file: rolled back with the log's change
    assert.deepEqual(await trashedIds(), [301, 302]);
    assert.deepEqual(await loggedPhoto(), [301]);
  });

  void test("a photo a share link showed is erased, its access log kept without it", async () => {
    await trash.trashPhotos([301]);
    await shareLog(301);
    const { s } = store();
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 1,
    });
    assert.deepEqual(ids(report.purged), [301]);
    assert.deepEqual(await loggedPhoto(), [null]);
  });

  void test("a file written again after it was thrown away is left; the others go", async () => {
    await trash.trashPhotos([301, 302]);
    const { s, calls } = store({
      written: { "2020 Voyage/p301.jpg": new Date(Date.now() + 60_000) },
    });
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(Date.now() + 1000),
      expected: 2,
    });
    assert.deepEqual(report.left, [
      { id: 301, s3_key: "2020 Voyage/p301.jpg", reason: "reuploaded" },
    ]);
    assert.deepEqual(ids(report.purged), [302]);
    assert.ok(!calls.some((c) => c.startsWith("delete 2020 Voyage/p301.jpg")));
    assert.deepEqual(await trashedIds(), [301]);
    assert.equal(report.remaining, 1);
  });

  void test("no file in the bucket is not erased: left, and three in a row stop the purge", async () => {
    await trash.trashPhotos([301, 302, 303, 311]);
    const keys = [301, 302, 303, 311].map((id) => `2020 Voyage/p${id}.jpg`);
    const { s, calls } = store({ missing: keys });
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 4,
    });
    assert.deepEqual(
      report.left.map((p) => [p.id, p.reason]),
      [
        [301, "missing"],
        [302, "missing"],
        [303, "missing"],
      ],
    );
    assert.deepEqual(report.stopped, {
      id: 303,
      s3_key: "2020 Voyage/p303.jpg",
      reason: "missing",
    });
    // Never reached, nothing deleted, every row there
    assert.ok(!calls.some((c) => c.includes("p311")));
    assert.ok(!calls.some((c) => c.startsWith("delete")));
    assert.deepEqual(await trashedIds(), [301, 302, 303, 311]);
  });

  void test("a file served but not listed stops the purge at once", async () => {
    await trash.trashPhotos([301, 302]);
    const { s, calls } = store({ unlisted: ["2020 Voyage/p301.jpg"] });
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 2,
    });
    assert.deepEqual(report.stopped, {
      id: 301,
      s3_key: "2020 Voyage/p301.jpg",
      reason: "listing",
    });
    assert.deepEqual(calls, [
      "versions 2020 Voyage/p301.jpg",
      "exists 2020 Voyage/p301.jpg",
    ]);
    assert.deepEqual(await trashedIds(), [301, 302]);
  });

  void test("versions still listed once deleted roll the photo back and stop the purge", async () => {
    await trash.trashPhotos([301, 302]);
    const { s } = store({ stuck: ["2020 Voyage/p301.jpg"] });
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 2,
    });
    assert.equal(report.stopped?.reason, "remains");
    assert.deepEqual(report.purged, []);
    assert.deepEqual(await trashedIds(), [301, 302]);
  });

  void test("a purge by batches: at most `limit` photos", async () => {
    await trash.trashPhotos([301, 302, 303]);
    const { s } = store();
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 3,
      limit: 2,
    });
    assert.deepEqual(ids(report.purged), [301, 302]);
    assert.equal(report.remaining, 1);
  });

  void test("a thumbnail left behind does not stop the purge", async () => {
    await trash.trashPhotos([301, 302]);
    const { s, calls } = store();
    s.deleteDerived = (photo) => {
      calls.push(`derived ${photo.s3_key}`);
      return Promise.reject(new Error("thumbnail storage down"));
    };
    const report = await trash.purgeTrash(s, {
      cutoff: new Date(),
      expected: 2,
    });
    assert.deepEqual(ids(report.purged), [301, 302]);
    assert.equal(report.refused, null);
    assert.equal(calls.length, 8);
    assert.deepEqual(await trashedIds(), []);
  });

  void test("a restore while the purge erases that photo's file waits, then finds nothing", async () => {
    await trash.trashPhotos([321]);
    const { s } = store();
    let begun: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deleteVersions = s.deleteVersions;
    s.deleteVersions = async (key, versionIds) => {
      begun();
      await held;
      return deleteVersions(key, versionIds);
    };
    const purge = trash.purgeTrash(s, { cutoff: new Date(), expected: 1 });
    await started;
    let settled = false;
    const restore = trash.restorePhotos([321]).finally(() => {
      settled = true;
    });
    // The restore waits on the row the purge holds
    for (const deadline = Date.now() + 10_000; ; ) {
      const waiting = await sql.query(
        `SELECT 1 FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE 'SELECT id FROM photos WHERE id = ANY%FOR UPDATE'`,
      );
      if (waiting.rowCount === 1) break;
      assert.ok(!settled, "the restore did not wait for the purge");
      assert.ok(Date.now() < deadline, "the restore never waited");
      await new Promise((resolve) => setImmediate(resolve));
    }
    release();
    assert.deepEqual(ids((await purge).purged), [321]);
    assert.equal(await restore, 0);
    assert.equal(
      (await sql.query("SELECT 1 FROM photos WHERE id = 321")).rowCount,
      0,
    );
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

  void test("the proof: the photo kept in its place, and whether the bucket says it is the same file", async () => {
    const md5 = "0123456789abcdef0123456789abcdef";
    await sql.query("UPDATE photos SET etag = $1 WHERE id IN (311, 312)", [
      md5,
    ]);
    const lot = trash.newLot("auto", "copies.other");
    await database.runTransaction((client) =>
      trash.markTrashed(client, [{ id: 312, keep: 311 }], lot),
    );
    const proof = await trash.trashProof(312);
    assert.ok(proof);
    assert.equal(proof.photo.id, 312);
    assert.equal(proof.photo.trash_batch, lot.batch);
    assert.equal(proof.kept?.id, 311);
    assert.equal(proof.kept_state, "present");
    assert.equal(proof.same_bytes, true);
    assert.equal(proof.photo.size, 7777);
    assert.equal(proof.kept.folder_path, FOLDER.path);
    // The Corbeille's tile knows its kept photo without asking
    const listed = await trash.listTrash(null, 10);
    assert.deepEqual(listed.photos[0]?.kept, {
      id: 311,
      trashed: false,
      rotation: 0,
    });
    // Another MD5 says two files; a multipart ETag says nothing
    await sql.query("UPDATE photos SET etag = $1 WHERE id = 311", [
      "fedcba9876543210fedcba9876543210",
    ]);
    assert.equal((await trash.trashProof(312))?.same_bytes, false);
    await sql.query("UPDATE photos SET etag = $1 WHERE id = 311", [
      "0123456789abcdef0123456789abcdef-3",
    ]);
    assert.equal((await trash.trashProof(312))?.same_bytes, null);
    // The kept photo thrown away since, then gone; a photo thrown alone
    await trash.trashPhotos([311]);
    assert.equal((await trash.trashProof(312))?.kept_state, "trashed");
    await sql.query("DELETE FROM photos WHERE id = 311");
    const gone = await trash.trashProof(312);
    assert.deepEqual([gone?.kept, gone?.kept_state], [null, "gone"]);
    await trash.trashPhotos([321]);
    assert.equal((await trash.trashProof(321))?.kept_state, "none");
    // Not in the Corbeille: no proof
    assert.equal(await trash.trashProof(301), null);
  });

  void test("« Annuler » after « Restaurer celle-ci » puts back the marks the server kept, its date too", async () => {
    const lot = trash.newLot("auto", "copies.other");
    await database.runTransaction((client) =>
      trash.markTrashed(client, [{ id: 312, keep: 311 }], lot),
    );
    await sql.query(
      "UPDATE photos SET trashed_at = now() - interval '5 days' WHERE id = 312",
    );
    const proof = await trash.trashProof(312);
    assert.ok(proof);
    assert.equal(await trash.restorePhotos([312]), 1);
    assert.deepEqual(await trash.putBack(312), { ok: true });
    const back = await trash.trashProof(312);
    assert.equal(back?.photo.trashed_at, proof.photo.trashed_at);
    assert.equal(back.photo.trash_batch, lot.batch);
    assert.equal(back.kept?.id, 311);
    // Already in the Corbeille again, its kept marks used: left as it is
    assert.deepEqual(await trash.putBack(312), {
      ok: false,
      refused: "expired",
    });
  });
});
