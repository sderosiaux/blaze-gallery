import type { PoolClient } from "pg";
import type { Photo, PhotoMetadata } from "@/types";
import {
  andInGallery,
  andPhotoFilter,
  listQuery,
  query,
  runTransaction,
  type PhotoFilter,
} from "./database";
import {
  asFaceBox,
  faceCropUrl,
  isOwned,
  takenOn,
  turnBox,
  uprightTurn,
  type Assignment,
  type DateSource,
  type FaceBox,
} from "./faces";
import { logger } from "./logger";
import {
  chooseLookalikes,
  REJECTED_MARGIN,
  REVIEW_THRESHOLD,
} from "./lookalikes";
import { thumbnailUrl } from "./photoUrls";
import { userRotation } from "./rotation";

/**
 * People and their faces, server side. The rules (db/schema.sql, faces and
 * face_candidates) are the worker's too (worker/blaze_worker/people_store.py):
 * faces.person_id + assignment say who a face is; face_candidates is the
 * review queue and remembers each decision, so a face the owner turned down
 * is never proposed again for that person. A face on a photo out of the
 * gallery (excluded_folders) is left out of all of it: kept, never shown,
 * never a reference.
 */

/** A request the database contradicts: the route answers with its status. */
export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
  ) {
    super(message);
  }
}

export interface PersonRow {
  id: number;
  name: string | null;
  /** ISO day, or null while the owner has not given it */
  birth_date: string | null;
}

export interface PersonSummary extends PersonRow {
  photo_count: number;
  pending_count: number;
  /** Face shown for the person: COVER_ORDER */
  cover_face_id: number | null;
  first_taken: string | null;
  last_taken: string | null;
}

/** A proposal still worth showing: its face became nobody else's meanwhile (f = faces). */
const STILL_OPEN = `(f.assignment IS NULL OR f.assignment = 'rejected')`;

/** The face's photo (ph = photos) is in the gallery. */
const GALLERY = andInGallery("ph.s3_key");

const PERSON_COLUMNS =
  "p.id::int AS id, p.name, p.birth_date::text AS birth_date";

/**
 * Faces the owner gave or confirmed (seed, manual), and how typical each is
 * of its person: in the closer half to the mean of those faces. A face
 * behind a helmet visor or sunglasses stays frontal, sharp and "eyes open"
 * for the measures, but falls in the far half (2026-10: Suzie's visor faces
 * 92nd and 101st of 117, Céline's sunglasses 31st and 36th of 41).
 */
const VALIDATED_FACES = `validated AS MATERIALIZED (
    SELECT f.id, f.person_id, f.embedding FROM faces f
    JOIN photos ph ON ph.id = f.photo_id
    WHERE f.person_id IS NOT NULL AND f.assignment IN ('seed', 'manual')
      ${GALLERY}
  ),
  typical AS MATERIALIZED (
    SELECT v.id, percent_rank() OVER (PARTITION BY v.person_id
             ORDER BY v.embedding <=> c.mean) <= 0.5 AS typical
    FROM validated v
    JOIN (SELECT person_id, avg(embedding) AS mean FROM validated
          GROUP BY person_id) c ON c.person_id = v.person_id
  )`;

/**
 * The person's face for a cover, among the owner's faces (the machine's
 * only when there is none): good enough to define her, typical of her, eyes
 * open, frontal, at least 100 px in the 2048 px rendition the crop is cut
 * from (EDGE in displayRendition.ts), sharp; the latest of those. f = faces,
 * ph = photos; `typical` is how typical f is, when known.
 */
const coverOrder = (typical: string | null) => `f.cluster_eligible DESC,
  ${typical === null ? "" : `${typical} DESC,`}
  (least(f.eye_left_open, f.eye_right_open) >= 0.2) DESC NULLS LAST,
  (abs(f.yaw) + abs(f.pitch) <= 20) DESC NULLS LAST,
  (greatest(f.width_px, f.height_px) * least(1, 2048.0 / nullif(greatest(
     (ph.metadata -> 'dimensions' ->> 'width')::int,
     (ph.metadata -> 'dimensions' ->> 'height')::int), 0)) >= 100) DESC NULLS LAST,
  (f.sharpness >= 300) DESC NULLS LAST,
  (ph.metadata ->> 'date_taken') DESC NULLS LAST, f.id`;

