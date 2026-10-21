/**
 * The Corbeille (photos.trashed_at, db/schema.sql). Throwing a photo away
 * only marks it: its file stays in the bucket and every view leaves it out
 * (inGallery). It comes back by clearing the mark. The purge erases what
 * has waited TRASH_DAYS, or everything when the owner empties the
 * Corbeille: every version of its file, its thumbnail and renditions, then
 * its row. Restoring and purging the same photo at once cannot both win:
 * the purge holds the rows of its batch locked while it deletes their files.
 */
import type { PoolClient } from "pg";
import type { Photo } from "@/types";
import { inGallery, query, requireRow, runTransaction } from "./database";
import { logger } from "./logger";
import { thumbnailUrl } from "./photoUrls";

/** How long a photo waits in the Corbeille before the weekly purge erases it. */
export const TRASH_DAYS = 30;

/** Most photos one request may throw away or put back: a page of Doublons, a stack. */
export const TRASH_BATCH = 2_000;

/** The photos the Corbeille now holds: ids of those just thrown away (not already in it). */
export async function trashPhotos(ids: readonly number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const result = await query<{ id: number }>(
    `UPDATE photos SET trashed_at = now()
     WHERE id = ANY($1::bigint[]) AND trashed_at IS NULL
     RETURNING id::int AS id`,
    [ids],
  );
  return result.rows.map((row) => row.id);
}

/** Puts photos back, all of them with "all"; returns how many came back. */
export async function restorePhotos(
  ids: readonly number[] | "all",
): Promise<number> {
  const result =
    ids === "all"
      ? await query(
          "UPDATE photos SET trashed_at = NULL WHERE trashed_at IS NOT NULL",
        )
      : await query(
          `UPDATE photos SET trashed_at = NULL
           WHERE id = ANY($1::bigint[]) AND trashed_at IS NOT NULL`,
          [ids],
        );
  return result.rowCount ?? 0;
}

/** The other photos of `keep`'s stack the gallery shows: what keeping it throws away. */
const OTHERS_IN_STACK = `
  SELECT m.photo_id FROM photo_groups k
  JOIN photo_groups m ON m.group_id = k.group_id AND m.photo_id <> k.photo_id
  JOIN photos p ON p.id = m.photo_id
  WHERE k.photo_id = ANY($1::bigint[]) AND ${inGallery()}`;

/**
 * « Garder celle-ci »: each photo of `keep` stays, the rest of its stack
 * goes to the Corbeille. `expected`: how many the owner was told would go;
 * when the stacks now hold another number (a sync, a rebuild, another tab
 * since), nothing moves and the actual number is returned with ok false.
 * A kept photo in the Corbeille comes back. Returns the ids thrown away.
 */
export async function keepFromStacks(
  keep: readonly number[],
  expected: number,
): Promise<{ ok: boolean; trashed: number[]; count: number }> {
  return runTransaction(async (client) => {
    const others = await client.query<{ id: number }>(
      `SELECT DISTINCT photo_id::int AS id FROM (${OTHERS_IN_STACK}) o
       WHERE NOT (photo_id = ANY($1::bigint[]))
       ORDER BY 1`,
      [keep],
    );
    const ids = others.rows.map((row) => row.id);
    if (ids.length !== expected)
      return { ok: false, trashed: [], count: ids.length };
    await client.query(
      `UPDATE photos SET trashed_at = NULL WHERE id = ANY($1::bigint[]) AND trashed_at IS NOT NULL`,
      [keep],
    );
    const trashed = await client.query<{ id: number }>(
      `UPDATE photos SET trashed_at = now()
       WHERE id = ANY($1::bigint[]) AND trashed_at IS NULL
       RETURNING id::int AS id`,
      [ids],
    );
    return {
      ok: true,
      trashed: trashed.rows.map((row) => row.id),
      count: ids.length,
    };
  });
}

export type TrashedPhoto = Photo & {
  folder_path: string;
  trashed_at: string;
};

