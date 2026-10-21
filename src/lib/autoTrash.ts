/**
 * The passes of `npm run dedupe` (scripts/dedupe.ts): the extra photos of
 * the stacks (photo_groups) into the Corbeille, one lot per pass, and only
 * where nothing is in doubt. The owner keeps one photo of a stack, copies
 * across folders and RAW + JPEG included (his calibration answers,
 * 2026-10-21); the stack's rank says which.
 *
 * - copies: of the same file in several places (copy_of), the copy ranked
 *   first stays, the others go when both hold the same MD5 in photos.etag
 *   (the bucket's, not a multipart's), and the bucket still says so when
 *   planned (verifyCopies): both, the stricter.
 * - near: of a stack, the front stays; a near-duplicate of it goes when it
 *   scores NET_GAP below it, and neither shows a face: between two
 *   moments of people (a look, a smile) the score picked the owner's
 *   photo 10 times in 22, so those wait for him.
 *
 * A photo stays, and its stack waits for the owner in Doublons, when any
 * hold says so (Hold). The plan is written to a file for the owner's look;
 * applying it plans again in one snapshot and writes nothing unless every
 * photo shown still goes, with the same photo kept.
 */
import type { PoolClient } from "pg";
import { inGallery, OWNED, runTransaction } from "./database";
import { GROUPS_LOCK } from "./groupsLock";
import { linked, SHAPE_TOLERANCE } from "./keep";
import { markTrashed, newLot, type TrashLot } from "./trash";

export type DedupePass = "copies" | "near";

export const DEDUPE_PASSES: readonly DedupePass[] = ["copies", "near"];

/**
 * Score gap a near-duplicate must trail the front by (worker groups.py
 * NET_GAP, measured there): on the owner's 22 choices in bursts, the score
 * missed his pick only when its lead was 0.36 or less.
 */
export const NET_GAP = 0.5;

/** An ETag that is an MD5: a multipart upload's ends in -<parts> (db/schema.sql photos.etag). */
const MD5_SQL = "^[0-9a-f]{32}$";

/** What keeps a photo out of the Corbeille. */
export type Hold =
  /** a favourite */
  | "favorite"
  /** someone named on it is not named on the photo kept */
  | "person"
  /** in a shared folder the photo kept is not in */
  | "shared"
  /** the photo kept has no thumbnail: it may not show */
  | "kept_thumbnail"
  /** dimensions unknown on either side */
  | "dimensions"
  /** more pixels than the photo kept */
  | "larger"
  /** another shape than the photo kept: a crop (near only) */
  | "crop"
  /** within NET_GAP of the photo kept (near only) */
  | "close"
  /** the pair rule does not link it to the photo kept itself (keep.ts
   *  linked): a stack is a star around its centre (near only) */
  | "unlinked"
  /** a face on it or on the photo kept (near only) */
  | "faces"
  /** not the same MD5 stored for both files, or not vouched for by the bucket (copies only) */
  | "bytes";

export const HOLDS: readonly Hold[] = [
  "favorite",
  "person",
  "shared",
  "kept_thumbnail",
  "dimensions",
  "larger",
  "crop",
  "close",
  "unlinked",
  "faces",
  "bytes",
];

const PASS_HOLDS: Record<DedupePass, readonly Hold[]> = {
  copies: ["favorite", "person", "shared", "kept_thumbnail", "bytes"],
  // A near-duplicate is another file: the bytes hold is the copies' only
  near: HOLDS.filter((hold) => hold !== "bytes"),
};

export interface Candidate {
  id: number;
  /** The photo kept in its place */
  keep: number;
  group_id: number;
  /** s3_key of the photo, and of the one kept */
  key: string;
  kept_key: string;
  holds: Hold[];
}

export interface DedupePlan {
  pass: DedupePass;
  /** What the lot is called when it is not the whole pass (inFolders) */
  label?: string;
  net_gap: number;
  /** Photos that go: no hold */
  go: Candidate[];
  /** Photos that stay, with their holds */
  held: Candidate[];
}

/**
 * Per photo of the pass, the photo kept in its place and the holds, over
 * the gallery's photos (an excluded folder, the Corbeille: neither kept
 * nor thrown away).
 */
