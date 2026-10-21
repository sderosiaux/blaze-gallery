/**
 * What « Garder celle-ci » throws away. A stack (photo_groups) is a star:
 * every member is linked to its centre, not to one another, and the photo
 * the owner keeps need not be the centre. So a member goes only when the
 * worker's pair rule (worker groups.py classify) links it to the photo
 * kept itself, in the part of the rule the database can check without
 * pixels:
 *
 *   copy   same size in bytes, same dimensions, cosine >= COPY_COSINE,
 *          and the same MD5 (photos.etag) when the bucket gave both one
 *   burst  same camera (EXIF make and model), both large enough, taken
 *          the same second at cosine >= SAME_SECOND_COSINE, or 1 to
 *          BURST_SECONDS apart at cosine >= BURST_COSINE
 *
 * The rest of the rule (`same`: no camera date, or later than a burst,
 * decided by a pixel test) needs the thumbnails: those members stay, and
 * the stack keeps them with the photo kept.
 *
 * A burst's dates must be DateTimeOriginal where imageProbe recorded the
 * tag (date_tag); photos probed before it say nothing, and count as today,
 * the same as the worker.
 */
import type { PoolClient } from "pg";
import { inGallery, query } from "./database";

/** groups.py COPY_COSINE, SAME_SECOND_COSINE, BURST_SECONDS, BURST_COSINE, MIN_SIDE */
const COPY_COSINE = 0.999;
const SAME_SECOND_COSINE = 0.9;
const BURST_SECONDS = 30;
const BURST_COSINE = 0.975;
const MIN_SIDE = 100;

type Runner = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

const width = (p: string) => `(${p}.metadata -> 'dimensions' ->> 'width')`;
const height = (p: string) => `(${p}.metadata -> 'dimensions' ->> 'height')`;
const camera = (
  p: string,
) => `CASE WHEN ${p}.metadata -> 'camera' ->> 'make' IS NOT NULL
  THEN (${p}.metadata -> 'camera' ->> 'make') || '|' || coalesce(${p}.metadata -> 'camera' ->> 'model', '') END`;
// The shot's own time: not when the date came from another EXIF tag
// (imageProbe date_tag, recorded since 2026-10-21; unknown before)
const taken = (
  p: string,
) => `CASE WHEN ${p}.metadata ->> 'date_taken' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
    AND coalesce(${p}.metadata ->> 'date_tag', 'DateTimeOriginal') = 'DateTimeOriginal'
  THEN extract(epoch FROM (${p}.metadata ->> 'date_taken')::timestamptz) END`;
const plain = (p: string) =>
  `least(${width(p)}::int, ${height(p)}::int) >= ${MIN_SIDE}`;
const md5 = (p: string) => `nullif(trim(both '"' from ${p}.etag), '')`;

/**
 * SQL: photo `m` (embedding `em`) is linked to photo `k` (embedding `ek`)
 * by the pair rule's copy or burst part.
 */
function linked(m: string, k: string, em: string, ek: string) {
  const cosine = `(1 - (${em}.embedding <=> ${ek}.embedding))`;
  // Two MD5s that differ say two files; a multipart or unread ETag says nothing
  const sameBytes = `AND (${md5(m)} !~ '^[0-9a-f]{32}$' OR ${md5(k)} !~ '^[0-9a-f]{32}$'
            OR ${md5(m)} IS NULL OR ${md5(k)} IS NULL OR ${md5(m)} = ${md5(k)})`;
  const gap = `abs(${taken(m)} - ${taken(k)})`;
  return `(
    (${m}.size = ${k}.size AND ${width(m)} = ${width(k)} AND ${height(m)} = ${height(k)}
     AND ${cosine} >= ${COPY_COSINE} ${sameBytes})
    OR (${camera(m)} = ${camera(k)} AND ${plain(m)} AND ${plain(k)}
        AND ((${gap} < 1 AND ${cosine} >= ${SAME_SECOND_COSINE})
             OR (${gap} >= 1 AND ${gap} <= ${BURST_SECONDS} AND ${cosine} >= ${BURST_COSINE})))
  )`;
}

/** A photo that « Garder » throws away, and the photo kept in its place. */
export interface Going {
  id: number;
  keep: number;
}

/**
 * The photos of the stacks of `keep` that keeping them throws away: in
 * the gallery, not kept themselves, linked to the photo kept of their
 * stack. By id.
 */
export async function goingFor(
  run: Runner,
  keep: readonly number[],
): Promise<Going[]> {
  if (keep.length === 0) return [];
  const result = await run(
    `SELECT DISTINCT ON (m.photo_id) m.photo_id::int AS id, kept.photo_id::int AS keep
     FROM photo_groups kept
     JOIN photo_groups m ON m.group_id = kept.group_id AND m.photo_id <> kept.photo_id
     JOIN photos p ON p.id = m.photo_id
     JOIN photos k ON k.id = kept.photo_id
     JOIN photo_embeddings ep ON ep.photo_id = p.id
     JOIN photo_embeddings ek ON ek.photo_id = k.id AND ek.model = ep.model
     WHERE kept.photo_id = ANY($1::bigint[])
       AND NOT (m.photo_id = ANY($1::bigint[]))
       AND ${inGallery("p")}
       AND ${linked("p", "k", "ep", "ek")}
     ORDER BY m.photo_id, kept.photo_id`,
    [keep],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    keep: Number(row.keep),
  }));
}

/** goingFor on a transaction's client. */
export const clientRunner =
  (client: PoolClient): Runner =>
  (text, params) =>
    client.query(text, params);

/** goingFor on the pool. */
export const poolRunner: Runner = (text, params) => query(text, params);

/**
 * « Garder » before the owner confirms: per photo of `keep`, the photos
 * keeping it would throw away (an empty list: none is close enough).
 */
export async function previewKeep(
  keep: readonly number[],
): Promise<Record<number, number[]>> {
  const going = await goingFor(poolRunner, keep);
  const out: Record<number, number[]> = Object.fromEntries(
    keep.map((id) => [id, [] as number[]]),
  );
  for (const g of going) out[g.keep]?.push(g.id);
  return out;
}
