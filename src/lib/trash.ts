/**
 * The Corbeille (photos.trashed_at, db/schema.sql). Throwing a photo away
 * only marks it: its file stays in the bucket and every view leaves it out
 * (inGallery). It comes back by clearing the mark. The purge erases what
 * has waited TRASH_DAYS, or everything when the owner empties the
 * Corbeille: every version of its file, its thumbnail and renditions, then
 * its row. Restoring and purging the same photo at once cannot both win:
 * the purge holds the row of the photo it erases locked while its file goes.
 *
 * Every throw is a lot (photos.trash_batch): one request of the owner, or
 * one pass of `npm run dedupe` (lib/autoTrash.ts), which « Restaurer le
 * lot » puts back whole. A photo that left a stack names the one kept in
 * its place (trashed_for).
 */
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import type { FileVersion } from "./s3";
import type { Photo } from "@/types";
import { inGallery, query, requireRow, runTransaction } from "./database";
import { GROUPS_LOCK } from "./groupsLock";
import { clientRunner, goingFor } from "./keep";
import { logger } from "./logger";
import { carryNames } from "./people";
import { thumbnailUrl } from "./photoUrls";

/** Who threw photos away, and the lot they went with. */
export interface TrashLot {
  by: "owner" | "auto";
  batch: string;
}

/** A new lot: who, what, when (UTC, to the second), and 4 random hex digits. */
export function newLot(by: TrashLot["by"], what: string): TrashLot {
  const at = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return { by, batch: `${by}-${what}-${at}-${randomBytes(2).toString("hex")}` };
}

/**
 * Marks `photos` thrown away with `lot`, each with the photo kept in its
 * place (null: none). Those already in the Corbeille stay as they are.
 * The ids marked.
 */
export async function markTrashed(
  client: PoolClient,
  photos: readonly { id: number; keep: number | null }[],
  lot: TrashLot,
): Promise<number[]> {
  if (photos.length === 0) return [];
  const result = await client.query<{ id: number }>(
    `UPDATE photos p
     SET trashed_at = now(), trashed_by = $3, trash_batch = $4, trashed_for = t.keep
     FROM unnest($1::bigint[], $2::bigint[]) AS t(id, keep)
     WHERE p.id = t.id AND p.trashed_at IS NULL
     RETURNING p.id::int AS id`,
    [photos.map((p) => p.id), photos.map((p) => p.keep), lot.by, lot.batch],
  );
  return result.rows.map((row) => row.id);
}

/** Clears the Corbeille's marks of the rows `where` (over photos) selects. */
const RESTORE = (where: string) =>
  `UPDATE photos SET trashed_at = NULL, trashed_by = NULL, trash_batch = NULL, trashed_for = NULL
   WHERE trashed_at IS NOT NULL AND ${where}`;

/** How long a photo waits in the Corbeille before the weekly purge erases it. */
export const TRASH_DAYS = 30;

/** Most photos one request may throw away or put back: the Doublons pages shown, a stack. */
export const TRASH_BATCH = 5_000;

/** The photos the Corbeille now holds: ids of those just thrown away (not already in it). */
export async function trashPhotos(
  ids: readonly number[],
  lot: TrashLot = newLot("owner", "photos"),
): Promise<number[]> {
  return runTransaction((client) =>
    markTrashed(
      client,
      ids.map((id) => ({ id, keep: null })),
      lot,
    ),
  );
}

/** Puts photos back, all of them with "all"; returns how many came back. */
export async function restorePhotos(
  ids: readonly number[] | "all",
): Promise<number> {
  const result =
    ids === "all"
      ? await query(RESTORE("true"))
      : await query(RESTORE("id = ANY($1::bigint[])"), [ids]);
  return result.rowCount ?? 0;
}

/** Puts back every photo of the lot still in the Corbeille; how many came back. */
export async function restoreLot(batch: string): Promise<number> {
  const result = await query(RESTORE("trash_batch = $1"), [batch]);
  return result.rowCount ?? 0;
}

