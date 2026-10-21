/**
 * « Photos similaires » on a real PostgreSQL (lib/testDatabase.ts): what
 * `like` keeps as a filter with the others, and how Recherche ranks it,
 * the photo first.
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import type * as Resolver from "./filterResolver";
import type * as Semantic from "./semanticSearch";
import { NO_URL_FILTER, type UrlFilter } from "./photoFilter";
import { NO_TAGS } from "./sceneTags";
import { SIMILAR_MIN_COSINE } from "./similar";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let resolver: typeof Resolver;
let semantic: typeof Semantic;

const MODEL = "test-model";
const vector = (size: number, at: (i: number) => number) =>
  `[${Array.from({ length: size }, (_, i) => at(i)).join(",")}]`;
/** 768-d unit vector at cosine `similarity` from the source's, near(1) */
const near = (similarity: number) =>
  vector(768, (i) =>
    i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity ** 2) : 0,
  );
/** A cosine `share` of the way from the threshold to 1: above it whatever its value */
const above = (share: number) =>
  SIMILAR_MIN_COSINE + (1 - SIMILAR_MIN_COSINE) * share;
const BELOW = SIMILAR_MIN_COSINE - 0.05;

const TRIP = { id: 1, path: "2020 Voyage" };
const BOOKS = { id: 2, path: "books" };
const SUZIE = 1;

const SOURCE = 501;