export async function listPeople(): Promise<PersonSummary[]> {
  const result = await query<PersonSummary>(
    `
    WITH ${VALIDATED_FACES}
    SELECT ${PERSON_COLUMNS},
      (SELECT count(DISTINCT (ph.filename, ph.size))::int FROM faces f
        JOIN photos ph ON ph.id = f.photo_id
        WHERE f.person_id = p.id AND f.assignment IN ('seed', 'manual', 'auto')
          ${GALLERY}) AS photo_count,
      (SELECT count(DISTINCT (ph.filename, ph.size))::int FROM face_candidates c
        JOIN faces f ON f.id = c.face_id JOIN photos ph ON ph.id = f.photo_id
        WHERE c.person_id = p.id AND c.status = 'pending' AND ${STILL_OPEN}
          ${GALLERY}) AS pending_count,
      coalesce(
        (SELECT f.id::int FROM typical t JOIN faces f ON f.id = t.id
          JOIN photos ph ON ph.id = f.photo_id
          WHERE f.person_id = p.id
          ORDER BY ${coverOrder("t.typical")} LIMIT 1),
        (SELECT f.id::int FROM faces f JOIN photos ph ON ph.id = f.photo_id
          WHERE f.person_id = p.id AND f.assignment = 'auto' ${GALLERY}
          ORDER BY ${coverOrder(null)} LIMIT 1)) AS cover_face_id,
      (SELECT min(ph.metadata ->> 'date_taken') FROM faces f JOIN photos ph ON ph.id = f.photo_id
        WHERE f.person_id = p.id AND f.assignment IN ('seed', 'manual', 'auto')
          ${GALLERY}) AS first_taken,
      (SELECT max(ph.metadata ->> 'date_taken') FROM faces f JOIN photos ph ON ph.id = f.photo_id
        WHERE f.person_id = p.id AND f.assignment IN ('seed', 'manual', 'auto')
          ${GALLERY}) AS last_taken
    FROM people p
    WHERE p.name IS NOT NULL
    ORDER BY photo_count DESC, lower(p.name)
    `,
  );
  return result.rows;
}

/** A named person as the filters offer them: name, a face, how many photos. */
export interface PersonChoice {
  id: number;
  name: string;
  cover_face_id: number | null;
  /** Faces named as them: their photos, copies counted */
  faces: number;
}

/**
 * The named people for the filter menus and the search box, most
 * photographed first. Lighter than listPeople (3 s on the library,
 * 2026-10-19, against 0.23 s): the face shown is the best of the owner's
 * faces by coverOrder, without the typicality pass.
 */
export async function listPersonChoices(): Promise<PersonChoice[]> {
  const result = await query<PersonChoice>(
    `
    SELECT p.id::int AS id, p.name,
      (SELECT f.id::int FROM faces f JOIN photos ph ON ph.id = f.photo_id
        WHERE f.person_id = p.id AND f.assignment IN ('seed', 'manual', 'auto')
          ${GALLERY}
        ORDER BY (f.assignment <> 'auto') DESC, ${coverOrder(null)} LIMIT 1) AS cover_face_id,
      (SELECT count(*)::int FROM faces f
        WHERE f.person_id = p.id AND f.assignment IN ('seed', 'manual', 'auto')) AS faces
    FROM people p
    WHERE p.name IS NOT NULL
    ORDER BY faces DESC, lower(p.name)
    `,
  );
  return result.rows;
}

export async function getPerson(id: number): Promise<PersonRow | null> {
  const result = await query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function findPersonByName(
  name: string,
): Promise<PersonRow | null> {
  const result = await query<PersonRow>(
    `SELECT ${PERSON_COLUMNS} FROM people p WHERE lower(p.name) = lower($1) ORDER BY p.id LIMIT 1`,
    [name],
  );
  return result.rows[0] ?? null;
}

export const MAX_NAME_LENGTH = 80;

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_LENGTH)
    throw new PeopleError("Le nom est vide ou trop long", 422);
  return name;
}

/** A new person; one per name whatever the case (unique index idx_people_name). */
export async function createPerson(rawName: string): Promise<PersonRow> {
  const name = cleanName(rawName);
  const result = await query<PersonRow>(
    `INSERT INTO people (name) VALUES ($1)
     ON CONFLICT ((lower(name))) WHERE name IS NOT NULL DO NOTHING
     RETURNING id::int AS id, name, birth_date::text AS birth_date`,
    [name],
  );
  const person = result.rows[0];
  if (!person) throw new PeopleError(`« ${name} » existe déjà`, 409);
  return person;
}

// -- a person's photos ----------------------------------------------------------

/** One face, as the app and the MCP tools describe it. */
export interface FaceDetail {
  face_id: number;
  /** On the photo as shown (hand rotation applied), fractions of its width/height */
  box: FaceBox;
  /** Pixels of the original covered by the face, as shown */
  width_px: number;
  height_px: number;
  det_score: number;
  sharpness: number | null;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  eye_left_open: number | null;
  eye_right_open: number | null;
  mouth_open: number | null;
  expression: string | null;
  expression_scores: Record<string, number> | null;
  cluster_eligible: boolean;
  /** Clockwise turn that stands the face up on the photo as shown */
  upright_turn: number;
  crop_url: string;
}

const EXPRESSIONS = [
  "anger",
  "contempt",
  "disgust",
  "fear",
  "happiness",
  "neutral",
  "sadness",
  "surprise",
] as const;

export interface FaceRow {
  face_id: number;
  photo_id: number;
  box: number[];
  width_px: number;
  height_px: number;
  det_score: number;
  sharpness: number | null;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  eye_left_open: number | null;
  eye_right_open: number | null;
  mouth_open: number | null;
  expression: string | null;
  expression_scores: number[] | null;
  cluster_eligible: boolean;
  detect_rotation: number;
  person_id: number | null;
  person_name: string | null;
  assignment: Assignment | null;
}

export const FACE_COLUMNS = `f.id::int AS face_id, f.photo_id::int AS photo_id, f.box, f.width_px,
  f.height_px, f.det_score, f.sharpness, f.yaw, f.pitch, f.roll, f.eye_left_open,
  f.eye_right_open, f.mouth_open, f.expression, f.expression_scores, f.cluster_eligible,
  f.detect_rotation, f.person_id::int AS person_id, pe.name AS person_name, f.assignment`;

