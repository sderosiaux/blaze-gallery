import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  chooseLookalikes,
  MAX_PROPOSALS,
  REJECTED_MARGIN,
  REVIEW_THRESHOLD,
  WINDOW_DAYS,
  type Neighbour,
  type Reference,
} from "./lookalikes";

const NAMED = "2015-06-01";
const REFERENCE = 900;
const ONE: Reference[] = [{ face_id: REFERENCE, taken: NAMED }];

function near(
  face_id: number,
  similarity: number,
  taken: string | null = NAMED,
  more: Partial<Neighbour> = {},
): Neighbour {
  return {
    reference_id: REFERENCE,
    face_id,
    file: `IMG_${String(face_id)}.jpg`,
    similarity,
    taken,
    rejected: [],
    ...more,
  };
}

const ids = (
  neighbours: Neighbour[],
  references: Reference[] = ONE,
  birthDate: string | null = null,
) => chooseLookalikes(references, neighbours, birthDate).map((p) => p.face_id);

/** ISO day `days` after `iso`. */
function plus(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

void test("the worker's thresholds, written once on each side", () => {
  const worker = readFileSync(
    join(__dirname, "../../worker/src/blaze_worker/people.py"),
    "utf8",
  );
  const value = (name: string) =>
    Number(new RegExp(`^${name} = ([\\d.]+)`, "m").exec(worker)?.[1]);
  assert.equal(REVIEW_THRESHOLD, value("REVIEW_THRESHOLD"));
  assert.equal(WINDOW_DAYS, value("WINDOW_DAYS"));
  assert.equal(
    REJECTED_MARGIN,
    Number(/margin: float = ([\d.]+)/.exec(worker)?.[1]),
  );
});

void test("from the review floor up, nothing under it", () => {
  assert.deepEqual(ids([near(1, 0.3), near(2, 0.299), near(3, 0.8)]), [3, 1]);
});

void test("within 18 months of the face named, either way", () => {
  assert.deepEqual(
    ids([
      near(1, 0.5, plus(NAMED, WINDOW_DAYS)),
      near(2, 0.5, plus(NAMED, -WINDOW_DAYS)),
      near(3, 0.9, plus(NAMED, WINDOW_DAYS + 1)),
      near(4, 0.9, plus(NAMED, -WINDOW_DAYS - 1)),
    ]),
    [1, 2],
  );
});

void test("an EXIF timestamp counts by its day", () => {
  assert.deepEqual(
    ids([near(1, 0.5, `${plus(NAMED, WINDOW_DAYS)}T23:59:00.000Z`)]),
    [1],
  );
});

void test("undated faces take part in nothing, as in the worker", () => {
  assert.deepEqual(ids([near(1, 0.9, null)]), []);
  assert.deepEqual(
    ids([near(1, 0.9)], [{ face_id: REFERENCE, taken: null }]),
    [],
  );
});

void test("with a birth date, nothing from before her year of birth", () => {
  const references = [{ face_id: REFERENCE, taken: "2008-11-01" }];
  const neighbours = [
    near(1, 0.6, "2007-12-31"),
    near(2, 0.6, "2008-01-01"),
    near(3, 0.6, "2008-06-01"),
  ];
  assert.deepEqual(ids(neighbours, references, "2008-10-25"), [2, 3]);
  assert.deepEqual(ids(neighbours, references, null), [1, 2, 3]);
});

void test("as close to a face rejected for her, minus the margin: not proposed", () => {
  const rejected = (similarity: number, taken: string | null = NAMED) => ({
    rejected: [{ similarity, taken }],
  });
  assert.deepEqual(
    ids([
      near(1, 0.5, NAMED, rejected(0.5 - REJECTED_MARGIN)),
      near(2, 0.5, NAMED, rejected(0.47)),
      near(3, 0.5, NAMED, rejected(0.7)),
    ]),
    [2],
  );
});

void test("a rejected face counts within 18 months of the neighbour, dated", () => {
  const far = plus(NAMED, 400);
  assert.deepEqual(
    ids([
      // Rejected 800 days before the neighbour: outside its window
      near(1, 0.5, far, {
        rejected: [{ similarity: 0.9, taken: plus(far, -800) }],
      }),
      near(2, 0.5, NAMED, { rejected: [{ similarity: 0.9, taken: null }] }),
      near(3, 0.5, far, { rejected: [{ similarity: 0.9, taken: far }] }),
    ]),
    [1, 2],
  );
});

void test("one face per file, the closest; copies are one file", () => {
  const file = { file: "IMG_9.jpg" };
  assert.deepEqual(
    ids([
      near(5, 0.4, NAMED, file),
      near(6, 0.7, NAMED, file),
      near(7, 0.7, NAMED, file),
      near(8, 0.5),
    ]),
    [6, 8],
  );
});

void test("several faces named: each reaches its own 18 months, the closest wins", () => {
  const later = plus(NAMED, 1000);
  const references = [
    { face_id: 900, taken: NAMED },
    { face_id: 901, taken: later },
  ];
  const chosen = chooseLookalikes(
    references,
    [
      // Near both, closer to 901
      near(1, 0.4, plus(NAMED, 500), { reference_id: 900 }),
      near(1, 0.6, plus(NAMED, 500), { reference_id: 901 }),
      // Only 901's window holds it, however close it is to 900
      near(2, 0.9, later, { reference_id: 900 }),
      near(2, 0.35, later, { reference_id: 901 }),
      // From a face that is not one of the references
      near(3, 0.9, NAMED, { reference_id: 999 }),
    ],
    null,
  );
  assert.deepEqual(chosen, [
    { face_id: 1, similarity: 0.6, best_seed_face_id: 901, gap_days: 500 },
    { face_id: 2, similarity: 0.35, best_seed_face_id: 901, gap_days: 0 },
  ]);
});

void test("the margin is taken against the closest face named", () => {
  const rejected = [{ similarity: 0.45, taken: NAMED }];
  const references = [
    { face_id: 900, taken: NAMED },
    { face_id: 901, taken: NAMED },
  ];
  assert.deepEqual(
    ids(
      [
        near(1, 0.46, NAMED, { reference_id: 900, rejected }),
        near(1, 0.6, NAMED, { reference_id: 901, rejected: [] }),
      ],
      references,
    ),
    [1],
  );
});

void test("closest first, at most the limit per face named, with the days between the photos", () => {
  const many = Array.from({ length: MAX_PROPOSALS + 10 }, (_, i) =>
    near(i + 1, 0.3 + i / 1000, plus(NAMED, i)),
  );
  const chosen = chooseLookalikes(ONE, many, null);
  assert.equal(chosen.length, MAX_PROPOSALS);
  assert.equal(chosen[0]?.face_id, MAX_PROPOSALS + 10);
  assert.equal(chosen[0]?.gap_days, MAX_PROPOSALS + 9);
  assert.equal(chosen[0]?.best_seed_face_id, REFERENCE);
  assert.ok(
    chosen.every(
      (p, i) => i === 0 || p.similarity <= (chosen[i - 1]?.similarity ?? 1),
    ),
  );
  const two = [...ONE, { face_id: 901, taken: NAMED }];
  assert.equal(chooseLookalikes(two, many, null).length, MAX_PROPOSALS + 10);
});
