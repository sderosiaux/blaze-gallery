/**
 * Stacks of near-duplicates (photo_groups) in every list, on a real
 * PostgreSQL (lib/testDatabase.ts): one tile per stack, the best member the
 * list keeps, and the stack's size.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import type { PhotoFilter } from "./database";
import type * as People from "./people";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let people: typeof People;

const MODEL = "test-model";
const vector = (size: number, at: (i: number) => number) =>
  `[${Array.from({ length: size }, (_, i) => at(i)).join(",")}]`;
const near = (similarity: number) =>
  vector(768, (i) =>
    i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity ** 2) : 0,
  );

const CELINE = 4;
const SUZIE = 1;

const TRIP = { id: 1, path: "2020-05-01 Voyage" };
const DUMP = { id: 2, path: "A TRIER" };
const BOOKS = { id: 3, path: "books" };

async function photo(
  id: number,
  folder: { id: number; path: string },
  filename: string,
  taken: string | null,
  extra: { favorite?: boolean; size?: number; location?: boolean } = {},
) {
  const metadata = {
    ...(taken ? { date_taken: `${taken}.000Z` } : {}),
    ...(extra.location
      ? { location: { latitude: 48.85, longitude: 2.35 } }
      : {}),
  };
  await sql.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
       modified_at, metadata, thumbnail_status, is_favorite)
     VALUES ($1, $2, $3, $4, $5, 'image/jpeg', now(), $6, 'generated', $7)`,
    [
      id,
      folder.id,
      filename,
      `${folder.path}/${filename}`,
      extra.size ?? 1000 + id,
      metadata,
      extra.favorite ?? false,
    ],
  );
  await sql.query(
    `INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES ($1, $2, $3)`,
    [
      id,
      near(id === 202 ? 0.91 : id === 231 ? 0.5 : 0.9 - (id % 10) / 100),
      MODEL,
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

async function blue(photoId: number, share: number) {
  const hues = Array.from({ length: 12 }, (_, i) =>
    i === 5 ? share : (1 - share) / 11,
  );
  await sql.query(
    `INSERT INTO photo_colors (photo_id, hues, palette_hex, palette_share,
       colorfulness, chroma, luminance, monochrome, center_sigma, model)
     VALUES ($1, $2, '{#2050c0}', '{1}', 40, 20, 50, false, 0.4, 'test')`,
    [photoId, hues],
  );
}

/** A stack: its members in rank order, the first one its centre. */
async function stack(members: number[], copyOf: number | null = null) {
  const [centre] = members;
  for (const [i, id] of members.entries())
    await sql.query(
      `INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
       VALUES ($1, $2, $3, $4, $5, $6, '{}', 'test')`,
      [
        id,
        centre,
        i + 1,
        10 - i,
        i === 0 ? "centre" : copyOf ? "copy" : "burst",
        copyOf,
      ],
    );
}

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  people = await import("./people");

  await sql.query(`INSERT INTO folders (id, path, name, parent_id) VALUES
    (1, '2020-05-01 Voyage', '2020-05-01 Voyage', NULL),
    (2, 'A TRIER', 'A TRIER', NULL),
    (3, 'books', 'books', NULL)`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  await sql.query(
    `INSERT INTO people (id, name) VALUES (1, 'Suzie'), (4, 'Céline')`,
  );

  // A burst: 201 is the one to keep; Céline is found on 202 only; 201 and
  // 202 on the map; 203 holds little blue
  await photo(201, TRIP, "IMG_0001.jpg", "2020-05-01T10:00:05", {
    location: true,
    favorite: true,
  });
  await photo(202, TRIP, "IMG_0002 (1).jpg", "2020-05-01T10:00:00", {
    location: true,
    favorite: true,
  });
  await photo(203, TRIP, "IMG_0003.jpg", "2020-05-01T10:00:09");
  await face(202, CELINE);
  await blue(201, 0.5);
  await blue(202, 0.6);
  await blue(203, 0.01);
  await stack([201, 202, 203]);

  // Exact copies: the dump's is ranked first, the trip's folder dates it
  await photo(211, DUMP, "x.jpg", "2019-01-01T08:00:00", { size: 5000 });
  await photo(212, TRIP, "x.jpg", "2019-01-01T08:00:00", { size: 5000 });
  await face(211, SUZIE);
  await face(212, SUZIE);
  await stack([211, 212], 211);

  // A stack whose best photo is now out of the gallery
  await photo(221, BOOKS, "y.jpg", "2018-01-01T08:00:00");
  await photo(222, TRIP, "y2.jpg", "2018-01-01T08:00:01");
  await stack([221, 222]);

  // Alone
  await photo(231, TRIP, "z.jpg", "2017-01-01T08:00:00");

  // A burst stacked before its folder left the gallery
  await photo(241, BOOKS, "b1.jpg", "2016-01-01T08:00:00");
  await photo(242, BOOKS, "b2.jpg", "2016-01-01T08:00:01");
  await stack([241, 242]);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

const filter = (parts: Partial<PhotoFilter>): PhotoFilter => ({
  ...database.NO_PHOTO_FILTER,
  ...parts,
});

const ids = (photos: { id: number | string }[]) =>
  photos.map((p) => Number(p.id));

void describe("stacks", () => {
  void test("the timeline: one tile per stack, its best photo, its size in the gallery", async () => {
    const photos = await database.getTimelinePhotos(null, 50, filter({}));
    assert.deepEqual(ids(photos), [201, 211, 222, 231]);
    assert.deepEqual(photos[0]?.stack, { id: 201, count: 3 });
    assert.deepEqual(photos[1]?.stack, { id: 211, count: 2 });
    // Its other photo is out of the gallery: a stack of one shows no badge
    assert.equal(photos[2]?.stack, undefined);
    assert.equal(photos[3]?.stack, undefined);
  });

  void test("a filter that keeps part of a stack shows the best of what it keeps", async () => {
    const photos = await database.getTimelinePhotos(
      null,
      50,
      filter({ people: [CELINE] }),
    );
    assert.deepEqual(ids(photos), [202]);
    // The tile still opens the whole stack
    assert.deepEqual(photos[0]?.stack, { id: 201, count: 3 });
  });

  void test("pages of one never show a stack twice", async () => {
    const seen: number[] = [];
    let cursor: Database.TimelineCursor | null = null;
    for (;;) {
      const page: Database.TimelinePhoto[] = await database.getTimelinePhotos(
        cursor,
        1,
        filter({}),
      );
      const last = page[0];
      if (!last) break;
      seen.push(Number(last.id));
      cursor = {
        dateTaken: String(last.metadata?.date_taken),
        id: Number(last.id),
      };
    }
    assert.deepEqual(seen, [201, 211, 222, 231]);
  });

  void test("months and totals count a stack once", async () => {
    const summary = await database.getTimelineSummary(filter({}));
    assert.deepEqual(summary.months, [
      { month: "2020-05", count: 1 },
      { month: "2019-01", count: 1 },
      { month: "2018-01", count: 1 },
      { month: "2017-01", count: 1 },
    ]);
    assert.equal(summary.total_photos, 4);
  });

  void test("the map", async () => {
    const points = await database.getMapPoints(
      { from: null, to: null },
      filter({}),
    );
    assert.deepEqual(
      points.map((p) => p[2]),
      [1],
    );
    const box = { south: 48, west: 2, north: 49, east: 3 };
    const photos = await database.getMapPhotos(
      box,
      { from: null, to: null },
      null,
      10,
      filter({}),
    );
    assert.deepEqual(ids(photos), [201]);
    assert.equal(
      await database.countMapPhotos(box, { from: null, to: null }, filter({})),
      1,
    );
  });

  void test("ranked by color: the best of the stack's photos holding the color", async () => {
    const { photos } = await database.getPhotosByColor(
      filter({ colors: { color: "blue", tone: null } }),
      null,
      10,
    );
    // 202 holds more blue, 201 is the better photo: 201, at its own rank
    assert.deepEqual(ids(photos), [201]);
    const overview = await database.getColorOverview(12, filter({}));
    const band = overview.bands.find((b) => b.key === "blue");
    assert.deepEqual(
      band?.photos.map((p) => p.id),
      [201],
    );
  });

  void test("a band keeps a stack whose best photo missed its candidates", async () => {
    // 252 holds the most blue, 251 is the better photo but too little blue
    // to be among the band's 4 candidates (perBand 1)
    const added = [251, 252, 261, 262, 263, 264];
    try {
      for (const id of added)
        await photo(id, TRIP, `c${id}.jpg`, "2015-01-01T08:00:00");
      await stack([251, 252]);
      for (const [id, share] of [
        [251, 0.1],
        [252, 0.95],
        [261, 0.9],
        [262, 0.85],
        [263, 0.8],
        [264, 0.75],
      ] as const)
        await blue(id, share);
      const overview = await database.getColorOverview(1, filter({}));
      const band = overview.bands.find((b) => b.key === "blue");
      assert.deepEqual(
        band?.photos.map((p) => p.id),
        [252],
      );
    } finally {
      await sql.query("DELETE FROM photos WHERE id = ANY($1::bigint[])", [
        added,
      ]);
    }
  });

  void test("names: the best photo the name finds", async () => {
    const one = await database.searchPhotos("(1)", null, 10);
    assert.deepEqual(ids(one.items), [202]);
    const all = await database.searchPhotos("IMG_000", null, 10);
    assert.deepEqual(ids(all.items), [201]);
    assert.equal((await database.countSearchMatches("IMG_000")).photos, 1);
  });

  void test("by content: the nearest stacks, each as its best photo", async () => {
    const { items } = await database.searchPhotosByContent(
      { embedding: near(1), model: MODEL },
      filter({}),
      0,
      10,
      false,
    );
    // 202 is the nearest, but 201 is the stack's best
    assert.deepEqual(ids(items).slice(0, 2), [201, 211]);
    assert.ok(!ids(items).includes(202) && !ids(items).includes(212));
  });

  void test("by content: a stack comes where its nearest photo is, shown as its best", async () => {
    // 271 is the stack's best photo but far from the query, 272 its nearest
    const added = [271, 272, 281, 282, 283, 284];
    const at = async (id: number, similarity: number) =>
      sql.query(
        "UPDATE photo_embeddings SET embedding = $2 WHERE photo_id = $1",
        [id, near(similarity)],
      );
    try {
      for (const id of added)
        await photo(id, TRIP, `n${id}.jpg`, "2014-01-01T08:00:00");
      await stack([271, 272]);
      await at(271, 0.2);
      await at(272, 0.99);
      for (const id of [281, 282, 283, 284]) await at(id, 0.95);
      const { items } = await database.searchPhotosByContent(
        { embedding: near(1), model: MODEL },
        filter({}),
        0,
        10,
      );
      // Within the cut: by its best photo, the 271 a front-first scan cut
      assert.equal(Number(items[0]?.id), 271);
      assert.equal(items[0]?.score, 0.99);
      assert.ok(!ids(items).includes(272));
      // Pages of one: every stack once
      const seen: string[] = [];
      for (let offset: number | null = 0; offset !== null; ) {
        const page = await database.searchPhotosByContent(
          { embedding: near(1), model: MODEL },
          filter({}),
          offset,
          1,
          false,
        );
        for (const p of page.items)
          seen.push(p.stack ? `s${p.stack.id}` : `p${p.id}`);
        offset = page.next;
      }
      assert.equal(new Set(seen).size, seen.length);
      assert.ok(seen.includes("s271"));
    } finally {
      await sql.query("DELETE FROM photos WHERE id = ANY($1::bigint[])", [
        added,
      ]);
    }
  });

  void test("a folder shows its own photos of a stack", async () => {
    const trip = await database.getPhotosInFolder(TRIP.id, true);
    // The copy kept in the dump does not hide the trip's
    assert.deepEqual(ids(trip).sort(), [201, 212, 222, 231]);
    assert.equal(trip.find((p) => Number(p.id) === 212)?.stack?.count, 2);
    // Shares list the files as they are
    assert.equal((await database.getPhotosInFolder(TRIP.id)).length, 6);
    // Out of the gallery a stack is no stack: every file shows
    assert.deepEqual(
      ids(await database.getPhotosInFolder(BOOKS.id, true)).sort(),
      [221, 241, 242],
    );
  });

  void test("a folder's card counts what the folder shows", async () => {
    const count = new Map(
      (await database.getFolders()).map((f) => [f.path, f.photo_count]),
    );
    // As getPhotosInFolder stacked: 201 for the burst, 212, 222, 231
    assert.equal(count.get(TRIP.path), 4);
    assert.equal(count.get(DUMP.path), 1);
    // Out of the gallery, every file
    assert.equal(count.get(BOOKS.path), 3);
    // Not the 6 files the sync counts
    await sql.query("UPDATE folders SET photo_count = 6 WHERE id = $1", [
      TRIP.id,
    ]);
    const [found] = await database
      .searchFolders("voyage", null, 5)
      .then((page) => page.items);
    assert.equal(found?.photo_count, 4);
  });

  void test("the photos of a stack, best first, in the gallery", async () => {
    assert.deepEqual(ids(await database.getStackPhotos(203)), [201, 202, 203]);
    assert.deepEqual(ids(await database.getStackPhotos(222)), [222]);
    assert.deepEqual(await database.getStackPhotos(231), []);
  });

  void test("a person's page: a stack once, the copy its folder dates", async () => {
    const page = await people.personPhotoPage(SUZIE, filter({}), null, 10);
    assert.equal(page.total, 1);
    const [copy] = page.photos;
    assert.ok(copy);
    // Ranked second, but the trip's folder dates it (2020-05 against EXIF 2019-01)
    assert.equal(copy.id, 212);
    assert.deepEqual(copy.copies, [211]);
    assert.equal(copy.date_source, "folder");
    assert.deepEqual(copy.stack, { id: 211, count: 2 });
    const all = await people.personPhotos(SUZIE);
    assert.deepEqual(
      all.map((p) => p.id),
      [212],
    );
    const listed = await people.listPeople();
    assert.equal(listed.find((p) => p.id === SUZIE)?.photo_count, 1);
  });
});