const round3 = (v: number | null) =>
  v === null ? null : Math.round(v * 1000) / 1000;

export function faceDetail(
  row: FaceRow,
  metadata: PhotoMetadata | null | undefined,
): FaceDetail {
  const rotation = userRotation(metadata);
  const box = asFaceBox(row.box) ?? [0, 0, 0, 0];
  const sideways = rotation === 90 || rotation === 270;
  const scores = row.expression_scores;
  return {
    face_id: row.face_id,
    box: turnBox(box, rotation).map((v) => round3(v) ?? 0) as FaceBox,
    width_px: sideways ? row.height_px : row.width_px,
    height_px: sideways ? row.width_px : row.height_px,
    det_score: round3(row.det_score) ?? 0,
    sharpness: row.sharpness === null ? null : Math.round(row.sharpness),
    yaw: round3(row.yaw),
    pitch: round3(row.pitch),
    roll: round3(row.roll),
    eye_left_open: round3(row.eye_left_open),
    eye_right_open: round3(row.eye_right_open),
    mouth_open: round3(row.mouth_open),
    expression: row.expression,
    expression_scores: scores
      ? Object.fromEntries(
          EXPRESSIONS.map((name, i) => [name, round3(scores[i] ?? 0) ?? 0]),
        )
      : null,
    cluster_eligible: row.cluster_eligible,
    upright_turn: uprightTurn(row.detect_rotation, rotation),
    crop_url: faceCropUrl(row.face_id),
  };
}

type PhotoRow = Omit<Photo, "thumbnail_url"> & { folder_path: string | null };

export interface PersonPhoto extends Photo {
  folder_path: string | null;
  /** When it was taken: EXIF, or the folder's date when they disagree by > 6 months */
  taken: string | null;
  date_source: DateSource | null;
  face_id: number;
  assignment: Assignment;
  /** Cosine similarity when the machine proposed it; null for the owner's own picks */
  similarity: number | null;
  /** Who said yes: owner, agent (an assistant checking crops), auto; null for seeds */
  decided_by: "owner" | "agent" | "auto" | null;
  /** The same file elsewhere in the library (same name and size): not listed again */
  copies: number[];
}

interface PersonFaceRow extends PhotoRow {
  face_id: number;
  assignment: Assignment;
  similarity: number | null;
  decided_by: PersonPhoto["decided_by"];
}

function byTaken<T extends { taken: string | null; id: number }>(a: T, b: T) {
  if (a.taken && b.taken && a.taken !== b.taken)
    return a.taken < b.taken ? -1 : 1;
  if (a.taken && !b.taken) return -1;
  if (!a.taken && b.taken) return 1;
  return a.id - b.id;
}

/**
 * The library holds copies of the same file in several folders (same name,
 * same size: the rule of the duplicates report). A person's photos and the
 * review queue show one of them; the others ride along.
 */
function copyKey(photo: { filename: string; size: number | string }): string {
  return `${photo.filename}\u0000${String(photo.size)}`;
}

/** Newest first, undated last: the order of a person's page. */
function newestFirst<T extends { taken: string | null; id: number }>(
  a: T,
  b: T,
) {
  if (a.taken && b.taken && a.taken !== b.taken)
    return a.taken > b.taken ? -1 : 1;
  if (a.taken && !b.taken) return -1;
  if (!a.taken && b.taken) return 1;
  return b.id - a.id;
}

/** What a set of copies is told apart and dated by. */
interface CopyRow {
  id: number;
  filename: string;
  size: number | string;
  folder_path: string | null;
  date_taken: string | null | undefined;
}

type Dated<T> = T & {
  taken: string | null;
  date_source: DateSource | null;
  copies: number[];
};

/**
 * One photo per set of copies, rows in path order: the one whose folder
 * dates it when the camera clock disagrees (takenOn), else the first by
 * path; the others are its `copies`.
 */
function onePerCopy<T extends CopyRow>(rows: T[]): Dated<T>[] {
  const kept = new Map<string, Dated<T>>();
  for (const row of rows) {
    const { taken, source } = takenOn(row.date_taken, row.folder_path);
    const photo: Dated<T> = { ...row, taken, date_source: source, copies: [] };
    const key = copyKey(row);
    const first = kept.get(key);
    if (!first) kept.set(key, photo);
    else if (first.date_source !== "folder" && source === "folder")
      kept.set(key, { ...photo, copies: [...first.copies, first.id] });
    else first.copies.push(photo.id);
  }
  return [...kept.values()];
}

/**
 * Every photo of the person, oldest first (undated last), one per set of
 * copies (onePerCopy).
 */
export async function personPhotos(personId: number): Promise<PersonPhoto[]> {
  const result = await query<PersonFaceRow>(
    `
    SELECT ph.*, fo.path AS folder_path, f.id::int AS face_id, f.assignment,
           c.similarity, c.decided_by
    FROM faces f
    JOIN photos ph ON ph.id = f.photo_id
    LEFT JOIN folders fo ON fo.id = ph.folder_id
    LEFT JOIN face_candidates c ON c.person_id = f.person_id AND c.face_id = f.id
    WHERE f.person_id = $1 AND f.assignment IN ('seed', 'manual', 'auto')
      ${GALLERY}
    ORDER BY fo.path, ph.id
    `,
    [personId],
  );
  return onePerCopy(
    result.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      date_taken: row.metadata?.date_taken,
    })),
  )
    .map(({ date_taken: _, ...row }) => personPhoto(row))
    .sort(byTaken);
}

