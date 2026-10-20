/**
 * The one photo filter, on a real PostgreSQL (lib/testDatabase.ts): each
 * condition alone, then together, through every list that runs it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import type { Client } from "pg";
import type * as Database from "./database";
import type { PhotoFilter, TagFilter } from "./database";
import type * as Resolver from "./filterResolver";
import type * as People from "./people";
import { EXPRESSIONS, NO_URL_FILTER } from "./photoFilter";
import { NO_TAGS, readTagVocabulary } from "./sceneTags";
import { startTestDatabase, type TestDatabase } from "./testDatabase";

/** The worker's vocabulary, as the app reads it */
const VOCABULARY = readTagVocabulary(
  JSON.parse(readFileSync(path.join(process.cwd(), "db", "tags.json"), "utf8")),
);

let db: TestDatabase;
let sql: Client;
let database: typeof Database;
let people: typeof People;
let resolver: typeof Resolver;

const MODEL = "test-model";
const vector = (size: number, at: (i: number) => number) =>
  `[${Array.from({ length: size }, (_, i) => at(i)).join(",")}]`;
/** 768-d unit vector at cosine `similarity` from the query, QUERY */
const near = (similarity: number) =>
  vector(768, (i) =>
    i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity ** 2) : 0,
  );
const QUERY = { embedding: near(1), model: MODEL };

// expression_scores: anger, contempt, disgust, fear, happiness, neutral, sadness, surprise
const SMILING = [0, 0, 0, 0, 0.95, 0.05, 0, 0];
const NEUTRAL = [0, 0, 0, 0, 0.05, 0.9, 0.05, 0];
const SAD = [0, 0, 0, 0, 0, 0.2, 0.8, 0];

const SUZIE = 1;
const CELINE = 4;
const STEPHANE = 5;