function candidatesSql(pass: DedupePass): string {
  // copies: a unit per file (copy_of), the copy ranked first kept;
  // near: a unit per stack, its front kept, the front's own copies left to
  // the copies pass
  const unit = pass === "copies" ? "copy_of" : "group_id";
  const members =
    pass === "copies"
      ? "m.copy_of IS NOT NULL"
      : "(m.copy_of IS NULL OR k.copy_of IS NULL OR m.copy_of <> k.copy_of)";
  const ratio = (x: string) =>
    `(greatest(${x}.w, ${x}.h) / nullif(least(${x}.w, ${x}.h), 0))`;
  // A copy is the same bytes (the bytes hold); a near-duplicate must be
  // linked to the photo kept by the pair rule, not only to the centre
  const unlinked =
    pass === "copies"
      ? "false"
      : `NOT EXISTS (
          SELECT 1 FROM photos mp
          JOIN photos kp ON kp.id = k.photo_id
          JOIN photo_embeddings em ON em.photo_id = mp.id
          JOIN photo_embeddings ek ON ek.photo_id = kp.id AND ek.model = em.model
          WHERE mp.id = m.photo_id AND ${linked("mp", "kp", "em", "ek")})`;
  return `
    WITH member AS MATERIALIZED (
      SELECT g.group_id, g.photo_id, g.rank, g.score, g.copy_of, p.folder_id, p.s3_key, p.etag,
             f.path AS folder_path, coalesce(p.is_favorite, false) AS favorite,
             p.thumbnail_status,
             (p.metadata -> 'dimensions' ->> 'width')::float8 AS w,
             (p.metadata -> 'dimensions' ->> 'height')::float8 AS h
      FROM photo_groups g
      JOIN photos p ON p.id = g.photo_id
      JOIN folders f ON f.id = p.folder_id
      WHERE ${inGallery("p")} AND p.mime_type LIKE 'image/%'
    ),
    kept AS (
      SELECT DISTINCT ON (${unit}) ${unit} AS unit, photo_id
      FROM member WHERE ${unit} IS NOT NULL
      ORDER BY ${unit}, rank
    )
    SELECT m.photo_id::int AS id, k.photo_id::int AS keep, m.group_id::int AS group_id,
      m.s3_key AS key, k.s3_key AS kept_key, m.favorite,
      EXISTS (
        SELECT 1 FROM faces mf
        WHERE mf.photo_id = m.photo_id AND mf.person_id IS NOT NULL
          AND mf.assignment IN ${OWNED}
          AND NOT EXISTS (
            SELECT 1 FROM faces kf
            WHERE kf.photo_id = k.photo_id AND kf.person_id = mf.person_id
              AND kf.assignment IN ${OWNED})
      ) AS person,
      m.folder_id <> k.folder_id AND EXISTS (
        SELECT 1 FROM shared_folders s
        WHERE s.folder_id = m.folder_id OR s.folder_path = m.folder_path
      ) AS shared,
      k.thumbnail_status IS DISTINCT FROM 'generated' AS kept_thumbnail,
      (m.w IS NULL OR m.h IS NULL OR k.w IS NULL OR k.h IS NULL
       OR least(m.w, m.h, k.w, k.h) <= 0) AS dimensions,
      coalesce(m.w * m.h > k.w * k.h, false) AS larger,
      coalesce(abs(${ratio("m")} - ${ratio("k")}) > ${SHAPE_TOLERANCE} * ${ratio("k")}, false) AS crop,
      k.score - m.score < $1::float8 AS close,
      ${unlinked} AS unlinked,
      EXISTS (SELECT 1 FROM faces af WHERE af.photo_id IN (m.photo_id, k.photo_id)) AS faces,
      NOT coalesce(m.etag ~ '${MD5_SQL}' AND m.etag = k.etag, false) AS bytes
    FROM kept
    JOIN member k ON k.photo_id = kept.photo_id
    JOIN member m ON m.${unit} = kept.unit AND m.photo_id <> k.photo_id
    WHERE ${members}
    ORDER BY m.group_id, m.rank, m.photo_id`;
}

type Row = Omit<Candidate, "holds"> & Record<Hold, boolean>;

async function plan(client: PoolClient, pass: DedupePass): Promise<DedupePlan> {
  const rows = await client.query<Row>(candidatesSql(pass), [NET_GAP]);
  const go: Candidate[] = [];
  const held: Candidate[] = [];
  for (const row of rows.rows) {
    const holds = PASS_HOLDS[pass].filter((hold) => row[hold]);
    const candidate = {
      id: row.id,
      keep: row.keep,
      group_id: row.group_id,
      key: row.key,
      kept_key: row.kept_key,
      holds,
    };
    (holds.length === 0 ? go : held).push(candidate);
  }
  return { pass, net_gap: NET_GAP, go, held };
}

/** What the pass would throw away now, and what it would leave. Writes nothing. */
export function planDedupe(pass: DedupePass): Promise<DedupePlan> {
  return runTransaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    return plan(client, pass);
  });
}

/** A file's MD5 as the bucket keeps it; null when it cannot vouch (a multipart upload, none). */
export type Fingerprint = (key: string) => Promise<string | null>;

/**
 * The copies pass checked against the bucket, after the stored ETags: a
 * copy goes only when the bucket's MD5 of its file and of the kept one are
 * the same now (a file replaced since the sync's last run holds a stale
 * ETag). The same size, dimensions and picture are not proof (an
 * uncompressed RAW of a burst has its neighbour's size). The others stay,
 * hold "bytes". `concurrency` requests at a time.
 */