function personPhoto(row: Dated<PersonFaceRow & { id: number }>): PersonPhoto {
  return {
    ...row,
    is_favorite: Boolean(row.is_favorite),
    thumbnail_url: thumbnailUrl(row.id),
    similarity: round3(row.similarity),
  };
}

/** Where a person's page goes on: the last photo's date and id. */
export interface PersonPhotoCursor {
  taken: string | null;
  id: number;
}

export interface PersonPhotoPage {
  photos: PersonPhoto[];
  next: PersonPhotoCursor | null;
  /** Photos of the whole list, one per set of copies */
  total: number;
  /** Photos per year taken, newest first, undated (null) last */
  years: { year: number | null; count: number }[];
}

/**
 * A page of the person's photos passing `filter`, newest first (undated
 * last), one per set of copies (onePerCopy), after `after`. The order
 * follows takenOn, which reads folder names: every photo of the list is
 * read in narrow rows (id, name, size, path, date) to sort them, then only
 * the page in full. 24k faces for the most photographed person: about 1 MB
 * of narrow rows, where the page used to load every photo in full. Without
 * `after`, `around` (a photo a link opens) starts the list at the page
 * of `limit` holding it, the newer ones left out.
 */
export async function personPhotoPage(
  personId: number,
  filter: PhotoFilter,
  after: PersonPhotoCursor | null,
  limit: number,
  around: number | null = null,
): Promise<PersonPhotoPage> {
  const params: unknown[] = [personId];
  const narrow = andPhotoFilter(params, filter);
  const keys = await listQuery<CopyRow>(
    `
    SELECT p.id::int AS id, p.filename, p.size::text AS size,
           fo.path AS folder_path, p.metadata->>'date_taken' AS date_taken
    FROM faces f
    JOIN photos p ON p.id = f.photo_id
    LEFT JOIN folders fo ON fo.id = p.folder_id
    WHERE f.person_id = $1 AND f.assignment IN ('seed', 'manual', 'auto')
      ${narrow}
    ORDER BY fo.path, p.id
    `,
    params,
  );
  const sorted = onePerCopy(keys.rows).sort(newestFirst);
  const rest = after
    ? sorted.filter((photo) => newestFirst(photo, after) > 0)
    : sorted;
  const at =
    after !== null || around === null
      ? -1
      : rest.findIndex((photo) => photo.id === around);
  const start = at < 0 ? 0 : at - (at % limit);
  const page = rest.slice(start, start + limit);
  const rows = await query<PersonFaceRow>(
    `
    SELECT ph.*, fo.path AS folder_path, f.id::int AS face_id, f.assignment,
           c.similarity, c.decided_by
    FROM faces f
    JOIN photos ph ON ph.id = f.photo_id
    LEFT JOIN folders fo ON fo.id = ph.folder_id
    LEFT JOIN face_candidates c ON c.person_id = f.person_id AND c.face_id = f.id
    WHERE f.person_id = $1 AND f.assignment IN ('seed', 'manual', 'auto')
      AND ph.id = ANY($2::bigint[])
    `,
    [personId, page.map((photo) => photo.id)],
  );
  const byId = new Map(rows.rows.map((row) => [Number(row.id), row]));
  const photos = page.flatMap((key) => {
    const row = byId.get(key.id);
    return row
      ? [
          personPhoto({
            ...row,
            id: key.id,
            taken: key.taken,
            date_source: key.date_source,
            copies: key.copies,
          }),
        ]
      : [];
  });
  const last = page[page.length - 1];
  const years = new Map<number | null, number>();
  for (const photo of sorted) {
    const year = photo.taken ? new Date(photo.taken).getUTCFullYear() : null;
    years.set(year, (years.get(year) ?? 0) + 1);
  }
  return {
    photos,
    next:
      rest.length > start + limit && last
        ? { taken: last.taken, id: last.id }
        : null,
    total: sorted.length,
    years: [...years].map(([year, count]) => ({ year, count })),
  };
}

// -- the review queue ------------------------------------------------------------

export interface Candidate {
  face_id: number;
  /** This face and the same face on copies of the photo: decided together */
  face_ids: number[];
  similarity: number | null;
  taken: string | null;
  crop_url: string;
  photo: Photo & { folder_path: string | null };
}

interface CandidateRow extends PhotoRow {
  face_id: number;
  similarity: number | null;
}