/**
 * « Garder celle-ci »: each photo of `keep` stays, and the photos of its
 * stack linked to it (lib/keep.ts goingFor) go to the Corbeille, the
 * names on their faces moved onto it first (carryNames). `trash`: the
 * photos the owner was shown going (previewKeep); when they are not
 * exactly those now (a sync, a rebuild, another tab since), nothing moves
 * and ok is false with the number that would go. The stacks' photos are
 * locked first, so two « Garder » on one stack take turns, the second
 * seeing what the first did; a stack left with no photo of the gallery
 * outside the Corbeille undoes it all (ok false). A kept photo in the
 * Corbeille comes back. All go as one lot of the owner's. Returns the
 * ids thrown away.
 */
export async function keepFromStacks(
  keep: readonly number[],
  trash: readonly number[],
): Promise<{
  ok: boolean;
  trashed: number[];
  count: number;
  /** A pass of npm run dedupe or a write of the worker holds the stacks: nothing moved */
  passRunning?: boolean;
}> {
  try {
    return await runTransaction(async (client) => {
      const locked = await client.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1) AS ok",
        [GROUPS_LOCK],
      );
      if (!locked.rows[0]?.ok)
        return { ok: false, trashed: [], count: 0, passRunning: true };
      await client.query(
        `SELECT p.id FROM photos p JOIN photo_groups m ON m.photo_id = p.id
         WHERE m.group_id IN (SELECT group_id FROM photo_groups WHERE photo_id = ANY($1::bigint[]))
         ORDER BY p.id FOR UPDATE OF p`,
        [keep],
      );
      const going = await goingFor(clientRunner(client), keep);
      const seen = new Set(trash);
      if (going.length !== seen.size || going.some((g) => !seen.has(g.id)))
        return { ok: false, trashed: [], count: going.length };
      await client.query(RESTORE("id = ANY($1::bigint[])"), [keep]);
      await carryNames(client, going);
      const trashed = await markTrashed(
        client,
        going,
        newLot("owner", "stacks"),
      );
      const emptied = await client.query(
        `SELECT 1 FROM photo_groups k
         WHERE k.photo_id = ANY($1::bigint[]) AND NOT EXISTS (
           SELECT 1 FROM photo_groups m JOIN photos p ON p.id = m.photo_id
           WHERE m.group_id = k.group_id AND ${inGallery()})
         LIMIT 1`,
        [keep],
      );
      if (emptied.rows.length > 0) throw new StackEmptied(going.length);
      return { ok: true, trashed, count: going.length };
    });
  } catch (error) {
    if (error instanceof StackEmptied)
      return { ok: false, trashed: [], count: error.count };
    throw error;
  }
}

/** keepFromStacks would leave a stack with nothing in the gallery: rolled back. */
class StackEmptied extends Error {
  constructor(readonly count: number) {
    super("a stack would be left with nothing in the gallery");
  }
}

export type TrashedPhoto = Photo & {
  folder_path: string;
  trashed_at: string;
};

/**
 * The Corbeille, last thrown away first, keyset-paginated on (trashed_at,
 * id). `as_of`: the database's time when `total` was counted, the cutoff
 * « Vider » sends so it erases nothing thrown away after the owner looked.
 */