export async function verifyCopies(
  shown: DedupePlan,
  fingerprint: Fingerprint,
  concurrency = 24,
): Promise<DedupePlan> {
  const keys = [...new Set(shown.go.flatMap((c) => [c.key, c.kept_key]))];
  const sums = new Map<string, string | null>();
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < keys.length) {
        const key = keys[next++];
        if (key === undefined) break;
        sums.set(key, await fingerprint(key).catch(() => null));
      }
    }),
  );
  const same = (c: Candidate) => {
    const sum = sums.get(c.key);
    return typeof sum === "string" && sum === sums.get(c.kept_key);
  };
  return {
    ...shown,
    go: shown.go.filter(same),
    held: [
      ...shown.held,
      ...shown.go
        .filter((c) => !same(c))
        .map((c) => ({ ...c, holds: ["bytes" as const] })),
    ],
  };
}

/**
 * The part of a plan whose photos lie in the same folder as the photo kept
 * (`same`), or in another: a lot each, put back apart.
 */
export function inFolders(plan: DedupePlan, same: boolean): DedupePlan {
  const folder = (key: string) => key.slice(0, key.lastIndexOf("/"));
  return {
    ...plan,
    label: `${plan.pass}.${same ? "same" : "other"}`,
    go: plan.go.filter((c) => (folder(c.key) === folder(c.kept_key)) === same),
  };
}

/** The pass's plan differs from the one shown, or the database moved under it: nothing written. */
export class DedupeRefused extends Error {}

const key = (c: Candidate) => `${c.id}>${c.keep}`;

/**
 * Throws away the photos of `shown` (a plan of the same pass, the one the
 * owner looked at) as one lot of 'auto', if planning again now still
 * sends every one of them, with the same photo kept; photos the new plan
 * would add are not shown, so not written. In one snapshot (repeatable
 * read) holding the groups lock; checks that it marked exactly those and
 * that no photo changed otherwise. Returns the lot and the ids marked.
 */
export function applyDedupe(
  shown: DedupePlan,
): Promise<{ lot: TrashLot; trashed: number[] }> {
  return runTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const locked = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS ok",
      [GROUPS_LOCK],
    );
    // Its writes take the lock; from its first read to its end it holds the
    // 'groups' lease (worker lease.py), which the pooler keeps
    const leased = await client.query(
      "SELECT 1 FROM task_leases WHERE task = 'groups' AND expires_at > now()",
    );
    if (!locked.rows[0]?.ok || (leased.rowCount ?? 0) > 0)
      throw new DedupeRefused("a groups worker is running");
    // The photos of the stacks it touches, locked: one thrown away alone
    // (the viewer's trash, which takes no lock) since this snapshot fails it
    const stacks = [...new Set(shown.go.map((c) => c.group_id))];
    await client.query(
      `SELECT p.id FROM photos p JOIN photo_groups g ON g.photo_id = p.id
       WHERE g.group_id = ANY($1::bigint[])
       ORDER BY p.id FOR UPDATE OF p`,
      [stacks],
    );
    const now = await plan(client, shown.pass);
    const current = new Set(now.go.map(key));
    const gone = shown.go.filter((c) => !current.has(key(c)));
    if (now.net_gap !== shown.net_gap || gone.length > 0)
      throw new DedupeRefused(
        `the stacks changed since the plan: ${gone.length} of the ${shown.go.length} photos shown would not go now`,
      );
    const before = await snapshot(client);
    const lot = newLot("auto", shown.label ?? shown.pass);
    const trashed = await markTrashed(client, shown.go, lot);
    const after = await snapshot(client);
    if (trashed.length !== shown.go.length)
      throw new DedupeRefused(
        `${trashed.length} photos marked, ${shown.go.length} planned`,
      );
    const emptied = await client.query(
      `SELECT 1 FROM photo_groups k
       WHERE k.group_id = ANY($1::bigint[]) AND NOT EXISTS (
         SELECT 1 FROM photo_groups m JOIN photos p ON p.id = m.photo_id
         WHERE m.group_id = k.group_id AND ${inGallery()})
       LIMIT 1`,
      [stacks],
    );
    if (emptied.rows.length > 0)
      throw new DedupeRefused(
        "a stack would be left with nothing in the gallery",
      );
    if (
      after.hash !== before.hash ||
      after.photos !== before.photos ||
      after.trashed !== before.trashed + trashed.length
    )
      throw new DedupeRefused(
        `more than the Corbeille's marks changed: ${JSON.stringify({ before, after })}`,
      );
    return { lot, trashed };
  });
}

/** Photos, those in the Corbeille, and a hash of every photo's columns but the Corbeille's. */
async function snapshot(client: PoolClient) {
  const result = await client.query<{
    photos: number;
    trashed: number;
    hash: string;
  }>(
    `SELECT count(*)::int AS photos,
            count(*) FILTER (WHERE trashed_at IS NOT NULL)::int AS trashed,
            md5(string_agg(md5(concat_ws('|', id, folder_id, filename, s3_key, size,
              mime_type, created_at, modified_at, thumbnail_path, metadata::text,
              metadata_status, thumbnail_status, is_favorite, last_synced)), '' ORDER BY id)) AS hash
     FROM photos`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("no snapshot");
  return row;
}