export async function pendingCandidates(
  personId: number,
  limit: number,
): Promise<{ candidates: Candidate[]; total: number }> {
  const [rows, count] = await Promise.all([
    query<CandidateRow>(
      `
      SELECT ph.*, fo.path AS folder_path, c.face_id::int AS face_id, c.similarity
      FROM face_candidates c
      JOIN faces f ON f.id = c.face_id
      JOIN photos ph ON ph.id = f.photo_id
      LEFT JOIN folders fo ON fo.id = ph.folder_id
      WHERE c.person_id = $1 AND c.status = 'pending' AND ${STILL_OPEN} ${GALLERY}
      ORDER BY c.similarity DESC NULLS LAST, c.face_id
      LIMIT $2
      `,
      [personId, limit],
    ),
    query<{ total: number }>(
      `SELECT count(DISTINCT (ph.filename, ph.size))::int AS total
       FROM face_candidates c
       JOIN faces f ON f.id = c.face_id
       JOIN photos ph ON ph.id = f.photo_id
       WHERE c.person_id = $1 AND c.status = 'pending' AND ${STILL_OPEN} ${GALLERY}`,
      [personId],
    ),
  ]);
  const groups = new Map<string, Candidate>();
  for (const { face_id, similarity, ...photo } of rows.rows) {
    const key = copyKey(photo);
    const group = groups.get(key);
    if (group) {
      group.face_ids.push(face_id);
      continue;
    }
    groups.set(key, {
      face_id,
      face_ids: [face_id],
      similarity: round3(similarity),
      taken: takenOn(photo.metadata?.date_taken, photo.folder_path).taken,
      crop_url: faceCropUrl(face_id),
      photo: {
        ...photo,
        id: Number(photo.id),
        is_favorite: Boolean(photo.is_favorite),
        thumbnail_url: thumbnailUrl(photo.id),
      },
    });
  }
  return {
    total: count.rows[0]?.total ?? 0,
    candidates: [...groups.values()],
  };
}

// -- decisions ------------------------------------------------------------------------

export type Decision = "accept" | "reject" | "undo";

interface FaceState {
  id: number;
  photo_id: number;
  person_id: number | null;
  assignment: Assignment | null;
}

