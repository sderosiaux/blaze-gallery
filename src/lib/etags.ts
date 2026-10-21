/**
 * photos.etag for the photos the sync recorded before it kept ETags
 * (scripts/etags.ts): the bucket's listing against the database, then the
 * missing ETags written in one transaction that checks nothing else moved.
 * An ETag already stored is never changed: one that differs from the
 * listing is reported, and the sync's next full scan sees that file as
 * replaced.
 */
import type { ListingPage } from "./bucketDiff";
import { getPhotoFiles, query, runTransaction } from "./database";

export interface EtagPlan {
  /** Objects listed, and those with a photo */
  listed: number;
  matched: number;
  /** Photos whose ETag is stored already, the same as listed */
  alreadySet: number;
  /** Photos whose ETag would be written */
  toSet: { id: number; etag: string }[];
  /** A stored ETag that differs from the listing: left as it is */
  conflicts: { id: number; key: string; stored: string; listed: string }[];
  /** Photos whose size or date differ from the listing: the sync's to handle */
  stale: number;
  /** Listed keys without a photo (any file, not only media) */
  bucketOnly: number;
  /** Photos whose key was not listed */
  photoOnly: number;
  /** Of toSet, ETags of a multipart upload (no MD5) */
  multipart: number;
}

/** A listing page from `token` on (ListObjectsV2) */
export type Lister = (token: string | undefined) => Promise<ListingPage>;

const MD5 = /^[0-9a-f]{32}$/;

/** What `npm run etags` would write, under `prefix` (a folder and a slash) or everywhere. */
export async function planEtags(
  list: Lister,
  prefix?: string,
): Promise<EtagPlan> {
  const files = await getPhotoFiles(prefix);
  const byKey = new Map(files.map((file) => [file.s3_key, file]));
  const seen = new Set<string>();
  const plan: EtagPlan = {
    listed: 0,
    matched: 0,
    alreadySet: 0,
    toSet: [],
    conflicts: [],
    stale: 0,
    bucketOnly: 0,
    photoOnly: 0,
    multipart: 0,
  };
  let token: string | undefined;
  let page: ListingPage;
  do {
    page = await list(token);
    for (const object of page.objects) {
      if (seen.has(object.key)) continue;
      seen.add(object.key);
      plan.listed++;
      const photo = byKey.get(object.key);
      if (!photo) {
        plan.bucketOnly++;
        continue;
      }
      plan.matched++;
      if (
        photo.size !== object.size ||
        photo.modified_at.getTime() !== object.lastModified.getTime()
      ) {
        plan.stale++;
      } else if (photo.etag === null) {
        if (object.etag === "") continue;
        plan.toSet.push({ id: photo.id, etag: object.etag });
        if (!MD5.test(object.etag)) plan.multipart++;
      } else if (photo.etag === object.etag) {
        plan.alreadySet++;
      } else {
        plan.conflicts.push({
          id: photo.id,
          key: object.key,
          stored: photo.etag,
          listed: object.etag,
        });
      }
    }
    token = page.nextContinuationToken;
  } while (page.isTruncated && token !== undefined);
  if (page.isTruncated || token !== undefined)
    throw new Error(
      `The listing stopped after ${plan.listed} objects, before its last page: nothing to write`,
    );
  for (const file of files) if (!seen.has(file.s3_key)) plan.photoOnly++;
  return plan;
}

/** Photos, those with an ETag, and a hash of every other column of every photo. */
export async function etagCounters(
  run: (text: string) => Promise<{ rows: unknown[] }> = (text) => query(text),
): Promise<{ photos: number; with_etag: number; others: string }> {
  const result = await run(
    `SELECT count(*)::int AS photos, count(etag)::int AS with_etag,
            md5(string_agg(md5(concat_ws('|', id, folder_id, filename, s3_key, size,
              mime_type, created_at, modified_at, thumbnail_path, metadata::text,
              metadata_status, thumbnail_status, is_favorite, last_synced,
              trashed_at, trashed_by, trash_batch, trashed_for)), '' ORDER BY id)) AS others
     FROM photos`,
  );
  const row = result.rows[0] as
    | { photos: number; with_etag: number; others: string }
    | undefined;
  if (!row) throw new Error("no counters");
  return row;
}

/** The ETags written refused: nothing was. */
export class EtagsRefused extends Error {}

const CHUNK = 20_000;

/**
 * Writes `plan.toSet` where photos.etag is still NULL, in one transaction:
 * refused (rolled back) unless exactly those rows were written and no
 * other column of any photo changed. Returns the counters before and after.
 */
export function applyEtags(plan: EtagPlan) {
  return runTransaction(async (client) => {
    const run = (text: string) => client.query(text);
    const before = await etagCounters(run);
    let written = 0;
    for (let start = 0; start < plan.toSet.length; start += CHUNK) {
      const chunk = plan.toSet.slice(start, start + CHUNK);
      const result = await client.query(
        `UPDATE photos p SET etag = v.etag
         FROM unnest($1::bigint[], $2::text[]) AS v(id, etag)
         WHERE p.id = v.id AND p.etag IS NULL`,
        [chunk.map((c) => c.id), chunk.map((c) => c.etag)],
      );
      written += result.rowCount ?? 0;
    }
    const after = await etagCounters(run);
    if (
      written !== plan.toSet.length ||
      after.photos !== before.photos ||
      after.others !== before.others ||
      after.with_etag !== before.with_etag + written
    )
      throw new EtagsRefused(
        `${written} written of ${plan.toSet.length}; before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
      );
    return { before, after, written };
  });
}
