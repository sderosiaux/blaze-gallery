/**
 * npm run dedupe's passes on a real PostgreSQL (lib/testDatabase.ts): what
 * each pass throws away, what each hold keeps, and that applying refuses a
 * plan the database no longer gives.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type * as AutoTrash from "./autoTrash";
import type * as Database from "./database";
import type * as Trash from "./trash";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let auto: typeof AutoTrash;
let trash: typeof Trash;

const TRIP = { id: 1, path: "2020 Voyage" };
const SHARED = { id: 2, path: "Partage" };
const BOOKS = { id: 3, path: "books" };

const vector = (size: number, at: (i: number) => number) =>
  `[${Array.from({ length: size }, (_, i) => at(i)).join(",")}]`;

async function photo(
  id: number,
  folder: { id: number; path: string },
  extra: {
    favorite?: boolean;
    width?: number;
    height?: number;
    thumbnail?: string;
  } = {},
) {
  await sql.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
       modified_at, metadata, thumbnail_status, thumbnail_path, is_favorite)
     VALUES ($1, $2, $3, $4, 1000, 'image/jpeg', now(), $5, $6, $7, $8)`,
    [
      id,
      folder.id,
      `p${id}.jpg`,
      `${folder.path}/p${id}.jpg`,
      {
        date_taken: "2020-05-01T10:00:00.000Z",
        dimensions: {
          width: extra.width ?? 4000,
          height: extra.height ?? 3000,
        },
      },
      extra.thumbnail ?? "generated",
      `thumbnails/${folder.path}/p${id}.jpg`,
      extra.favorite ?? false,
    ],
  );
}

/** A stack: [id, score, copy_of] best first. */
async function stack(members: [number, number, number | null][]) {
  const [first] = members;
  if (!first) return;
  for (const [i, [id, score, copyOf]] of members.entries())
    await sql.query(
      `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', 'test')`,
      [
        id,
        first[0],
        i + 1,
        score,
        i === 0 ? "centre" : copyOf ? "copy" : "burst",
        copyOf,
      ],
    );
}

async function face(photoId: number, person: number) {
  await sql.query(
    `INSERT INTO faces (photo_id, box, landmarks, det_score, width_px, height_px,
       sharpness, yaw, pitch, embedding, model, person_id, assignment, expression_scores)
     VALUES ($1, '{0.1,0.1,0.2,0.2}', '{0,0,0,0,0,0,0,0,0,0}', 0.9, 200, 200,
       100, 0, 0, $2, 'arcface', $3, 'manual', '{0,0,0,0,0.5,0.5,0,0}')`,
    [photoId, vector(512, () => 0.04), person],
  );
}