async function photo(
  id: number,
  folder: { id: number; path: string },
  taken: string,
  cosine: number,
) {
  await sql.query(
    `INSERT INTO photos (id, folder_id, filename, s3_key, size, mime_type,
       modified_at, metadata, thumbnail_status)
     VALUES ($1, $2, $3, $4, $5, 'image/jpeg', now(), $6, 'generated')`,
    [
      id,
      folder.id,
      `p${id}.jpg`,
      `${folder.path}/p${id}.jpg`,
      1000 + id,
      { date_taken: `${taken}T12:00:00.000Z` },
    ],
  );
  await sql.query(
    `INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES ($1, $2, $3)`,
    [id, near(cosine), MODEL],
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

async function face(photoId: number, person: number) {
  await sql.query(
    `INSERT INTO faces (photo_id, box, landmarks, det_score, width_px, height_px,
       sharpness, yaw, pitch, embedding, model, person_id, assignment)
     VALUES ($1, '{0.1,0.1,0.2,0.2}', '{0,0,0,0,0,0,0,0,0,0}', 0.9, 200, 200,
       100, 0, 0, $2, 'arcface', $3, 'manual')`,
    [photoId, vector(512, () => 0.04), person],
  );
}

const ids = (photos: { id: number | string }[]) =>
  photos.map((p) => Number(p.id));

/** The URL's filter as a list route runs it (api/_lib/filter.ts listFilter). */
async function listed(url: Partial<UrlFilter>) {
  const resolved = await resolver.resolveFilter(
    { ...NO_URL_FILTER, ...url },
    {},
    NO_TAGS,
  );
  assert.ok(resolved.ok);
  return resolver.withLike(resolved.value.filter, resolved.value.like);
}

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  resolver = await import("./filterResolver");
  semantic = await import("./semanticSearch");
  await sql.query(`INSERT INTO folders (id, path, name) VALUES
    (1, '2020 Voyage', '2020 Voyage'), (2, 'books', 'books')`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  await sql.query(`INSERT INTO people (id, name) VALUES (1, 'Suzie')`);
});

beforeEach(async () => {
  await sql.query("TRUNCATE photos RESTART IDENTITY CASCADE");
  // The source and its stack-mate, Suzie on both
  await photo(SOURCE, TRIP, "2020-05-01", 1);
  await photo(508, TRIP, "2020-05-01", above(0.95));
  await stack([SOURCE, 508]);
  await face(SOURCE, SUZIE);
  await face(508, SUZIE);
  // Look-alikes: Suzie on one, a year later another, a burst of two
  await photo(502, TRIP, "2020-05-02", above(0.8));
  await face(502, SUZIE);
  await photo(503, TRIP, "2021-07-14", above(0.2));
  await photo(506, TRIP, "2020-06-01", above(0.6));
  await photo(507, TRIP, "2020-06-01", above(0.65));
  await stack([506, 507]);
  // Not alike, out of the gallery, in the Corbeille
  await photo(504, TRIP, "2020-05-03", BELOW);
  await photo(509, BOOKS, "2020-05-04", above(0.9));
  await photo(505, TRIP, "2020-05-05", above(0.9));
  await sql.query("UPDATE photos SET trashed_at = now() WHERE id = 505");
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

void describe("« Photos similaires »", () => {
  void test("as a filter: the photos alike in the gallery, a stack once, in the view's order", async () => {
    const { filter, like, complete } = await listed({ like: SOURCE });
    assert.equal(like, "ok");
    assert.equal(complete, true);
    assert.deepEqual([...(filter.like?.ids ?? [])].sort(), [
      SOURCE,
      502,
      503,
      506,
      507,
      508,
    ]);
    const timeline = await database.getTimelinePhotos(null, 50, filter);
    // Newest first; the stacks show by their front
    assert.deepEqual(ids(timeline), [503, 506, 502, SOURCE]);
  });

  void test("with the other filters: a person, a date", async () => {
    const hers = await listed({ like: SOURCE, people: [SUZIE] });
    assert.deepEqual(
      ids(await database.getTimelinePhotos(null, 50, hers.filter)),
      [502, SOURCE],
    );
    const later = await listed({ like: SOURCE, dates: ["2021"] });
    assert.deepEqual(
      ids(await database.getTimelinePhotos(null, 50, later.filter)),
      [503],
    );
  });

  void test("on Recherche: the photo first, then by likeness, page after page", async () => {
    const { filter } = await listed({});
    const first = await semantic.similarSearch(SOURCE, {
      filter,
      offset: 0,
      limit: 2,
    });
    assert.equal(first.status, "ok");
    // Its stack-mate 508 is the source's stack: the source stands for it
    assert.deepEqual(ids(first.photos), [SOURCE, 502, 506]);
    assert.equal(first.photos[0]?.source, true);
    assert.equal(first.photos[0].trashed, undefined);
    assert.ok((first.photos[1]?.score ?? 0) >= (first.photos[2]?.score ?? 0));
    assert.equal(first.next, 2);
    const rest = await semantic.similarSearch(SOURCE, {
      filter,
      offset: 2,
      limit: 2,
    });
    assert.deepEqual(ids(rest.photos), [503]);
    assert.equal(rest.next, null);
  });

  void test("a photo in the Corbeille comes first, marked, and is compared with its own stack", async () => {
    await sql.query("UPDATE photos SET trashed_at = now() WHERE id = $1", [
      SOURCE,
    ]);
    const { filter } = await listed({});
    const page = await semantic.similarSearch(SOURCE, {
      filter,
      offset: 0,
      limit: 10,
    });
    assert.deepEqual(ids(page.photos), [SOURCE, 508, 502, 506, 503]);
    assert.equal(page.photos[0]?.trashed, true);
    // As a filter elsewhere, it is in the Corbeille: not shown
    const elsewhere = await listed({ like: SOURCE });
    assert.deepEqual(
      ids(await database.getTimelinePhotos(null, 50, elsewhere.filter)),
      [503, 506, 502, 508],
    );
  });

  void test("a photo with no embedding yet keeps itself alone, and says so", async () => {
    await sql.query("DELETE FROM photo_embeddings WHERE photo_id = 503");
    const { filter, like } = await listed({ like: 503 });
    assert.equal(like, "unavailable");
    assert.deepEqual(filter.like?.ids, [503]);
    const page = await semantic.similarSearch(503, {
      filter: (await listed({})).filter,
      offset: 0,
      limit: 10,
    });
    assert.equal(page.status, "unavailable");
    assert.deepEqual(ids(page.photos), [503]);
  });
});