/** The Corbeille, last thrown away first, keyset-paginated on (trashed_at, id). */
export async function listTrash(
  after: { trashedAt: string; id: number } | null,
  limit: number,
): Promise<{
  photos: TrashedPhoto[];
  total: number;
  next: { trashedAt: string; id: number } | null;
}> {
  const params: unknown[] = [limit + 1];
  const seek = after
    ? (params.push(after.trashedAt, after.id),
      "AND (p.trashed_at, p.id) < ($2::timestamptz, $3::bigint)")
    : "";
  const [page, count] = await Promise.all([
    query<Photo & { folder_path: string; trashed_at: Date }>(
      `SELECT p.*, f.path AS folder_path FROM photos p
       JOIN folders f ON f.id = p.folder_id
       WHERE p.trashed_at IS NOT NULL ${seek}
       ORDER BY p.trashed_at DESC, p.id DESC
       LIMIT $1`,
      params,
    ),
    query<{ total: number }>(
      "SELECT count(*)::int AS total FROM photos WHERE trashed_at IS NOT NULL",
    ),
  ]);
  const photos = page.rows.slice(0, limit).map((row) => ({
    ...row,
    id: Number(row.id),
    is_favorite: Boolean(row.is_favorite),
    thumbnail_url: thumbnailUrl(row.id),
    trashed_at: new Date(row.trashed_at).toISOString(),
  }));
  const last = photos[photos.length - 1];
  return {
    photos,
    total: requireRow(count).total,
    next:
      page.rows.length > limit && last
        ? { trashedAt: last.trashed_at, id: last.id }
        : null,
  };
}

// ---- the purge ------------------------------------------------------------

/** What the purge deletes outside the database; the tests give their own. */
export interface PurgeStore {
  /** Every version of the original; the version ids deleted. Throws when storage refuses. */
  deleteOriginal: (key: string) => Promise<string[]>;
  /** Thumbnail and renditions; never throws (a leftover there costs nothing). */
  deleteDerived: (photo: PurgedPhoto) => Promise<void>;
}

export interface PurgedPhoto {
  id: number;
  s3_key: string;
  mime_type: string;
  thumbnail_path: string | null;
}

/**
 * The bucket of originals and the thumbnail storage of this deployment.
 * Loaded when a purge runs: the storage clients read their settings once
 * built, which a list of the Corbeille has no use for.
 */
export function storagePurgeStore(): PurgeStore {
  return {
    deleteOriginal: async (key) => {
      const [{ deleteAllVersions }, { getConfig }] = await Promise.all([
        import("./s3"),
        import("./config"),
      ]);
      return deleteAllVersions(getConfig().backblaze_bucket, key);
    },
    deleteDerived: async (photo) => {
      const [{ renditionKeys }, { thumbnailService }] = await Promise.all([
        import("./displayRendition"),
        import("./thumbnails"),
      ]);
      const keys = [
        ...(photo.thumbnail_path ? [photo.thumbnail_path] : []),
        ...renditionKeys(photo),
      ];
      // deleteThumbnail logs and swallows its own errors
      for (const key of keys) await thumbnailService.deleteThumbnail(key);
    },
  };
}

export interface PurgeReport {
  /** Photos the cutoff selects, in all */
  selected: number;
  /** Erased, files and rows */
  purged: { id: number; s3_key: string; versions: number }[];
  /** Still waiting (the next batch, or after a refusal) */
  remaining: number;
  /** Storage refused a file: the purge stopped there, that photo stays in the Corbeille */
  refused: { id: number; s3_key: string; status: number | null } | null;
}

/** A purge that would erase more than it was told: nothing was touched. */
export class PurgeRefused extends Error {}

const CANDIDATES = `FROM photos WHERE trashed_at IS NOT NULL AND trashed_at <= $1::timestamptz`;