export async function listTrash(
  after: { trashedAt: string; id: number } | null,
  limit: number,
): Promise<{
  photos: TrashedPhoto[];
  total: number;
  as_of: string;
  /** The files' size, in bytes: what emptying it all frees */
  bytes: number;
  /** Thrown away TRASH_DAYS before as_of or earlier (due_cutoff): what the purge would take */
  due: number;
  due_bytes: number;
  due_cutoff: string;
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
    query<{
      total: number;
      as_of: Date;
      bytes: number;
      due: number;
      due_bytes: number;
      due_cutoff: Date;
    }>(
      `SELECT count(p.id)::int AS total, statement_timestamp() AS as_of,
              coalesce(sum(p.size), 0)::float8 AS bytes,
              count(p.id) FILTER (WHERE p.trashed_at <= c.due_cutoff)::int AS due,
              coalesce(sum(p.size) FILTER (WHERE p.trashed_at <= c.due_cutoff), 0)::float8 AS due_bytes,
              c.due_cutoff
       FROM (SELECT statement_timestamp() - make_interval(days => $1) AS due_cutoff) c
       LEFT JOIN photos p ON p.trashed_at IS NOT NULL
       GROUP BY c.due_cutoff`,
      [TRASH_DAYS],
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
  const { total, as_of, bytes, due, due_bytes, due_cutoff } = requireRow(count);
  return {
    photos,
    total,
    as_of: new Date(as_of).toISOString(),
    bytes,
    due,
    due_bytes,
    due_cutoff: new Date(due_cutoff).toISOString(),
    next:
      page.rows.length > limit && last
        ? { trashedAt: last.trashed_at, id: last.id }
        : null,
  };
}

/** A lot of the Corbeille: one request of the owner's, or one pass of npm run dedupe. */
export interface TrashLotSummary extends TrashLot {
  /** Photos of it still in the Corbeille */
  photos: number;
  /** Stacks it left a photo kept in */
  stacks: number;
  trashed_at: string;
}

/**
 * The lots worth putting back whole, last first: every pass of npm run
 * dedupe, and the owner's requests of more than one photo (a stack kept
 * from, a page of Doublons).
 */
export async function listLots(): Promise<TrashLotSummary[]> {
  const result = await query<{
    batch: string;
    by: TrashLot["by"];
    photos: number;
    stacks: number;
    trashed_at: Date;
  }>(
    `SELECT trash_batch AS batch, trashed_by AS by, count(*)::int AS photos,
            count(DISTINCT trashed_for)::int AS stacks, max(trashed_at) AS trashed_at
     FROM photos
     WHERE trashed_at IS NOT NULL AND trash_batch IS NOT NULL
     GROUP BY trash_batch, trashed_by
     HAVING trashed_by = 'auto' OR count(*) > 1
     ORDER BY max(trashed_at) DESC, trash_batch`,
  );
  return result.rows.map((row) => ({
    ...row,
    trashed_at: new Date(row.trashed_at).toISOString(),
  }));
}

/** A stack as a lot left it: the photo kept (null when gone since), and those thrown away. */
export interface LotStack {
  kept: (Photo & { folder_path: string; trashed: boolean }) | null;
  trashed: TrashedPhoto[];
}

/**
 * The photos of lot `batch` still in the Corbeille, by the photo kept in
 * their place (ascending id, keyset-paginated on it), each beside it.
 * Photos thrown away alone (no photo kept) come as stacks of one.
 */
export async function listLotStacks(
  batch: string,
  after: number | null,
  limit: number,
): Promise<{ stacks: LotStack[]; next: number | null }> {
  const keys = await query<{ key: number }>(
    `SELECT DISTINCT coalesce(trashed_for, id)::int AS key FROM photos
     WHERE trash_batch = $1 AND trashed_at IS NOT NULL
       AND coalesce(trashed_for, id) > $2
     ORDER BY 1 LIMIT $3`,
    [batch, after ?? 0, limit + 1],
  );
  const page = keys.rows.slice(0, limit).map((row) => row.key);
  const [trashed, kept] = await Promise.all([
    query<Photo & { folder_path: string; trashed_at: Date; key: number }>(
      `SELECT p.*, f.path AS folder_path, coalesce(p.trashed_for, p.id)::int AS key
       FROM photos p JOIN folders f ON f.id = p.folder_id
       WHERE p.trash_batch = $1 AND p.trashed_at IS NOT NULL
         AND coalesce(p.trashed_for, p.id) = ANY($2::bigint[])
       ORDER BY p.id`,
      [batch, page],
    ),
    query<Photo & { folder_path: string; trashed: boolean }>(
      `SELECT p.*, f.path AS folder_path, p.trashed_at IS NOT NULL AS trashed
       FROM photos p JOIN folders f ON f.id = p.folder_id
       WHERE p.id = ANY($1::bigint[]) AND p.trash_batch IS DISTINCT FROM $2`,
      [page, batch],
    ),
  ]);
  const shown = <T extends Photo>(row: T): T => ({
    ...row,
    id: Number(row.id),
    is_favorite: Boolean(row.is_favorite),
    thumbnail_url: thumbnailUrl(row.id),
  });
  const keptById = new Map(
    kept.rows.map((row) => [Number(row.id), shown(row)]),
  );
  const stacks = page.map(
    (key): LotStack => ({
      kept: keptById.get(key) ?? null,
      trashed: trashed.rows
        .filter((row) => row.key === key)
        .map(({ key: _, ...row }) => ({
          ...shown(row),
          trashed_at: new Date(row.trashed_at).toISOString(),
        })),
    }),
  );
  const last = page[page.length - 1];
  return {
    stacks,
    next: keys.rows.length > limit && last !== undefined ? last : null,
  };
}

// ---- the purge ------------------------------------------------------------

/** What the purge deletes outside the database; the tests give their own. */
export interface PurgeStore {
  /** Every version and hide marker of the original. Throws when storage refuses. */
  versions: (key: string) => Promise<FileVersion[]>;
  /** Deletes those versions, in that order. Throws when storage refuses. */
  deleteVersions: (key: string, ids: readonly string[]) => Promise<void>;
  /** Whether the bucket serves the key (false: a 404). Throws on any other refusal. */
  exists: (key: string) => Promise<boolean>;
  /** Thumbnail and renditions; a failure is logged (a leftover there costs nothing). */
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
  const bucket = async () => {
    const [s3, { getConfig }] = await Promise.all([
      import("./s3"),
      import("./config"),
    ]);
    return { s3, name: getConfig().backblaze_bucket };
  };
  return {
    versions: async (key) => {
      const { s3, name } = await bucket();
      return s3.listFileVersions(name, key);
    },
    deleteVersions: async (key, ids) => {
      const { s3, name } = await bucket();
      await s3.deleteFileVersions(name, key, ids);
    },
    exists: async (key) => {
      const { s3, name } = await bucket();
      return s3.fileExists(name, key);
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

interface PurgeTarget {
  id: number;
  s3_key: string;
}

export interface PurgeReport {
  /** Photos the cutoff selects, in all */
  selected: number;
  /** Erased, files and rows */
  purged: (PurgeTarget & { versions: number })[];
  /** Still waiting (the next batch, those left, or after a stop) */
  remaining: number;
  /**
   * Left in the Corbeille by this run, the others going on: its file was
   * written again after it was thrown away (or a version has no date), or
   * the bucket has no version of it at all and does not serve it either
   */
  left: (PurgeTarget & { reason: "reuploaded" | "missing" })[];
  /** Storage refused a file: the purge stopped there, that photo stays in the Corbeille */
  refused: (PurgeTarget & { status: number | null }) | null;
  /**
   * The purge stopped there, that photo in the Corbeille as it was: the
   * listing came back empty while the bucket serves the file ("listing"),
   * versions were still listed once deleted ("remains"), or MISSING_IN_A_ROW
   * photos in a row had no file at all ("missing": the wrong bucket or key)
   */
  stopped: (PurgeTarget & { reason: "listing" | "remains" | "missing" }) | null;
}

/**
 * The cutoff « Vider » erases up to, by the database's clock: what has
 * waited TRASH_DAYS unless the owner asked for everything (`all`). `given`
 * (the one the confirmation showed) may come earlier, never later: null
 * when it does, or when `all` comes without one.
 */
export async function emptyCutoff(
  given: Date | null,
  all: boolean,
): Promise<Date | null> {
  const { latest } = requireRow(
    await query<{ latest: Date }>(
      `SELECT statement_timestamp() - make_interval(days => $1) AS latest`,
      [all ? 0 : TRASH_DAYS],
    ),
  );
  if (given === null) return all ? null : latest;
  return given.getTime() <= latest.getTime() ? given : null;
}

/** A purge that would erase more than it was told: nothing was touched. */
export class PurgeRefused extends Error {}

/** Photos without a file in a row after which the purge stops: no bucket has none of them all. */
export const MISSING_IN_A_ROW = 3;

const CANDIDATES = `FROM photos WHERE trashed_at IS NOT NULL AND trashed_at <= $1::timestamptz`;

/**
 * Erases the photos thrown away up to `cutoff`, one at a time, oldest
 * first, until none is left or `limit` photos are erased. Refuses without
 * touching anything when more than `expected` are selected (the number
 * the owner confirmed, or the cap of a scheduled run). `dryRun` only
 * counts and lists the keys it would erase. Every key erased, or left, is
 * logged.
 */
export async function purgeTrash(
  store: PurgeStore,
  options: {
    cutoff: Date;
    expected: number;
    /** Refuse unless exactly `expected` are due (« Vider »), not only more */
    exact?: boolean;
    dryRun?: boolean;
    limit?: number;
  },
): Promise<PurgeReport> {
  const selected = requireRow(
    await query<{ n: number }>(`SELECT count(*)::int AS n ${CANDIDATES}`, [
      options.cutoff,
    ]),
  ).n;
  if (
    selected > options.expected ||
    (options.exact === true && selected !== options.expected)
  )
    throw new PurgeRefused(
      `${selected} photos would be erased, ${options.expected} expected`,
    );
  const report: PurgeReport = {
    selected,
    purged: [],
    remaining: selected,
    left: [],
    refused: null,
    stopped: null,
  };
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
    return report;
  }
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  let missing = 0;
  while (report.purged.length < limit) {
    const one = await purgeOne(
      store,
      options.cutoff,
      report.left.map((photo) => photo.id),
    );
    if (one === null) break;
    if ("refused" in one) {
      report.refused = one.refused;
      break;
    }
    if ("stopped" in one) {
      report.stopped = one.stopped;
      break;
    }
    if ("left" in one) {
      report.left.push(one.left);
      missing = one.left.reason === "missing" ? missing + 1 : 0;
      if (missing >= MISSING_IN_A_ROW) {
        report.stopped = { ...one.left, reason: "missing" };
        logger.warn(
          `[purge] stopped: ${missing} photos in a row have no file in the bucket`,
        );
        break;
      }
      continue;
    }
    missing = 0;
    report.purged.push(one.purged);
  }
  report.remaining = requireRow(
    await query<{ n: number }>(`SELECT count(*)::int AS n ${CANDIDATES}`, [
      options.cutoff,
    ]),
  ).n;
  return report;
}

type PurgeOutcome =
  | { purged: PurgeReport["purged"][number] }
  | { left: PurgeReport["left"][number] }
  | { refused: NonNullable<PurgeReport["refused"]> }
  | { stopped: NonNullable<PurgeReport["stopped"]> };

/** Thrown inside the purge's transaction to roll it back with this outcome. */
class Undo extends Error {
  constructor(readonly outcome: PurgeOutcome) {
    super("purge rolled back");
  }
}

const refusal = (photo: PurgeTarget, error: unknown): PurgeOutcome => {
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  logger.warn(`[purge] storage refused ${photo.s3_key}`, {
    photoId: photo.id,
    status,
  });
  return {
    refused: { id: photo.id, s3_key: photo.s3_key, status: status ?? null },
  };
};

/**
 * Erases the oldest photo due but those of `skip`, in a transaction of its
 * own holding its row: the share logs let go of it, its row goes, then
 * every version of its file (the older first, the one the bucket serves
 * last), then the bucket is listed again; anything still there, or storage
 * refusing, rolls the row back, and a restore that waited finds it as it
 * was. A file written after the photo was thrown away (a new upload under
 * its key) is not erased, nor a photo whose file the bucket neither lists
 * nor serves: both are left. Thumbnail and renditions go once committed: a
 * leftover there costs nothing. Null when none is due (or every due one
 * is another purge's).
 */
async function purgeOne(
  store: PurgeStore,
  cutoff: Date,
  skip: readonly number[],
): Promise<PurgeOutcome | null> {
  let outcome: (PurgeOutcome & { photo?: PurgedPhoto }) | null;
  try {
    outcome = await runTransaction(async (client) => {
      const rows = await client.query<PurgedPhoto & { trashed_at: Date }>(
        `SELECT id::int AS id, s3_key, mime_type, thumbnail_path, trashed_at ${CANDIDATES}
           AND NOT (id = ANY($2::bigint[]))
         ORDER BY trashed_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [cutoff, skip],
      );
      const photo = rows.rows[0];
      if (!photo) return null;
      const target = { id: photo.id, s3_key: photo.s3_key };
      let versions: FileVersion[];
      try {
        versions = await store.versions(photo.s3_key);
      } catch (error) {
        return refusal(target, error);
      }
      if (versions.length === 0) {
        let served: boolean;
        try {
          served = await store.exists(photo.s3_key);
        } catch (error) {
          return refusal(target, error);
        }
        if (served) {
          logger.warn(
            `[purge] stopped: no version listed for ${photo.s3_key}, which the bucket serves`,
            { photoId: photo.id },
          );
          return { stopped: { ...target, reason: "listing" as const } };
        }
        logger.warn(`[purge] left ${photo.s3_key}: no file in the bucket`, {
          photoId: photo.id,
        });
        return { left: { ...target, reason: "missing" as const } };
      }
      const thrown = new Date(photo.trashed_at).getTime();
      if (
        versions.some(
          (v) =>
            !v.marker && (!v.lastModified || v.lastModified.getTime() > thrown),
        )
      ) {
        logger.warn(
          `[purge] left ${photo.s3_key}: written again after it was thrown away`,
          { photoId: photo.id },
        );
        return { left: { ...target, reason: "reuploaded" as const } };
      }
      await client.query(
        "UPDATE share_access_logs SET photo_id = NULL WHERE photo_id = $1",
        [photo.id],
      );
      const deleted = await client.query(
        "DELETE FROM photos WHERE id = $1 AND trashed_at IS NOT NULL",
        [photo.id],
      );
      if (deleted.rowCount !== 1)
        throw new Error(`purge: photo ${photo.id} has no row to delete`);
      // The older first: storage refusing midway leaves the file it serves
      const order = [
        ...versions.filter((v) => !v.latest),
        ...versions.filter((v) => v.latest),
      ].map((v) => v.id);
      let after: FileVersion[];
      try {
        await store.deleteVersions(photo.s3_key, order);
        after = await store.versions(photo.s3_key);
      } catch (error) {
        throw new Undo(refusal(target, error));
      }
      if (after.length > 0) {
        logger.warn(
          `[purge] stopped: ${after.length} versions of ${photo.s3_key} still listed once deleted`,
          { photoId: photo.id },
        );
        throw new Undo({ stopped: { ...target, reason: "remains" } });
      }
      logger.info(`[purge] erased ${photo.s3_key}`, {
        photoId: photo.id,
        versions: versions.length,
      });
      return { photo, purged: { ...target, versions: versions.length } };
    });
  } catch (error) {
    if (error instanceof Undo) return error.outcome;
    throw error;
  }
  if (outcome === null || !("purged" in outcome) || !outcome.photo)
    return outcome;
  const { photo, purged } = outcome;
  await store.deleteDerived(photo).catch((error: unknown) => {
    logger.warn(`[purge] thumbnail of ${photo.s3_key} left`, {
      photoId: photo.id,
      error: String(error),
    });
  });
  return { purged };
}