async function photo(
  id: number,
  folder: { id: number; path: string },
  filename: string,
  taken: string | null,
  extra: { favorite?: boolean; size?: number; location?: boolean } = {},
) {
  const metadata = {
    ...(taken ? { date_taken: `${taken}T12:00:00.000Z` } : {}),
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
}

async function face(
  photoId: number,
  person: number | null,
  scores: number[],
  look: {
    eyes?: number;
    /** The left eye's, when it differs; null: not measured */
    leftEye?: number | null;
    mouth?: number;
    /** Degrees, below 0 looking down */
    pitch?: number;
    assignment?: string;
  } = {},
) {
  // Sharp and facing the camera: cluster_eligible, a face the looks read on
  await sql.query(
    `INSERT INTO faces (photo_id, box, landmarks, det_score, width_px, height_px,
       sharpness, yaw, pitch, embedding, model, person_id, assignment,
       expression_scores, eye_left_open, eye_right_open, mouth_open)
     VALUES ($1, '{0.1,0.1,0.2,0.2}', '{0,0,0,0,0,0,0,0,0,0}', 0.9, 200, 200,
       100, 0, $9, $2, 'arcface', $3, $4, $5, $6, $7, $8)`,
    [
      photoId,
      vector(512, () => 0.04),
      person,
      person === null ? null : (look.assignment ?? "manual"),
      scores,
      look.leftEye === undefined ? (look.eyes ?? 0.3) : look.leftEye,
      look.eyes ?? 0.3,
      look.mouth ?? 0.02,
      look.pitch ?? 0,
    ],
  );
}

async function looked(...photoIds: number[]) {
  for (const id of photoIds)
    await sql.query(
      `INSERT INTO analysis_jobs (photo_id, task, status) VALUES ($1, 'faces', 'done')`,
      [id],
    );
}

async function colors(photoId: number, blue: number) {
  const hues = Array.from({ length: 12 }, (_, i) =>
    i === 5 ? blue : (1 - blue) / 11,
  );
  await sql.query(
    `INSERT INTO photo_colors (photo_id, hues, palette_hex, palette_share,
       colorfulness, chroma, luminance, monochrome, center_sigma, model)
     VALUES ($1, $2, '{#2050c0}', '{1}', 40, 20, 50, false, 0.4, 'test')`,
    [photoId, hues],
  );
}

/**
 * A photo as the tagger leaves it (db/schema.sql): interieur and exterieur
 * always, the other tags from 0.05 only.
 */
async function tags(photoId: number, scores: Record<string, number>) {
  const indoors = scores.interieur ?? 0.5;
  const all = { interieur: indoors, exterieur: 1 - indoors, ...scores };
  for (const [tag, score] of Object.entries(all)) {
    if (score < 0.05 && tag !== "interieur" && tag !== "exterieur") continue;
    await sql.query(
      `INSERT INTO photo_tags (photo_id, tag, score, vocab_version) VALUES ($1, $2, $3, $4)`,
      [photoId, tag, score, VOCABULARY.version],
    );
  }
}

async function embedded(photoId: number, similarity: number) {
  await sql.query(
    `INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES ($1, $2, $3)`,
    [photoId, near(similarity), MODEL],
  );
}

const ALBUMS = { id: 1, path: "albums" };
const BEACH = { id: 2, path: "albums/2015 Plage" };
const XMAS = { id: 3, path: "albums/2016 Noël" };
const BEACH_TOO = { id: 4, path: "albums/2015 Plage bis" };
const BOOKS = { id: 5, path: "books" };

before(async () => {
  db = await startTestDatabase();
  sql = db.client;
  database = await import("./database");
  people = await import("./people");
  resolver = await import("./filterResolver");

  await sql.query(`INSERT INTO folders (id, path, name, parent_id) VALUES
    (1, 'albums', 'albums', NULL),
    (2, 'albums/2015 Plage', '2015 Plage', 1),
    (3, 'albums/2016 Noël', '2016 Noël', 1),
    (4, 'albums/2015 Plage bis', '2015 Plage bis', 1),
    (5, 'books', 'books', NULL)`);
  await sql.query(`INSERT INTO excluded_folders (path) VALUES ('books')`);
  await sql.query(`INSERT INTO people (id, name) VALUES
    (1, 'Suzie'), (4, 'Céline'), (5, 'Stéphane')`);

  // 101: Céline smiling, Stéphane neutral, at the beach, very blue
  await photo(101, BEACH, "a.jpg", "2015-07-10", { location: true, size: 777 });
  await face(101, CELINE, SMILING);
  await face(101, STEPHANE, NEUTRAL);
  await tags(101, { plage: 0.9, interieur: 0.2, chat: 0.1 });
  await colors(101, 0.5);
  await embedded(101, 0.9);
  // 102: Céline neutral, Stéphane smiling: not « Céline qui sourit »; barely blue, a beach under the threshold
  await photo(102, BEACH, "b.jpg", "2015-07-11");
  await face(102, CELINE, NEUTRAL);
  await face(102, STEPHANE, SMILING);
  await tags(102, { plage: 0.3, chat: 0.02 });
  await colors(102, 0.05);
  await embedded(102, 0.89);
  // 103: kittens and nobody, looked at
  await photo(103, BEACH, "c.jpg", "2015-08-01");
  await tags(103, { chaton: 0.9, chat: 0.8, interieur: 0.7 });
  await embedded(103, 0.5);
  // 104: Suzie sad with her eyes closed, Christmas, a favorite
  await photo(104, XMAS, "d.jpg", "2016-12-24", {
    favorite: true,
    location: true,
  });
  await face(104, SUZIE, SAD, { eyes: 0.05 });
  await tags(104, { noel: 0.9, interieur: 0.9 });
  await colors(104, 0.3);
  await embedded(104, 0.88);
  // 105: Suzie laughing next to someone not named
  await photo(105, XMAS, "e.jpg", "2016-12-25");
  await face(105, SUZIE, [0, 0, 0, 0, 0.92, 0.08, 0, 0], { mouth: 0.4 });
  await face(105, null, NEUTRAL);
  await embedded(105, 0.87);
  await tags(105, { interieur: 0.8 });
  // 106: Céline smiling in the folder whose name starts like the beach's
  await photo(106, BEACH_TOO, "f.jpg", "2015-07-12");
  await face(106, CELINE, SMILING);
  // No chat row: under 0.05, the tagger stores none
  await tags(106, { plage: 0.9, interieur: 0.1 });
  await embedded(106, 0.86);
  // 107: out of the gallery: never listed, whatever it matches
  await photo(107, BOOKS, "g.jpg", "2015-07-13", { favorite: true });
  await face(107, CELINE, SMILING);
  await tags(107, { plage: 0.95, interieur: 0.1 });
  await colors(107, 0.9);
  await embedded(107, 0.95);
  // 108: no face row, but the faces pass has not looked at it
  await photo(108, BEACH, "h.jpg", "2015-07-14");
  // 109: Suzie alone
  await photo(109, ALBUMS, "i.jpg", "2014-01-05");
  await face(109, SUZIE, NEUTRAL);
  await tags(109, { interieur: 0.9 });
  await embedded(109, 0.4);
  // 110: a copy of 101 (same name and size) elsewhere
  await photo(110, BEACH_TOO, "a.jpg", "2015-07-10", { size: 777 });
  await face(110, CELINE, SMILING);
  // 111: a face the owner said is not Céline
  await photo(111, ALBUMS, "j.jpg", "2014-02-01");
  await face(111, CELINE, SMILING, { assignment: "rejected" });
  await embedded(111, 0.3);
  // 112: undated
  await photo(112, ALBUMS, "k.jpg", null);
  await face(112, CELINE, SMILING);
  // 113: one eye closed, the other not measured, and lids low on a face
  // looking down: no « yeux fermés »; a sad face named as no one
  await photo(113, ALBUMS, "l.jpg", "2013-05-05");
  await face(113, null, NEUTRAL, { eyes: 0.05, leftEye: null });
  await face(113, null, NEUTRAL, { eyes: 0.05, pitch: -30 });
  await face(113, null, SAD);

  await looked(101, 102, 103, 104, 105, 106, 107, 109, 110, 111, 112, 113);
});

after(async () => {
  await database.getPool().end();
  await db.stop();
});

const filter = (parts: Partial<PhotoFilter>): PhotoFilter => ({
  ...database.NO_PHOTO_FILTER,
  ...parts,
});

const tag = (name: string, negated = false): TagFilter => ({
  tag: name,
  negated,
  threshold: 0.5,
  version: VOCABULARY.version,
});

/** The timeline's photo ids for `parts`, newest first. */
async function timeline(parts: Partial<PhotoFilter>): Promise<number[]> {
  const photos = await database.getTimelinePhotos(null, 100, filter(parts));
  return photos.map((p) => Number(p.id));
}

void describe("each condition", () => {
  void test("no filter: every dated photo of the gallery, newest first", async () => {
    assert.deepEqual(
      await timeline({}),
      [105, 104, 103, 108, 106, 102, 110, 101, 111, 109, 113],
    );
  });

  void test("people: every one of them on the photo", async () => {
    assert.deepEqual(
      await timeline({ people: [CELINE] }),
      [106, 102, 110, 101],
    );
    assert.deepEqual(
      await timeline({ people: [CELINE, STEPHANE] }),
      [102, 101],
    );
  });

  void test("a person's look: that person's face, not someone else's", async () => {
    assert.deepEqual(
      await timeline({ faces: [{ person: CELINE, expression: "sourit" }] }),
      [106, 110, 101],
    );
    assert.deepEqual(
      await timeline({ faces: [{ person: STEPHANE, expression: "sourit" }] }),
      [102],
    );
    // A face the owner said is not her does not count, whatever it shows
    assert.ok(
      !(
        await timeline({ faces: [{ person: CELINE, expression: "sourit" }] })
      ).includes(111),
    );
  });

  void test("anyone's look", async () => {
    // 113's sad face is named as no one: not counted (NAMED_LOOKS)
    assert.deepEqual(
      await timeline({ faces: [{ person: null, expression: "triste" }] }),
      [104],
    );
    assert.deepEqual(
      await timeline({ faces: [{ person: null, expression: "rit" }] }),
      [105],
    );
    // 113: one eye not measured, or looking down: not « yeux fermés »
    assert.deepEqual(
      await timeline({ faces: [{ person: null, expression: "yeux_fermes" }] }),
      [104],
    );
    // Smiling, mouth closed: not laughing
    assert.deepEqual(
      await timeline({ faces: [{ person: CELINE, expression: "rit" }] }),
      [],
    );
  });

  void test("anyone's rare look, read from its partial index", async () => {
    // db/schema.sql idx_faces_look_*, used only while its predicate says
    // what the look's SQL says; smiling, on 40,000 faces, has none
    await sql.query("SET enable_seqscan = off");
    try {
      for (const expression of EXPRESSIONS.filter((e) => e !== "sourit")) {
        const params: unknown[] = [];
        const where = database.andPhotoFilter(
          params,
          filter({ faces: [{ person: null, expression }] }),
        );
        const plan = await sql.query<{ "QUERY PLAN": string }>(
          `EXPLAIN SELECT p.id FROM photos p WHERE true ${where}`,
          params,
        );
        assert.match(
          plan.rows.map((row) => row["QUERY PLAN"]).join("\n"),
          new RegExp(`idx_faces_look_${expression}\\b`),
          expression,
        );
      }
    } finally {
      await sql.query("RESET enable_seqscan");
    }
  });

  void test("only: no face, on a photo the faces pass has looked at", async () => {
    assert.deepEqual(await timeline({ only: true }), [103]);
    // Nobody else than Suzie
    assert.deepEqual(
      await timeline({ only: true, people: [SUZIE] }),
      [104, 109],
    );
    assert.deepEqual(
      await timeline({
        only: true,
        faces: [{ person: SUZIE, expression: "triste" }],
      }),
      [104],
    );
    // With a look on anyone's face: every face looks so
    assert.deepEqual(
      await timeline({
        only: true,
        faces: [{ person: null, expression: "sourit" }],
      }),
      [106, 110, 111],
    );
  });

  void test("tags: from their threshold; negated, a tagged photo without it", async () => {
    assert.deepEqual(await timeline({ tags: [tag("plage")] }), [106, 101]);
    assert.deepEqual(await timeline({ tags: [tag("chaton")] }), [103]);
    // 106 has no chat row at all, 101 one under the threshold
    assert.deepEqual(
      await timeline({ tags: [tag("plage"), tag("chat", true)] }),
      [106, 101],
    );
    // 108 was never tagged: it is not « sans chat », it is unknown
    assert.deepEqual(
      await timeline({ tags: [tag("chat", true)] }),
      [105, 104, 106, 102, 101, 109],
    );
    // Rows of another vocabulary do not count
    assert.deepEqual(
      await timeline({
        tags: [{ ...tag("plage"), version: VOCABULARY.version + 1 }],
      }),
      [],
    );
  });

  void test("people not on the photos", async () => {
    assert.deepEqual(
      await timeline({ people: [CELINE], withoutPeople: [STEPHANE] }),
      [106, 110],
    );
  });

  void test("a rare tag, read from its photos, keeps the same ones", async () => {
    assert.deepEqual(
      [...(await database.rareTags([{ tag: "plage", threshold: 0.5 }]))],
      ["plage"],
    );
    for (const parts of [
      { tags: [tag("plage")] },
      { tags: [tag("chaton")], only: true },
      {
        tags: [tag("plage")],
        faces: [{ person: CELINE, expression: "sourit" as const }],
      },
    ])
      assert.deepEqual(
        await timeline({
          ...parts,
          tags: parts.tags.map((t) => ({ ...t, rare: true })),
        }),
        await timeline(parts),
      );
  });

  void test("dates: each filter must hold", async () => {
    const summer = { ranges: [], annual: [{ from: "06-01", to: "08-31" }] };
    const y2015 = {
      ranges: [{ from: "2015-01-01", before: "2016-01-01" }],
      annual: [],
    };
    assert.deepEqual(
      await timeline({ dates: [summer] }),
      [103, 108, 106, 102, 110, 101],
    );
    assert.deepEqual(
      await timeline({
        dates: [
          y2015,
          { ranges: [], annual: [{ from: "07-11", to: "07-12" }] },
        ],
      }),
      [106, 102],
    );
  });

  void test("colors: a list in its own order needs the larger share for blue", async () => {
    assert.deepEqual(
      await timeline({ colors: { color: "blue", tone: null } }),
      [104, 101],
    );
  });

  void test("folder: it and its sub-folders, not a folder named like it", async () => {
    assert.deepEqual(
      await timeline({ folder: "albums/2015 Plage" }),
      [103, 108, 102, 101],
    );
    assert.equal((await timeline({ folder: "albums" })).length, 11);
  });

  void test("favorites of the gallery", async () => {
    assert.deepEqual(await timeline({ favorites: true }), [104]);
  });

  void test("content: within the floor measured among the filter's photos", async () => {
    // 5th nearest of the gallery at 0.86, plus the margin: down to 0.825
    const all = await database.contentPhotos(QUERY, filter({}));
    assert.deepEqual([...all.ids].sort(), [101, 102, 104, 105, 106]);
    assert.equal(all.complete, true);
    assert.deepEqual(
      await timeline({ content: { ids: all.ids } }),
      [105, 104, 106, 102, 101],
    );
    // Among Suzie's photos the reference is her own farthest: 109 comes in
    const hers = await database.contentPhotos(
      QUERY,
      filter({ people: [SUZIE] }),
    );
    assert.deepEqual(
      await timeline({ people: [SUZIE], content: { ids: hers.ids } }),
      [105, 104, 109],
    );
  });
});

void describe("together, through every list", () => {
  const celineSmilingAtTheBeach = () =>
    filter({
      faces: [{ person: CELINE, expression: "sourit" }],
      tags: [tag("plage")],
      dates: [{ ranges: [], annual: [{ from: "06-01", to: "08-31" }] }],
      colors: { color: "blue", tone: null },
    });

  void test("timeline and its months", async () => {
    assert.deepEqual(
      (
        await database.getTimelinePhotos(null, 100, celineSmilingAtTheBeach())
      ).map((p) => Number(p.id)),
      [101],
    );
    const summary = await database.getTimelineSummary(
      celineSmilingAtTheBeach(),
    );
    assert.deepEqual(summary.months, [{ month: "2015-07", count: 1 }]);
    assert.equal(summary.total_photos, 1);
  });

  void test("timeline pages", async () => {
    const first = await database.getTimelinePhotos(
      null,
      2,
      filter({ people: [CELINE] }),
    );
    assert.deepEqual(
      first.map((p) => Number(p.id)),
      [106, 102],
    );
    const last = first[1];
    assert.ok(last?.metadata?.date_taken);
    const next = await database.getTimelinePhotos(
      { dateTaken: last.metadata.date_taken, id: Number(last.id) },
      2,
      filter({ people: [CELINE] }),
    );
    assert.deepEqual(
      next.map((p) => Number(p.id)),
      [110, 101],
    );
  });

  void test("ranked by color, with the other conditions", async () => {
    const { photos } = await database.getPhotosByColor(
      filter({
        people: [CELINE],
        colors: { color: "blue", tone: null },
      }),
      null,
      10,
    );
    // The ranked list keeps what holds a little blue: 102 too
    assert.deepEqual(
      photos.map((p) => Number(p.id)),
      [101, 102],
    );
  });

  void test("the Couleurs bands", async () => {
    const overview = await database.getColorOverview(
      12,
      filter({ people: [SUZIE] }),
    );
    const blue = overview.bands.find((band) => band.key === "blue");
    assert.deepEqual(
      blue?.photos.map((p) => p.id),
      [104],
    );
  });

  void test("the map", async () => {
    const points = await database.getMapPoints(
      { from: null, to: null },
      filter({ faces: [{ person: SUZIE, expression: "triste" }] }),
    );
    assert.deepEqual(
      points.map((p) => p[2]),
      [1],
    );
    const box = { south: 48, west: 2, north: 49, east: 3 };
    const photos = await database.getMapPhotos(
      box,
      { from: "2015-01", to: "2015-12" },
      null,
      10,
      celineSmilingAtTheBeach(),
    );
    assert.deepEqual(
      photos.map((p) => Number(p.id)),
      [101],
    );
    assert.equal(
      await database.countMapPhotos(
        box,
        { from: "2016-01", to: null },
        filter({}),
      ),
      1,
    );
  });

  void test("names: every photo unfiltered, the gallery's filtered", async () => {
    const all = await database.searchPhotos("a.jpg", null, 10);
    assert.deepEqual(all.items.map((p) => Number(p.id)).sort(), [101, 110]);
    const smiling = await database.searchPhotos(
      "jpg",
      null,
      20,
      filter({ faces: [{ person: CELINE, expression: "sourit" }] }),
    );
    assert.deepEqual(
      smiling.items.map((p) => Number(p.id)).sort(),
      [101, 106, 110, 112],
    );
    const counts = await database.countSearchMatches(
      "jpg",
      filter({ only: true }),
    );
    assert.equal(counts.photos, 1);
  });

  void test("ranked by content, within the filter", async () => {
    const { items } = await database.searchPhotosByContent(
      QUERY,
      filter({ people: [CELINE] }),
      0,
      10,
    );
    assert.deepEqual(
      items.map((p) => Number(p.id)),
      [101, 102, 106],
    );
  });

  void test("a person's page: newest first, copies once, paged, filtered", async () => {
    const first = await people.personPhotoPage(CELINE, filter({}), null, 2);
    // 110 is a copy of 101: one of them; 112 undated comes last
    assert.equal(first.total, 4);
    assert.deepEqual(
      first.photos.map((p) => p.id),
      [106, 102],
    );
    assert.deepEqual(first.years, [
      { year: 2015, count: 3 },
      { year: null, count: 1 },
    ]);
    assert.ok(first.next);
    const rest = await people.personPhotoPage(
      CELINE,
      filter({}),
      first.next,
      2,
    );
    assert.equal(rest.photos.length, 2);
    assert.equal(rest.photos[1]?.id, 112);
    assert.equal(rest.next, null);
    const copy = rest.photos[0];
    assert.ok(copy && [101, 110].includes(copy.id));
    assert.equal(copy.copies.length, 1);

    const smiling = await people.personPhotoPage(
      CELINE,
      filter({ faces: [{ person: CELINE, expression: "sourit" }] }),
      null,
      10,
    );
    assert.deepEqual(smiling.photos.map((p) => p.id).length, 3);
    assert.ok(!smiling.photos.some((p) => p.id === 102));
  });

  void test("a person's looks", async () => {
    assert.deepEqual(await database.personExpressions(SUZIE), [
      "sourit",
      "rit",
      "triste",
      "yeux_fermes",
    ]);
  });
});

void describe("from a URL", () => {
  const vocabulary = VOCABULARY;
  const plage = vocabulary.tags.find((t) => t.tag === "plage");

  void test("the query and the parameters make one filter", async () => {
    const resolved = await resolver.resolveFilter(
      {
        ...NO_URL_FILTER,
        q: "Céline qui sourit à la plage",
        colors: { color: "blue", tone: null },
        dates: ["été"],
      },
      {},
      vocabulary,
    );
    assert.ok(resolved.ok);
    const { filter: f, content, dateLabels } = resolved.value;
    assert.deepEqual(f.faces, [{ person: CELINE, expression: "sourit" }]);
    // Two photos show it: read from them (rareTags)
    assert.deepEqual(f.tags, [
      {
        tag: "plage",
        negated: false,
        threshold: plage?.threshold,
        version: vocabulary.version,
        rare: true,
      },
    ]);
    // With tags, how much of the gallery the tagger has read: 7 of 12
    assert.equal(resolved.value.taggedShare, 7 / 12);
    assert.deepEqual(f.colors, { color: "blue", tone: null });
    assert.equal(content, null);
    assert.deepEqual(dateLabels, ["Été"]);
    assert.deepEqual(
      (await database.getTimelinePhotos(null, 10, f)).map((p) => Number(p.id)),
      [101],
    );
  });

  void test("a tag no photo has yet is read as its words, typed or not", async () => {
    const resolved = await resolver.resolveFilter(
      {
        ...NO_URL_FILTER,
        q: "des chiens",
        tags: [{ tag: "cheval", negated: false }],
      },
      {},
      vocabulary,
    );
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.value.filter.tags, []);
    assert.deepEqual(resolved.value.untagged, ["chien", "cheval"]);
    assert.equal(resolved.value.content, "chiens cheval");
    assert.equal(resolved.value.cut, true);
    assert.equal(resolved.value.taggedShare, null);
  });

  void test("without the vocabulary file, tags are ignored, not refused", async () => {
    const resolved = await resolver.resolveFilter(
      { ...NO_URL_FILTER, tags: [{ tag: "plage", negated: false }] },
      {},
      NO_TAGS,
    );
    assert.ok(resolved.ok);
    assert.deepEqual(resolved.value.filter.tags, []);
    assert.deepEqual(resolved.value.untagged, ["plage"]);
  });

  void test("a folder with slashes around it, people not on the photos", async () => {
    const resolved = await resolver.resolveFilter(
      { ...NO_URL_FILTER, q: "Céline sans Stéphane" },
      { folder: "/albums/2015 Plage bis/" },
      vocabulary,
    );
    assert.ok(resolved.ok);
    assert.equal(resolved.value.filter.folder, "albums/2015 Plage bis");
    assert.deepEqual(resolved.value.filter.withoutPeople, [STEPHANE]);
    assert.deepEqual(
      (await database.getTimelinePhotos(null, 10, resolved.value.filter)).map(
        (p) => Number(p.id),
      ),
      [106, 110],
    );
  });

  void test("what does not read is refused", async () => {
    const unknownTag = await resolver.resolveFilter(
      { ...NO_URL_FILTER, tags: [{ tag: "licorne", negated: false }] },
      {},
      vocabulary,
    );
    assert.equal(unknownTag.ok, false);
    const noDate = await resolver.resolveFilter(
      { ...NO_URL_FILTER, dates: ["plage"] },
      {},
      vocabulary,
    );
    assert.equal(noDate.ok, false);
  });
});