/**
 * Erases the photos thrown away up to `cutoff`, `batch` at a time, oldest
 * first, until none is left or `limit` photos are done. Refuses without
 * touching anything when more than `expected` are selected (the number
 * the owner confirmed, or the cap of a scheduled run). `dryRun` only
 * counts and lists the keys it would erase. Every key erased is logged.
 */
export async function purgeTrash(
  store: PurgeStore,
  options: {
    cutoff: Date;
    expected: number;
    dryRun?: boolean;
    batch?: number;
    limit?: number;
  },
): Promise<PurgeReport> {
  const batch = options.batch ?? 25;
  const selected = requireRow(
    await query<{ n: number }>(`SELECT count(*)::int AS n ${CANDIDATES}`, [
      options.cutoff,
    ]),
  ).n;
  if (selected > options.expected)
    throw new PurgeRefused(
      `${selected} photos would be erased, ${options.expected} expected`,
    );
  if (options.dryRun) {
    const keys = await query<PurgedPhoto>(
      `SELECT id::int AS id, s3_key, mime_type, thumbnail_path ${CANDIDATES}
       ORDER BY trashed_at, id`,
      [options.cutoff],
    );
    for (const photo of keys.rows)
      logger.info(`[purge] dry run, would erase ${photo.s3_key}`, {
        photoId: photo.id,
      });
    return { selected, purged: [], remaining: selected, refused: null };
  }
  const purged: PurgeReport["purged"] = [];
  let refused: PurgeReport["refused"] = null;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  while (!refused && purged.length < limit) {
    const done = await runTransaction((client) =>
      purgeBatch(
        client,
        store,
        options.cutoff,
        Math.min(batch, limit - purged.length),
      ),
    );
    purged.push(...done.purged);
    refused = done.refused;
    if (done.purged.length === 0) break;
  }
  const remaining = requireRow(
    await query<{ n: number }>(`SELECT count(*)::int AS n ${CANDIDATES}`, [
      options.cutoff,
    ]),
  ).n;
  return { selected, purged, remaining, refused };
}

async function purgeBatch(
  client: PoolClient,
  store: PurgeStore,
  cutoff: Date,
  size: number,
): Promise<Pick<PurgeReport, "purged" | "refused">> {
  // Locked until the rows are gone: a restore meanwhile waits, then finds nothing
  const rows = await client.query<PurgedPhoto>(
    `SELECT id::int AS id, s3_key, mime_type, thumbnail_path ${CANDIDATES}
     ORDER BY trashed_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
    [cutoff, size],
  );
  const purged: PurgeReport["purged"] = [];
  let refused: PurgeReport["refused"] = null;
  for (const photo of rows.rows) {
    try {
      const versions = await store.deleteOriginal(photo.s3_key);
      logger.info(`[purge] erased ${photo.s3_key}`, {
        photoId: photo.id,
        versions: versions.length,
      });
      await store.deleteDerived(photo);
      purged.push({
        id: photo.id,
        s3_key: photo.s3_key,
        versions: versions.length,
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      refused = { id: photo.id, s3_key: photo.s3_key, status: status ?? null };
      logger.warn(`[purge] storage refused ${photo.s3_key}`, {
        photoId: photo.id,
        status,
      });
      break;
    }
  }
  const ids = purged.map((p) => p.id);
  if (ids.length > 0) {
    const before = requireRow(
      await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM photos",
      ),
    ).n;
    await client.query(
      "UPDATE share_access_logs SET photo_id = NULL WHERE photo_id = ANY($1::bigint[])",
      [ids],
    );
    const deleted = await client.query(
      "DELETE FROM photos WHERE id = ANY($1::bigint[]) AND trashed_at IS NOT NULL",
      [ids],
    );
    const after = requireRow(
      await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM photos",
      ),
    ).n;
    if (deleted.rowCount !== ids.length || before - after !== ids.length)
      throw new Error(
        `purge: ${ids.length} files erased but ${String(deleted.rowCount)} rows deleted (${before} -> ${after})`,
      );
  }
  return { purged, refused };
}