async function lockFaces(
  client: PoolClient,
  faceIds: number[],
): Promise<FaceState[]> {
  const result = await client.query<FaceState>(
    `SELECT id::int AS id, photo_id::int AS photo_id, person_id::int AS person_id, assignment
     FROM faces WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [faceIds],
  );
  if (result.rows.length !== new Set(faceIds).size)
    throw new PeopleError("Visage introuvable", 404);
  return result.rows;
}

async function recordDecision(
  client: PoolClient,
  personId: number,
  faceIds: number[],
  status: "accepted" | "rejected",
): Promise<void> {
  await client.query(
    `INSERT INTO face_candidates (person_id, face_id, status, decided_by, decided_at)
     SELECT $1, id, $3, 'owner', now() FROM faces WHERE id = ANY($2::bigint[])
     ON CONFLICT (person_id, face_id) DO UPDATE SET
       status = EXCLUDED.status, decided_by = 'owner', decided_at = now(), updated_at = now()`,
    [personId, faceIds, status],
  );
}

/**
 * The face becomes the person's. A face already named as someone else is
 * refused, unless renaming (the viewer): then that person is told no.
 */
async function acceptFaces(
  client: PoolClient,
  personId: number,
  given: FaceState[],
  rename: boolean,
): Promise<void> {
  // Already hers (a seed stays a seed)
  const faces = given.filter(
    (f) => !(f.person_id === personId && isOwned(f.assignment)),
  );
  if (faces.length === 0) return;
  const elsewhere = faces.filter(
    (f) =>
      f.person_id !== null && f.person_id !== personId && isOwned(f.assignment),
  );
  if (elsewhere.length > 0 && !rename)
    throw new PeopleError(
      "Ce visage porte déjà un autre nom : changez-le depuis la photo",
      409,
    );
  const photos = new Set<number>();
  for (const face of faces) {
    if (photos.has(face.photo_id))
      throw new PeopleError(
        "Une photo ne contient la personne qu’une fois",
        409,
      );
    photos.add(face.photo_id);
  }
  const ids = faces.map((f) => f.id);
  const clash = await client.query(
    `SELECT 1 FROM faces o JOIN faces f ON f.photo_id = o.photo_id AND f.id <> o.id
     WHERE f.id = ANY($1::bigint[]) AND o.person_id = $2
       AND o.assignment IN ('seed', 'manual', 'auto') LIMIT 1`,
    [ids, personId],
  );
  if (clash.rows.length > 0)
    throw new PeopleError("Cette personne est déjà sur la photo", 409);

  // Renamed from someone else: that person gets a "no" for this face
  for (const face of elsewhere) {
    if (face.person_id !== null)
      await recordDecision(client, face.person_id, [face.id], "rejected");
  }
  await client.query(
    `UPDATE faces SET person_id = $1, assignment = 'manual' WHERE id = ANY($2::bigint[])`,
    [personId, ids],
  );
  await recordDecision(client, personId, ids, "accepted");
  // The photo holds her now: its other proposals for her go, and so do
  // other people's proposals for these faces
  await client.query(
    `DELETE FROM face_candidates c USING faces f, faces a
     WHERE c.status = 'pending' AND f.id = c.face_id AND a.id = ANY($2::bigint[])
       AND ((c.person_id = $1 AND a.photo_id = f.photo_id AND f.id <> a.id)
            OR (c.person_id <> $1 AND f.id = a.id))`,
    [personId, ids],
  );
}

async function rejectFaces(
  client: PoolClient,
  personId: number,
  faces: FaceState[],
): Promise<void> {
  const ids = faces.map((f) => f.id);
  await client.query(
    `UPDATE faces SET person_id = $1, assignment = 'rejected'
     WHERE id = ANY($2::bigint[]) AND (person_id IS NULL OR person_id = $1)`,
    [personId, ids],
  );
  await recordDecision(client, personId, ids, "rejected");
  // A face proposed because it was closest to one of these is now as close
  // to a face rejected for her as to any of hers: the worker's margin would
  // drop it too (a face named by mistake, then corrected, leaves nothing)
  await client.query(
    `DELETE FROM face_candidates
     WHERE person_id = $1 AND status = 'pending' AND best_seed_face_id = ANY($2::bigint[])`,
    [personId, ids],
  );
}

/** Back to the queue: the decision is forgotten, the face is nobody's again. */
async function undoFaces(
  client: PoolClient,
  personId: number,
  faces: FaceState[],
): Promise<void> {
  const ids = faces.map((f) => f.id);
  await client.query(
    `UPDATE faces SET person_id = NULL, assignment = NULL
     WHERE id = ANY($2::bigint[]) AND person_id = $1 AND assignment IN ('manual', 'rejected')`,
    [personId, ids],
  );
  // A face proposed by the machine waits again; one decided without a proposal is forgotten
  await client.query(
    `UPDATE face_candidates SET status = 'pending', decided_by = NULL, decided_at = NULL,
       updated_at = now()
     WHERE person_id = $1 AND face_id = ANY($2::bigint[]) AND similarity IS NOT NULL`,
    [personId, ids],
  );
  await client.query(
    `DELETE FROM face_candidates
     WHERE person_id = $1 AND face_id = ANY($2::bigint[]) AND similarity IS NULL`,
    [personId, ids],
  );
}

async function decideWith(
  client: PoolClient,
  personId: number,
  faceIds: number[],
  decision: Decision,
  rename: boolean,
): Promise<void> {
  const person = await client.query(
    "SELECT 1 FROM people WHERE id = $1 FOR SHARE",
    [personId],
  );
  if (person.rows.length === 0)
    throw new PeopleError("Personne introuvable", 404);
  const faces = await lockFaces(client, faceIds);
  if (decision === "accept") await acceptFaces(client, personId, faces, rename);
  else if (decision === "reject") await rejectFaces(client, personId, faces);
  else await undoFaces(client, personId, faces);
}

/**
 * The faces' rows are locked, not the other faces of their photos: a
 * concurrent writer (the expansion) taking the same photo for her trips the
 * unique index idx_faces_person_once_per_photo instead, answered 409.
 */
async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  try {
    return await runTransaction(work);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
      throw new PeopleError("Cette personne est déjà sur la photo", 409);
    throw error;
  }
}

/**
 * The review queue's yes, no and undo: never takes a face named as someone
 * else. A yes proposes the faces' look-alikes: returns how many.
 */
export async function decideFaces(
  personId: number,
  faceIds: number[],
  decision: Decision,
): Promise<number> {
  await inTransaction((client) =>
    decideWith(client, personId, faceIds, decision, false),
  );
  return decision === "accept" ? proposeAfterYes(personId, faceIds) : 0;
}

// -- look-alikes, proposed at once ----------------------------------------------------

/**
 * Nearest open faces a request reads, before the window and the other rules
 * (lookalikes.ts) sort them; several faces named share them, at least
 * MIN_NEIGHBOURS each. Measured on the library (2026-10): from one face of
 * someone with thousands of faces, 500 leave 25 to 85 files in the window,
 * and the index finds the same faces an exact scan does, in 15 to 85 ms.
 */
const NEIGHBOURS = 500;
const MIN_NEIGHBOURS = 100;
/**
 * Faces of one request that look for look-alikes (a row accepted at once
 * sends ten or so). Each scan costs about the same whatever its limit, as it
 * walks past the person's own faces first: 12 faces of someone with 20 000
 * took 0.7 s. The worker's next run covers the others.
 */
const MAX_REFERENCES = 4;

interface DatedFileRow {
  date_taken: string | null;
  folder_path: string | null;
  filename: string;
  size: number | string;
}

interface ReferenceRow extends DatedFileRow {
  face_id: number;
  birth_date: string | null;
}

interface NeighbourRow extends DatedFileRow {
  reference_id: number;
  face_id: number;
  similarity: number;
  rejected: {
    similarity: number;
    date_taken: string | null;
    folder_path: string | null;
  }[];
}

/**
 * For each face $1 named for person $2, the open faces nearest to it in its
 * embedding space: nobody's, or rejected only for someone else. The HNSW
 * index serves each lateral scan; iterative scan walks past the person's own
 * faces, which the filter skips. Then, like the worker: not decided for her
 * already (a pending one may be raised), no file that holds her or waits for
 * her on another face (copies count as one photo), and the faces rejected for
 * her that come about as close (the margin), for lookalikes.ts to date.
 * Every "no" writes its face_candidates row (recordDecision, and the
 * worker's decide), so those rows are all of them.
 */
const NEIGHBOURS_SQL = `
  WITH refs AS (
    SELECT id, embedding, model FROM faces WHERE id = ANY($1::bigint[])
  ),
  nearest AS (
    SELECT r.id AS reference_id, r.model, n.id, n.photo_id, n.embedding, n.distance
    FROM refs r
    CROSS JOIN LATERAL (
      SELECT f.id, f.photo_id, f.embedding, f.embedding <=> r.embedding AS distance
      FROM faces f
      JOIN photos ph ON ph.id = f.photo_id
      WHERE f.model = r.model
        AND (f.assignment IS NULL OR (f.assignment = 'rejected' AND f.person_id <> $2))
        ${GALLERY}
      ORDER BY f.embedding <=> r.embedding
      LIMIT $3
    ) n
  ),
  rejected AS MATERIALIZED (
    SELECT j.embedding, j.model, ph.metadata ->> 'date_taken' AS date_taken,
           fo.path AS folder_path
    FROM faces j
    JOIN photos ph ON ph.id = j.photo_id
    LEFT JOIN folders fo ON fo.id = ph.folder_id
    WHERE j.id IN (SELECT face_id FROM face_candidates
                   WHERE person_id = $2 AND status = 'rejected')
      ${GALLERY}
  )
  SELECT n.reference_id::int AS reference_id, n.id::int AS face_id,
    1 - n.distance AS similarity,
    ph.metadata ->> 'date_taken' AS date_taken, fo.path AS folder_path,
    ph.filename, ph.size,
    (SELECT coalesce(json_agg(json_build_object(
              'similarity', 1 - (j.embedding <=> n.embedding),
              'date_taken', j.date_taken, 'folder_path', j.folder_path)), '[]'::json)
     FROM rejected j
     WHERE j.model = n.model AND (j.embedding <=> n.embedding) <= n.distance + $5) AS rejected
  FROM nearest n
  JOIN photos ph ON ph.id = n.photo_id
  LEFT JOIN folders fo ON fo.id = ph.folder_id
  WHERE n.distance <= $4
    AND NOT EXISTS (
      SELECT 1 FROM face_candidates d
      WHERE d.person_id = $2 AND d.face_id = n.id AND d.status <> 'pending')
    AND NOT EXISTS (
      SELECT 1 FROM photos cp JOIN faces o ON o.photo_id = cp.id
      WHERE cp.filename = ph.filename AND cp.size = ph.size AND o.id <> n.id
        ${andInGallery("cp.s3_key")}
        AND ((o.person_id = $2 AND o.assignment IN ('seed', 'manual', 'auto'))
          OR EXISTS (SELECT 1 FROM face_candidates oc
                     WHERE oc.person_id = $2 AND oc.face_id = o.id AND oc.status = 'pending')))
`;

/**
 * Pending, as the worker writes "to review", with the face named it is
 * closest to as best seed. A face still waiting is raised when that face is
 * closer, never lowered; a decided one is left alone. Returns a row per face
 * written, inserted or raised.
 */
const PROPOSE_SQL = `
  INSERT INTO face_candidates (person_id, face_id, similarity, best_seed_face_id, gap_days)
  SELECT $1, f.id, x.similarity, x.best_seed_face_id, x.gap_days
  FROM unnest($2::bigint[], $3::real[], $4::bigint[], $5::int[])
    AS x(face_id, similarity, best_seed_face_id, gap_days)
  JOIN faces f ON f.id = x.face_id
  WHERE f.assignment IS NULL OR (f.assignment = 'rejected' AND f.person_id <> $1)
  ON CONFLICT (person_id, face_id) DO UPDATE SET
    similarity = EXCLUDED.similarity, best_seed_face_id = EXCLUDED.best_seed_face_id,
    gap_days = EXCLUDED.gap_days, updated_at = now()
  WHERE face_candidates.status = 'pending'
    AND coalesce(face_candidates.similarity, -1) < EXCLUDED.similarity
  RETURNING (xmax = 0) AS inserted
`;

/**
 * Proposes in her « À trier » queue the look-alikes of faces just made hers
 * (lookalikes.ts), without waiting for the worker: pending only, never
 * accepted. Returns how many photos joined the queue.
 */
export async function proposeLookalikes(
  personId: number,
  faceIds: number[],
): Promise<number> {
  return runTransaction((client) =>
    proposeLookalikesWith(client, personId, faceIds),
  );
}

/**
 * proposeLookalikes in the caller's transaction (SET LOCAL lasts until its
 * end). Each statement is a round trip, and the functions may run far from
 * the database (2026-10: Washington and London): four, however many faces.
 */
export async function proposeLookalikesWith(
  client: PoolClient,
  personId: number,
  faceIds: number[],
): Promise<number> {
  const faces = await client.query<ReferenceRow>(
    `SELECT f.id::int AS face_id, ph.metadata ->> 'date_taken' AS date_taken,
            fo.path AS folder_path, ph.filename, ph.size,
            (SELECT birth_date::text FROM people WHERE id = $2) AS birth_date
     FROM faces f
     JOIN photos ph ON ph.id = f.photo_id
     LEFT JOIN folders fo ON fo.id = ph.folder_id
     WHERE f.id = ANY($1::bigint[]) AND f.person_id = $2
       AND f.assignment IN ('seed', 'manual', 'auto') ${GALLERY}
     ORDER BY f.id`,
    [faceIds, personId],
  );
  // Copies of a file dated alike find the same neighbours: one of them looks
  const references = new Map<string, { face_id: number; taken: string }>();
  for (const row of faces.rows) {
    const taken = takenOn(row.date_taken, row.folder_path).taken;
    const key = `${copyKey(row)}\u0000${taken ?? ""}`;
    if (taken && !references.has(key))
      references.set(key, { face_id: row.face_id, taken });
  }
  const chosenReferences = [...references.values()].slice(0, MAX_REFERENCES);
  if (chosenReferences.length === 0) return 0;
  const birthDate = faces.rows[0]?.birth_date ?? null;

  const perReference = Math.max(
    MIN_NEIGHBOURS,
    Math.floor(NEIGHBOURS / chosenReferences.length),
  );
  await client.query(
    `SET LOCAL hnsw.iterative_scan = relaxed_order; SET LOCAL hnsw.ef_search = ${String(perReference)}`,
  );
  const neighbours = await client.query<NeighbourRow>(NEIGHBOURS_SQL, [
    chosenReferences.map((r) => r.face_id),
    personId,
    perReference,
    1 - REVIEW_THRESHOLD,
    REJECTED_MARGIN,
  ]);
  const chosen = chooseLookalikes(
    chosenReferences,
    neighbours.rows.map((row) => ({
      reference_id: row.reference_id,
      face_id: row.face_id,
      file: copyKey(row),
      similarity: row.similarity,
      taken: takenOn(row.date_taken, row.folder_path).taken,
      rejected: row.rejected.map((r) => ({
        similarity: r.similarity,
        taken: takenOn(r.date_taken, r.folder_path).taken,
      })),
    })),
    birthDate,
  );
  if (chosen.length === 0) return 0;
  const written = await client.query<{ inserted: boolean }>(PROPOSE_SQL, [
    personId,
    chosen.map((c) => c.face_id),
    chosen.map((c) => c.similarity),
    chosen.map((c) => c.best_seed_face_id),
    chosen.map((c) => c.gap_days),
  ]);
  return written.rows.filter((r) => r.inserted).length;
}

/** The yes is written already: a failure here only costs its proposals. */
async function proposeAfterYes(
  personId: number,
  faceIds: number[],
): Promise<number> {
  try {
    return await proposeLookalikes(personId, faceIds);
  } catch (error) {
    logger.warn(
      "Look-alikes not proposed",
      { personId, faceIds },
      error instanceof Error ? error : undefined,
    );
    return 0;
  }
}

// -- faces of one photo ---------------------------------------------------------------

export interface PhotoFace extends FaceDetail {
  person: { id: number; name: string | null } | null;
  assignment: Assignment | null;
}

export async function photoFaceRows(photoIds: number[]): Promise<FaceRow[]> {
  const result = await query<FaceRow>(
    `SELECT ${FACE_COLUMNS}
     FROM faces f JOIN photos ph ON ph.id = f.photo_id
     LEFT JOIN people pe ON pe.id = f.person_id
     WHERE f.photo_id = ANY($1::bigint[]) ${GALLERY}
     ORDER BY f.photo_id, f.box[1], f.id`,
    [photoIds],
  );
  return result.rows;
}

export function photoFace(
  row: FaceRow,
  metadata: PhotoMetadata | null | undefined,
): PhotoFace {
  const owned = isOwned(row.assignment) && row.person_id !== null;
  return {
    ...faceDetail(row, metadata),
    person: owned ? { id: row.person_id ?? 0, name: row.person_name } : null,
    assignment: row.assignment,
  };
}

/**
 * Names a face (the viewer): an existing person, or one found or created by
 * name, in one transaction, so a refused naming leaves no empty person.
 * Then proposes its look-alikes: `proposed` says how many.
 */
export async function nameFace(
  faceId: number,
  target: { personId: number } | { name: string },
): Promise<{ person: PersonRow; proposed: number }> {
  const named = await inTransaction(async (client) => {
    let person: PersonRow | undefined;
    if ("personId" in target) {
      const found = await client.query<PersonRow>(
        `SELECT ${PERSON_COLUMNS} FROM people p WHERE p.id = $1`,
        [target.personId],
      );
      person = found.rows[0];
    } else {
      const name = cleanName(target.name);
      await client.query(
        `INSERT INTO people (name) VALUES ($1)
         ON CONFLICT ((lower(name))) WHERE name IS NOT NULL DO NOTHING`,
        [name],
      );
      const found = await client.query<PersonRow>(
        `SELECT ${PERSON_COLUMNS} FROM people p WHERE lower(p.name) = lower($1)`,
        [name],
      );
      person = found.rows[0];
    }
    if (!person) throw new PeopleError("Personne introuvable", 404);
    await decideWith(client, person.id, [faceId], "accept", true);
    return person;
  });
  return {
    person: named,
    proposed: await proposeAfterYes(named.id, [faceId]),
  };
}

/** "Pas cette personne": the face is not who it was said to be. */
export async function unnameFace(faceId: number): Promise<void> {
  const result = await query<{ person_id: number | null; assignment: string }>(
    "SELECT person_id::int AS person_id, assignment FROM faces WHERE id = $1",
    [faceId],
  );
  const face = result.rows[0];
  if (!face) throw new PeopleError("Visage introuvable", 404);
  if (face.person_id === null || !isOwned(face.assignment))
    throw new PeopleError("Ce visage n’a pas de nom", 409);
  await decideFaces(face.person_id, [faceId], "reject");
}

export interface CropSource {
  face_id: number;
  box: number[];
  detect_rotation: number;
  photo_id: number;
}

export async function cropSource(faceId: number): Promise<CropSource | null> {
  const result = await query<CropSource>(
    `SELECT id::int AS face_id, box, detect_rotation, photo_id::int AS photo_id
     FROM faces WHERE id = $1`,
    [faceId],
  );
  return result.rows[0] ?? null;
}