const pairs = (candidates: AutoTrash.Candidate[]) =>
  candidates.map((c) => [c.id, c.keep, ...c.holds]);

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  auto = await import("./autoTrash");
  trash = await import("./trash");
  await sql.query(`INSERT INTO folders (id, path, name) VALUES
    (1, '2020 Voyage', '2020 Voyage'), (2, 'Partage', 'Partage'), (3, 'books', 'books')`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  await sql.query(
    `INSERT INTO shared_folders (folder_id, share_token, folder_path) VALUES (2, 't', 'Partage')`,
  );
  await sql.query(`INSERT INTO people (id, name) VALUES (1, 'A'), (2, 'B')`);
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  // Copies: one goes; a favourite stays; one in a shared folder stays
  await photo(401, TRIP);
  await photo(402, TRIP);
  await stack([
    [401, 2, 401],
    [402, 2, 401],
  ]);
  await photo(411, TRIP);
  await photo(412, TRIP, { favorite: true });
  await stack([
    [411, 2, 411],
    [412, 2, 411],
  ]);
  await photo(421, TRIP);
  await photo(422, SHARED);
  await stack([
    [421, 2, 421],
    [422, 2, 421],
  ]);
  // A burst: one clearly behind goes, the others stay for a reason each;
  // 437 copies 431, left to the copies pass
  await photo(431, TRIP);
  await photo(432, TRIP);
  await photo(433, TRIP);
  await photo(434, TRIP, { width: 4000, height: 2000 });
  await photo(435, TRIP, { width: 6000, height: 4500 });
  await photo(437, TRIP);
  await stack([
    [431, 3, 431],
    [437, 3, 431],
    [433, 2.8, null],
    [432, 2, null],
    [434, 1, null],
    [435, 1, null],
  ]);
  // The photo kept has no thumbnail yet
  await photo(441, TRIP, { thumbnail: "pending" });
  await photo(442, TRIP);
  await stack([
    [441, 3, null],
    [442, 1, null],
  ]);
  // People: someone not on the photo kept, then faces at all
  await photo(471, TRIP);
  await photo(472, TRIP);
  await photo(473, TRIP);
  await face(471, 1);
  await face(472, 1);
  await face(472, 2);
  await face(473, 1);
  await stack([
    [471, 3, null],
    [472, 1, null],
    [473, 1, null],
  ]);
  // Out of the gallery: neither kept nor thrown away
  await photo(451, BOOKS);
  await photo(452, TRIP);
  await photo(453, TRIP);
  await stack([
    [451, 3, null],
    [452, 2, null],
    [453, 1, null],
  ]);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

void describe("npm run dedupe", () => {
  void test("copies: of one file, the copy ranked first stays", async () => {
    const plan = await auto.planDedupe("copies");
    assert.deepEqual(pairs(plan.go), [
      [402, 401],
      [437, 431],
    ]);
    assert.deepEqual(pairs(plan.held), [
      [412, 411, "favorite"],
      [422, 421, "shared"],
    ]);
  });

  void test("copies: one goes only when the bucket vouches for the same bytes", async () => {
    const sums: Record<string, string | null> = {
      "2020 Voyage/p401.jpg": "a",
      "2020 Voyage/p402.jpg": "a",
      "2020 Voyage/p431.jpg": "b",
      // A multipart upload: no MD5 to compare
      "2020 Voyage/p437.jpg": null,
    };
    const plan = await auto.verifyCopies(
      await auto.planDedupe("copies"),
      (key) => Promise.resolve(sums[key] ?? null),
    );
    assert.deepEqual(pairs(plan.go), [[402, 401]]);
    assert.deepEqual(
      pairs(plan.held).map((c) => c.join(" ")),
      ["412 411 favorite", "422 421 shared", "437 431 bytes"],
    );
  });

  void test("near: the front stays, a photo clearly behind it goes, any doubt keeps one", async () => {
    const plan = await auto.planDedupe("near");
    // 451 is out of the gallery: 452 fronts its stack, 453 trails it by 1
    assert.deepEqual(pairs(plan.go), [
      [432, 431],
      [453, 452],
    ]);
    // 437, a copy of the front, is the copies pass's
    assert.deepEqual(pairs(plan.held), [
      [433, 431, "close"],
      [434, 431, "crop"],
      [435, 431, "larger"],
      [442, 441, "kept_thumbnail"],
      [472, 471, "person", "faces"],
      [473, 471, "faces"],
    ]);
  });

  void test("a pass is one lot of 'auto', each photo naming the one kept, put back whole", async () => {
    const plan = await auto.planDedupe("copies");
    // The copies in another folder than the photo kept: none here
    assert.deepEqual(auto.inFolders(plan, false).go, []);
    const { lot, trashed } = await auto.applyDedupe(auto.inFolders(plan, true));
    assert.equal(lot.by, "auto");
    assert.match(lot.batch, /^auto-copies\.same-/);
    assert.deepEqual(trashed.sort(), [402, 437]);
    const marks = await sql.query<{
      id: number;
      by: string;
      batch: string;
      kept: number;
    }>(
      `SELECT id::int AS id, trashed_by AS by, trash_batch AS batch, trashed_for::int AS kept
       FROM photos WHERE trashed_at IS NOT NULL ORDER BY id`,
    );
    assert.deepEqual(
      marks.rows.map((r) => [r.id, r.by, r.batch, r.kept]),
      [
        [402, "auto", lot.batch, 401],
        [437, "auto", lot.batch, 431],
      ],
    );
    const lots = await trash.listLots();
    assert.deepEqual(
      lots.map((l) => [l.batch, l.by, l.photos, l.stacks]),
      [[lot.batch, "auto", 2, 2]],
    );
    const page = await trash.listLotStacks(lot.batch, null, 1);
    assert.equal(page.stacks[0]?.kept?.id, 401);
    assert.deepEqual(
      page.stacks[0]?.trashed.map((p) => p.id),
      [402],
    );
    assert.equal(page.next, 401);
    const rest = await trash.listLotStacks(lot.batch, page.next, 1);
    assert.equal(rest.stacks[0]?.kept?.id, 431);
    assert.equal(rest.next, null);
    // Again: nothing left to throw away
    assert.deepEqual((await auto.planDedupe("copies")).go, []);
    assert.equal(await trash.restoreLot(lot.batch), 2);
    const left = await sql.query(
      "SELECT 1 FROM photos WHERE trashed_at IS NOT NULL OR trash_batch IS NOT NULL OR trashed_for IS NOT NULL",
    );
    assert.equal(left.rowCount, 0);
  });

  void test("a plan the database no longer gives writes nothing", async () => {
    const plan = await auto.planDedupe("near");
    await sql.query("UPDATE photos SET is_favorite = true WHERE id = 432");
    await assert.rejects(auto.applyDedupe(plan), auto.DedupeRefused);
    const marked = await sql.query(
      "SELECT 1 FROM photos WHERE trashed_at IS NOT NULL",
    );
    assert.equal(marked.rowCount, 0);
  });

  void test("no pass while a groups worker runs", async () => {
    const plan = await auto.planDedupe("copies");
    await sql.query("SELECT pg_advisory_lock($1)", [0x626c617a6567]);
    try {
      await assert.rejects(auto.applyDedupe(plan), /groups worker/);
    } finally {
      await sql.query("SELECT pg_advisory_unlock($1)", [0x626c617a6567]);
    }
  });
});
