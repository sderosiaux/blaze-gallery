import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { Pool, types } from "pg";
import type { Folder, Photo, PhotoMetadata, PhotoStack } from "@/types";
import * as crypto from "crypto";
import { compare, hash } from "bcryptjs";
import { logger } from "./logger";
import { thumbnailUrl } from "./photoUrls";
import {
  CELLS_PER_DEGREE,
  DAY_SPAN,
  isDay,
  type MapBox,
  type MapPeriod,
} from "./mapArea";
import { normalizeTextForSearch } from "./textUtils";
import {
  COLOR_TONES,
  hasColorFilter,
  HOLDS,
  HUES,
  hueIndex,
  NO_COLOR_FILTER,
  TONE_LIMITS,
  type ColorFilter,
  type ColorRankCursor,
  type ColorTone,
  type Hue,
} from "./colors";
import { foldPalette, type ColorBin, type Swatch } from "./palette";
import { asQuarterTurn, type QuarterTurn } from "./rotation";
import {
  EXPRESSIONS,
  type Expression,
  type FaceCondition,
  type TagCondition,
} from "./photoFilter";
import {
  hasDateFilter,
  periodFilter,
  SEMANTIC_MARGIN,
  SEMANTIC_MIN_SIMILARITY,
  SEMANTIC_REFERENCE_RANK,
  type DateFilter,
} from "./semanticQuery";
import type {
  CreatePhotoData,
  CreateFolderData,
  CreateSyncJobData,
  UpdatePhotoStatus,
  SyncJobType,
  SyncJobStatus,
  MetadataStatus,
  ThumbnailStatus,
} from "@/types/common";

// Columns typed `timestamp without time zone` hold UTC wall-clock values
// (CURRENT_TIMESTAMP in a UTC session). node-pg would read them in the host's
// zone, shifting every instant on any server not running in UTC.
types.setTypeParser(types.builtins.TIMESTAMP, (value: string | null) =>
  value === null ? null : new Date(value.replace(" ", "T") + "Z"),
);

export interface SyncJob {
  id: number;
  type: SyncJobType;
  status: SyncJobStatus;
  folder_path?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  processed_items: number;
  total_items: number;
  stats?: SyncJobStats | null;
}

/** What a full scan found, recorded before it changes anything */
export interface SyncJobStats {
  /** Objects in the bucket, media or not */
  listed: number;
  added: number;
  changed: number;
  removed: number;
  folders_created: number;
  /**
   * Photos whose file was replaced: their faces, colours and descriptions
   * still describe the old file, for a later pass to analyse again.
   */
  changed_photo_ids: number[];
  /** Photos deleted because their file left the bucket */
  removed_keys: string[];
  /** Folders whose photo or subfolder count was wrong, set once the changes are in */
  folders_recounted?: number;
}

// Database representation of photo (before processing)
interface DatabasePhoto {
  id: number;
  folder_id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  created_at: string;
  modified_at: string;
  thumbnail_path?: string;
  metadata: PhotoMetadata | null; // JSONB in PostgreSQL, already parsed by pg
  metadata_status: MetadataStatus;
  thumbnail_status: ThumbnailStatus;
  is_favorite: boolean; // PostgreSQL native boolean
  last_synced?: string;
  /** stackColumns: present when the query selected them */
  stack_id?: number | null;
  stack_count?: number | null;
}

/** The stack a row's stackColumns describe; none under two members. */
export function stackOf(row: {
  stack_id?: number | null;
  stack_count?: number | null;
}): PhotoStack | undefined {
  return row.stack_id != null && (row.stack_count ?? 0) >= 2
    ? { id: Number(row.stack_id), count: Number(row.stack_count) }
    : undefined;
}

/**
 * Normalize database photo row to Photo type with proper boolean and URL handling
 */
function normalizePhoto(dbPhoto: DatabasePhoto): Photo {
  const { stack_id, stack_count, ...photo } = dbPhoto;
  const stack = stackOf({ stack_id, stack_count });
  return {
    ...photo,
    is_favorite: Boolean(dbPhoto.is_favorite),
    thumbnail_url: thumbnailUrl(dbPhoto.id),
    metadata: dbPhoto.metadata,
    ...(stack ? { stack } : {}),
  } as Photo;
}

/**
 * Normalize database share row to SharedFolder type with proper boolean handling
 */
function normalizeShare<
  T extends { allow_download: unknown; is_active: unknown },
>(dbShare: T): T & { allow_download: boolean; is_active: boolean } {
  return {
    ...dbShare,
    allow_download: Boolean(dbShare.allow_download),
    is_active: Boolean(dbShare.is_active),
  };
}

class DatabaseManager {
  private static instance: DatabaseManager | undefined;
  private pool: Pool | null = null;

  private constructor() {
    // PostgreSQL connection will be initialized with environment variables or connection string
  }

  static getInstance(): DatabaseManager {
    DatabaseManager.instance ??= new DatabaseManager();
    return DatabaseManager.instance;
  }

  getPool(): Pool {
    return this.pool ?? this.initialize();
  }

  private initialize(): Pool {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is required for PostgreSQL connection",
      );
    }

    const pool = new Pool({
      connectionString,
      // Connection pool optimization for bulk operations
      max: 50, // Increased for bulk write operations (was 20)
      min: 5, // Minimum connections to keep alive
      idleTimeoutMillis: 60000, // Keep connections longer during bulk ops (was 30000)
      connectionTimeoutMillis: 10000, // Allow more time for connection establishment (was 2000)

      // Query performance optimization
      statement_timeout: 60000, // 60 seconds for large bulk operations
      query_timeout: 60000, // 60 seconds for complex queries

      // Application identification for monitoring
      application_name: "blaze-gallery-sync",

      // Connection keepalive for long-running operations
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,

      // SSL configuration (Neon requires SSL)
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false,
    });

    // Enhanced pool error handling and monitoring
    pool.on("error", (err) => {
      console.error("[Database Pool] Unexpected error on idle client:", err);
    });

    // Only log connection events, not every acquisition
    pool.on("connect", () => {
      logger.info(
        `[Database Pool] New client connected, total: ${pool.totalCount}`,
      );
    });

    pool.on("remove", () => {
      logger.info(`[Database Pool] Client removed, total: ${pool.totalCount}`);
    });

    // Log pool stats periodically during development
    if (process.env.NODE_ENV === "development") {
      setInterval(() => {
        const stats = {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        };
        // Only log if there's activity or issues
        if (stats.waiting > 0 || stats.total > 10) {
          logger.info(`[Database Pool Stats] ${JSON.stringify(stats)}`);
        }
      }, 30000); // Every 30 seconds
    }

    this.pool = pool;
    return pool;
  }

  // Transaction wrapper for bulk operations
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export function getPool(): Pool {
  return DatabaseManager.getInstance().getPool();
}

export async function runTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return DatabaseManager.getInstance().transaction(fn);
}

// Helper function for single queries
export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<R>> {
  const pool = getPool();
  return pool.query<R>(text, params);
}

/**
 * A query of a list of photos, JIT off. Their plans are cheap but
 * estimated dear once a filter is in them: each band of Couleurs repeats
 * the filter's lists of ids, and with jit on (as on the production
 * database) compiling the bands' query took 2.6 s and running it 0.1 s, on
 * a copy of the library, 2026-10-19.
 */
export async function listQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<R>> {
  return runTransaction(async (client) => {
    await client.query("SET LOCAL jit = off");
    return client.query<R>(text, params);
  });
}

/** First row of an aggregate query that always yields one */
/** First row of a query that always yields one (a bare aggregate); throws if the driver returned none. */
export function requireRow<R>(
  result: QueryResult<R & QueryResultRow>,
  what = "Query",
): R {
  const row = result.rows[0];
  if (row === undefined) throw new Error(`${what} returned no row`);
  return row;
}

/** Empty string means "not provided" for optional text columns */
function textOrNull(value: string | undefined): string | null {
  return value !== undefined && value !== "" ? value : null;
}

// ---- out of the gallery ---------------------------------------------------
// excluded_folders (db/schema.sql): folders the owner marked « pas une
// galerie photo », each with everything below it.

/**
 * True when `key` lies in a folder out of the gallery: a photo's s3_key, or
 * a folder's path followed by '/' (`f.path || '/'`). The one test every
 * query makes; db/schema.sql says why it is a per-row filter.
 */
export function outOfGallery(key: string): string {
  return `(${key} LIKE ANY (ARRAY(SELECT key_like FROM excluded_folders)))`;
}

/** Photos `p` not in the Corbeille (photos.trashed_at, db/schema.sql). */
export function notTrashed(p = "p"): string {
  return `${p}.trashed_at IS NULL`;
}

/**
 * The photos `p` of the gallery: in no folder out of it, not in the
 * Corbeille. A trashed photo counts as absent wherever an excluded one
 * does, and from the lists that show every file too (notTrashed).
 */
export function inGallery(p = "p"): string {
  return `NOT ${outOfGallery(`${p}.s3_key`)} AND ${notTrashed(p)}`;
}

/** `AND` clause keeping the photos `p` of the gallery (inGallery). */
export function andInGallery(p = "p"): string {
  return `AND ${inGallery(p)}`;
}

// ---- stacks ---------------------------------------------------------------
// photo_groups (db/schema.sql): near-duplicates stacked behind the one of
// rank 1. A list of photos shows one tile per stack: of the members it
// keeps (its own condition: a filter, a date, the map's box, a name), the
// one of lowest rank. A filter that keeps only some members of a stack so
// shows the best of those. The tile says how many photos the stack holds
// in the gallery, kept by the list or not: the stack is what opens in the
// viewer, whole.

/** The alias stackFront gives a member ranked before the photo. */
export const BETTER = "stack_better";

/**
 * Condition over photos `p`: no member of its stack ranked before it passes
 * `better`, the list's own condition written over photos BETTER. Without
 * the list's cursor or offset: the front is the stack's, whatever the page.
 * A probe per photo the list reaches, by its stack (photo_groups_pkey,
 * then the members before it): OFFSET 0 keeps the planner from turning it
 * into an anti-join over every stack, which a paged list never needs.
 */
export function stackFront(better: readonly string[], p = "p"): string {
  // Only a photo of the gallery, and not in the Corbeille, stands in
  // front: in the lists that show every file (a folder out of the
  // gallery), its photos all show
  const passes = [inGallery(BETTER), ...better]
    .map((condition) => `AND ${condition}`)
    .join("\n      ");
  return `NOT EXISTS (
    SELECT 1 FROM photo_groups stack_of
    JOIN photo_groups stack_ahead ON stack_ahead.group_id = stack_of.group_id
      AND stack_ahead.rank < stack_of.rank
    JOIN photos ${BETTER} ON ${BETTER}.id = stack_ahead.photo_id
    WHERE stack_of.photo_id = ${p}.id ${passes}
    OFFSET 0)`;
}

/**
 * For a list read whole (a count per month, the map's dots, the name
 * search): its rows (`select` FROM `from` WHERE `where`, the photo under
 * alias `p`), one per stack, settled in the same pass: a photo stays when
 * none of the list's rows in the gallery ranks before it in its stack. The
 * same photos as stackFront with `where` written over BETTER, without a
 * probe per photo nor a second pass over the stacks.
 */
export function oneOfEachStack(
  select: string,
  from: string,
  where: readonly string[],
  p = "p",
): string {
  // The rows narrowed to what the window sorts before it does (OFFSET 0
  // keeps the planner from computing the columns after the sort): with the
  // metadata and the path in them the months' sort spilled 70 MB to disk
  return `(SELECT * FROM (
      SELECT rows.*, min(rows.stack_rank) FILTER (WHERE rows.stack_gallery)
               OVER (PARTITION BY rows.stack_group) AS stack_best
      FROM (
        SELECT ${select}, stack_of.group_id AS stack_group, stack_of.rank AS stack_rank,
               ${inGallery(p)} AS stack_gallery
        FROM ${from}
        LEFT JOIN photo_groups stack_of ON stack_of.photo_id = ${p}.id
        WHERE ${where.length > 0 ? where.join("\n          AND ") : "true"}
        OFFSET 0
      ) rows
    ) ranked
    WHERE ranked.stack_rank IS NULL OR ranked.stack_best IS NULL
      OR ranked.stack_rank <= ranked.stack_best)`;
}

/**
 * stack_id and stack_count of photos `p`, for stackOf: its stack and how
 * many of the stack's photos are in the gallery.
 */
export function stackColumns(p = "p"): string {
  return `(SELECT sg.group_id FROM photo_groups sg WHERE sg.photo_id = ${p}.id)::int AS stack_id,
    (SELECT count(*) FROM photo_groups sg
     JOIN photo_groups sm ON sm.group_id = sg.group_id
     JOIN photos sp ON sp.id = sm.photo_id
     WHERE sg.photo_id = ${p}.id AND ${inGallery("sp")})::int AS stack_count`;
}

/** The photos of a photo's stack the gallery shows, best first; [] when it is in none. */
export async function getStackPhotos(
  photoId: number,
): Promise<TimelinePhoto[]> {
  const result = await query<DatabasePhoto & { folder_path: string }>(
    `SELECT p.*, f.path AS folder_path, ${stackColumns()}
     FROM photo_groups g
     JOIN photo_groups m ON m.group_id = g.group_id
     JOIN photos p ON p.id = m.photo_id
     JOIN folders f ON f.id = p.folder_id
     WHERE g.photo_id = $1 AND ${inGallery()}
     ORDER BY m.rank`,
    [photoId],
  );
  return result.rows.map((row) => ({
    ...normalizePhoto(row),
    folder_path: row.folder_path,
  }));
}

/** A folder marked « pas une galerie photo ». */
export interface ExcludedFolder {
  path: string;
  created_at: string;
  /** Photos and videos in it and below it, but those in the Corbeille: what it shows */
  photo_count: number;
}

/** The folders marked, by path. */
export async function listExcludedFolders(): Promise<ExcludedFolder[]> {
  const result = await query<ExcludedFolder>(`
    SELECT x.path, x.created_at,
      -- The folders' counts (the sync's) less the Corbeille's few: counting
      -- the photos under each took 2 s on the library, this 40 ms
      ((SELECT COALESCE(SUM(f.photo_count), 0) FROM folders f
        WHERE (f.path || '/') LIKE x.key_like)
       - (SELECT count(*) FROM photos p
          WHERE p.trashed_at IS NOT NULL AND p.s3_key LIKE x.key_like))::int AS photo_count
    FROM excluded_folders x
    ORDER BY x.path
  `);
  return result.rows;
}

/**
 * The marked folder that puts `path` out of the gallery: itself, else the
 * highest of its parents marked; null when it is in the gallery.
 */
export async function getFolderExclusion(
  path: string,
): Promise<{ path: string } | null> {
  const result = await query<{ path: string }>(
    `SELECT path FROM excluded_folders WHERE ($1::text || '/') LIKE key_like
     ORDER BY length(path) LIMIT 1`,
    [path],
  );
  return result.rows[0] ?? null;
}

/**
 * Marks a folder « pas une galerie photo »; marking it again changes
 * nothing. False when no folder has this path.
 */
export async function excludeFolder(path: string): Promise<boolean> {
  const result = await query<{ found: boolean }>(
    `WITH folder AS (SELECT path FROM folders WHERE path = $1),
     marked AS (
       INSERT INTO excluded_folders (path) SELECT path FROM folder
       ON CONFLICT (path) DO NOTHING
     )
     SELECT EXISTS (SELECT 1 FROM folder) AS found`,
    [path],
  );
  return requireRow(result).found;
}

/**
 * Puts a marked folder back in the gallery: what was found in its photos
 * shows again. False when it was not marked itself (a folder below a
 * marked one comes back with it only).
 */
export async function includeFolder(path: string): Promise<boolean> {
  const result = await query("DELETE FROM excluded_folders WHERE path = $1", [
    path,
  ]);
  return (result.rowCount ?? 0) > 0;
}

// A camera wrote it: rules out scans, screenshots, album art and sprites
const PHOTO_LIKE = `(p.mime_type IN ('image/jpeg', 'image/heic', 'image/heif')
  AND p.metadata->'camera'->>'make' IS NOT NULL
  AND (p.metadata->>'date_taken') IS NOT NULL)`;
const COVER_RANK = `${PHOTO_LIKE} DESC, (p.thumbnail_status = 'generated') DESC, p.filename, p.id`;

type FolderListingRow = Omit<
  Folder,
  | "thumbnails_generated"
  | "cover_photo_id"
  | "date_from"
  | "date_to"
  | "palette"
  | "excluded"
> & {
  shown_count: number;
  thumbnails_generated: boolean | null;
  cover_photo_id: number | null | undefined;
  date_from: string | null | undefined;
  date_to: string | null | undefined;
  palette: Swatch[] | null;
  excluded: boolean;
};

/**
 * Adds listing fields (thumbnail state, size, date span, cover, palette)
 * to the folders selected by `baseSql`, which must select `f.*` from
 * `folders f`. Its photo_count is what the folder shows: a stack once, as
 * getPhotosInFolder stacked lists it, not the files the sync counted.
 */
async function listFolders(
  baseSql: string,
  orderBy: string,
  params: unknown[],
): Promise<Folder[]> {
  // Cover: a photograph rather than a scan, album art or game sprite. An
  // image is photo-like when a camera wrote it (JPEG/HEIC with EXIF make and
  // date taken). Order: photo-like image of the folder itself, else the first
  // descendant folder (by path) holding one, else any image of the folder,
  // else of the first descendant holding images. Ties go to a generated
  // thumbnail (instant), then filename.
  // The path range lets the btree on folders.path serve the prefix lookup
  // (C.UTF-8 orders by code point, and '/' + 1 = '0'); starts_with keeps it
  // exact when names contain LIKE wildcards.
  // A folder out of the gallery keeps its cover but shows no colors; one in
  // the gallery takes no cover from a sub-folder out of it. A photo in the
  // Corbeille is no cover.
  const excluded = outOfGallery("s.path || '/'");
  const coverable = `(${excluded} OR NOT ${outOfGallery("d.path || '/'")})`;
  const sql = `
    WITH sub AS (${baseSql})
    SELECT
      s.*,
      agg.thumbnails_generated,
      agg.total_size,
      agg.shown_count,
      agg.folder_created_at,
      agg.date_from,
      agg.date_to,
      (CASE WHEN own_cover.is_photo THEN own_cover.id
            ELSE COALESCE(descendant_photo.id, own_cover.id, descendant_image.id)
       END)::int AS cover_photo_id,
      CASE WHEN ${excluded} THEN NULL ELSE fp.swatches END AS palette,
      ${excluded} AS excluded
    FROM sub s
    LEFT JOIN folder_palettes fp ON fp.folder_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN s.photo_count = 0 THEN false
          WHEN COUNT(*) FILTER (WHERE p.thumbnail_status = 'generated') = s.photo_count THEN true
          ELSE false
        END AS thumbnails_generated,
        COALESCE(SUM(p.size), 0) AS total_size,
        COUNT(*) FILTER (WHERE ${notTrashed()} AND ${stackFront([`${BETTER}.folder_id = s.id`])})::int AS shown_count,
        MIN(p.modified_at) AS folder_created_at,
        MIN(p.metadata->>'date_taken') AS date_from,
        MAX(p.metadata->>'date_taken') AS date_to
      FROM photos p
      WHERE p.folder_id = s.id
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT p.id, ${PHOTO_LIKE} AS is_photo
      FROM photos p
      WHERE p.folder_id = s.id AND p.mime_type LIKE 'image/%' AND ${notTrashed()}
      ORDER BY ${COVER_RANK}
      LIMIT 1
    ) own_cover ON true
    LEFT JOIN LATERAL (
      SELECT (
        SELECT p.id FROM photos p
        WHERE p.folder_id = d.id AND ${PHOTO_LIKE} AND ${notTrashed()}
        ORDER BY ${COVER_RANK}
        LIMIT 1
      ) AS id
      FROM folders d
      WHERE own_cover.is_photo IS NOT TRUE
        AND d.path >= s.path || '/'
        AND d.path < s.path || '0'
        AND starts_with(d.path, s.path || '/')
        AND d.photo_count > 0
        AND ${coverable}
        AND EXISTS (
          SELECT 1 FROM photos p WHERE p.folder_id = d.id AND ${PHOTO_LIKE}
            AND ${notTrashed()}
        )
      ORDER BY d.path
      LIMIT 1
    ) descendant_photo ON true
    LEFT JOIN LATERAL (
      SELECT (
        SELECT p.id FROM photos p
        WHERE p.folder_id = d.id AND p.mime_type LIKE 'image/%' AND ${notTrashed()}
        ORDER BY ${COVER_RANK}
        LIMIT 1
      ) AS id
      FROM folders d
      WHERE own_cover.id IS NULL
        AND descendant_photo.id IS NULL
        AND d.path >= s.path || '/'
        AND d.path < s.path || '0'
        AND starts_with(d.path, s.path || '/')
        AND d.photo_count > 0
        AND ${coverable}
        AND EXISTS (
          SELECT 1 FROM photos p
          WHERE p.folder_id = d.id AND p.mime_type LIKE 'image/%' AND ${notTrashed()}
        )
      ORDER BY d.path
      LIMIT 1
    ) descendant_image ON true
    ORDER BY ${orderBy}
  `;

  const result = await query<FolderListingRow>(sql, params);

  return result.rows.map(({ shown_count, ...folder }) => ({
    ...folder,
    photo_count: shown_count,
    thumbnails_generated: Boolean(folder.thumbnails_generated),
    cover_photo_id: folder.cover_photo_id ?? null,
    date_from: folder.date_from ?? null,
    date_to: folder.date_to ?? null,
    palette: folder.palette ?? undefined,
    excluded: folder.excluded ? true : undefined,
  }));
}

// A folder's palette: its own photos' palettes summed per bin of a 6x6x6
// RGB grid (share-weighted mean color per bin), or, when none of its own
// photos is measured yet, those of every photo below it by path prefix.
// Each folder keeps its 12 heaviest bins; foldPalette makes them <= 5 colors.
//
// The whole library at once: 3.3 s on the production database with every
// photo measured (simulated 2026-10-18: 210k photos, 1.05M palette colors,
// 4.7k folders with a palette), too slow for a listing, and the library
// home spans every photo. So `npm run palettes` (scripts/folder-palettes.ts)
// computes it offline into folder_palettes, which listings join.
const PALETTE_SQL = `
  WITH entries AS (
    SELECT p.folder_id, e.share::float8 AS share,
           ('x' || substr(e.hex, 2))::bit(24)::int AS rgb
    FROM photo_colors pc
    JOIN photos p ON p.id = pc.photo_id
    CROSS JOIN LATERAL unnest(pc.palette_hex, pc.palette_share) AS e(hex, share)
    -- A colour with no share weighs nothing, and a bin of only those would divide by zero
    WHERE e.hex ~ '^#[0-9a-fA-F]{6}$' AND e.share > 0
      ${andInGallery()}
  ),
  direct AS (
    SELECT folder_id,
           ((rgb >> 16) * 6 / 256) * 36
             + (((rgb >> 8) & 255) * 6 / 256) * 6
             + ((rgb & 255) * 6 / 256) AS bin,
           SUM(share) AS w,
           SUM((rgb >> 16) * share) AS r,
           SUM(((rgb >> 8) & 255) * share) AS g,
           SUM((rgb & 255) * share) AS b
    FROM entries
    GROUP BY 1, 2
  ),
  bins AS (
    SELECT folder_id, bin, w, r, g, b FROM direct
    UNION ALL
    SELECT f.id, d.bin, SUM(d.w), SUM(d.r), SUM(d.g), SUM(d.b)
    FROM folders f
    JOIN folders sub
      ON sub.path >= f.path || '/' AND sub.path < f.path || '0'
     AND starts_with(sub.path, f.path || '/')
    JOIN direct d ON d.folder_id = sub.id
    WHERE f.subfolder_count > 0
      AND NOT EXISTS (SELECT 1 FROM direct own WHERE own.folder_id = f.id)
    GROUP BY f.id, d.bin
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY folder_id ORDER BY w DESC) AS place
    FROM bins
  )
  SELECT folder_id::text AS folder_id, w, r / w AS r, g / w AS g, b / w AS b
  FROM ranked
  WHERE place <= 12
`;

/** Every folder's palette from photo_colors, by folder id; reads only. */
export async function computeFolderPalettes(): Promise<Map<string, Swatch[]>> {
  const result = await query<{
    folder_id: string;
    w: number;
    r: number;
    g: number;
    b: number;
  }>(PALETTE_SQL);
  const bins = new Map<string, ColorBin[]>();
  for (const { folder_id, w, r, g, b } of result.rows) {
    const list = bins.get(folder_id) ?? [];
    list.push({ weight: w, r, g, b });
    bins.set(folder_id, list);
  }
  const palettes = new Map<string, Swatch[]>();
  for (const [folderId, list] of bins) {
    const palette = foldPalette(list);
    if (palette.length > 0) palettes.set(folderId, palette);
  }
  return palettes;
}

/**
 * Makes folder_palettes hold exactly `palettes`, in one transaction: each
 * folder's row is inserted or updated, the rows of folders left out are
 * deleted. A folder deleted since the computation is skipped. Writes no
 * other table.
 */
export async function replaceFolderPalettes(
  palettes: ReadonlyMap<string, Swatch[]>,
): Promise<{ written: number; removed: number }> {
  const rows = [...palettes].map(([folderId, swatches]) => ({
    folder_id: Number(folderId),
    swatches,
  }));
  return runTransaction(async (client) => {
    const written = await client.query(
      `INSERT INTO folder_palettes (folder_id, swatches, computed_at)
       SELECT s.folder_id, s.swatches, now()
       FROM jsonb_to_recordset($1::jsonb) AS s(folder_id bigint, swatches jsonb)
       JOIN folders f ON f.id = s.folder_id
       ON CONFLICT (folder_id) DO UPDATE
         SET swatches = EXCLUDED.swatches, computed_at = EXCLUDED.computed_at`,
      [JSON.stringify(rows)],
    );
    const removed = await client.query(
      `DELETE FROM folder_palettes WHERE NOT (folder_id = ANY($1::bigint[]))`,
      [rows.map((row) => row.folder_id)],
    );
    return { written: written.rowCount ?? 0, removed: removed.rowCount ?? 0 };
  });
}

// Byte order put "Londres" far from "londres2018" and "Mariage" before
// "anniv isa"; names are left untouched, only the order follows French.
const folderNameOrder = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
});

export async function getFolders(parentPath?: string): Promise<Folder[]> {
  const isRoot = parentPath === undefined || parentPath === "";
  const folders = await (isRoot
    ? listFolders(
        "SELECT f.* FROM folders f WHERE f.parent_id IS NULL",
        "s.name",
        [],
      )
    : listFolders(
        "SELECT f.* FROM folders f WHERE f.parent_id = (SELECT id FROM folders WHERE path = $1)",
        "s.name",
        [parentPath],
      ));
  return [...folders].sort((a, b) => folderNameOrder.compare(a.name, b.name));
}

/**
 * Albums (folders holding media directly) by last visit, newest first.
 * Container folders with no direct media and the root are left out.
 */
export async function getRecentlyVisitedFolders(
  limit: number,
): Promise<Folder[]> {
  return listFolders(
    `SELECT f.* FROM folders f
     WHERE f.last_visited IS NOT NULL AND f.path <> '' AND f.photo_count > 0
     ORDER BY f.last_visited DESC
     LIMIT $1`,
    "s.last_visited DESC",
    [limit],
  );
}

// ---- colors ---------------------------------------------------------------
// What photo_colors measures and the thresholds calibrated on the library
// are in db/schema.sql; the names are in lib/colors.ts.

/**
 * Share a color needs to narrow a list kept in its own order (timeline,
 * map, search). At HOLDS, the families nearly every picture has a little of
 * keep most photos: on 4,740 dated photos (2026-10-18) blue 81% (a corner
 * of sky), brown 74% (skin, wood), black 91%, grey 94%, white 56%, while
 * green, the commonest other family, keeps 39%. Each of the five gets the
 * share at which it keeps about as many: blue 0.25 (42%), brown 0.10
 * (41%), black 0.15 (37%), grey 0.30 (39%), white 0.10 (30%). Lists ranked
 * by share (Couleurs, MCP) keep HOLDS: there a corner of sky only sinks.
 */
const NARROWS: Record<Hue, number> = {
  red: HOLDS,
  orange: HOLDS,
  yellow: HOLDS,
  green: HOLDS,
  teal: HOLDS,
  blue: 0.25,
  purple: HOLDS,
  pink: HOLDS,
  brown: 0.1,
  black: 0.15,
  grey: 0.3,
  white: 0.1,
};

/** Each tone over photo_colors pc, as tonesOf reads it (lib/colors.ts). */
const TONE_WHERE: Record<ColorTone, string> = {
  vives: `pc.colorfulness >= ${TONE_LIMITS.vives}`,
  douces: `pc.colorfulness < ${TONE_LIMITS.douces} AND NOT pc.monochrome`,
  lumineuse: `pc.luminance > ${TONE_LIMITS.lumineuse}`,
  sombre: `pc.luminance < ${TONE_LIMITS.sombre}`,
  neutres: `pc.colorfulness < ${TONE_LIMITS.neutres} AND NOT pc.monochrome`,
  nb: "pc.monochrome",
};

/**
 * EXISTS clause keeping the photos (id `photoId`) whose colors pass the
 * filter, values in `params`; null without a filter. A photo whose colors
 * are not measured yet passes no filter.
 */
function colorFilterSql(
  params: unknown[],
  filter: ColorFilter,
  photoId = "p.id",
): string | null {
  if (!hasColorFilter(filter)) return null;
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [`pc.photo_id = ${photoId}`];
  if (filter.color)
    where.push(
      `pc.hues[${add(hueIndex(filter.color))}::int] >= ${add(NARROWS[filter.color])}::real`,
    );
  if (filter.tone) where.push(TONE_WHERE[filter.tone]);
  return `EXISTS (SELECT 1 FROM photo_colors pc WHERE ${where.join(" AND ")})`;
}

// ---- photo filters --------------------------------------------------------
// One filter for every list of photos (lib/photoFilter.ts says what each
// part means; lib/filterResolver.ts builds it from a URL or MCP arguments)
// and one place, filterConditions, that writes it as SQL over photos p.

/** A tag condition, with the score its tag needs (db/tags.json threshold). */
export interface TagFilter extends TagCondition {
  threshold: number;
  /** The db/tags.json version the threshold is for: rows of another one do not count */
  version: number;
  /** Few photos show it (rareTags): the list starts from them */
  rare?: boolean;
}

/** What the photos show: the ids of the photos close enough to it (contentPhotos). */
export interface ContentFilter {
  ids: readonly number[];
}

/**
 * What a list of photos keeps: the gallery's photos showing all of
 * `people` and none of `withoutPeople`, each face of `faces`, each tag of `tags` (or not, negated),
 * nobody else with `only`, taken within each of `dates`, holding `colors`,
 * under `folder` (its sub-folders too), favorites with `favorites`, close
 * enough to `content`.
 */
export interface PhotoFilter {
  people: readonly number[];
  /** None of them on the photos */
  withoutPeople: readonly number[];
  faces: readonly FaceCondition[];
  tags: readonly TagFilter[];
  only: boolean;
  dates: readonly DateFilter[];
  colors: ColorFilter;
  folder: string | null;
  favorites: boolean;
  content: ContentFilter | null;
}

export const NO_PHOTO_FILTER: PhotoFilter = {
  people: [],
  withoutPeople: [],
  faces: [],
  tags: [],
  only: false,
  dates: [],
  colors: NO_COLOR_FILTER,
  folder: null,
  favorites: false,
  content: null,
};

/** Whether `filter` keeps fewer photos than the whole gallery could. */
export function hasPhotoFilter(filter: PhotoFilter): boolean {
  return (
    filter.people.length > 0 ||
    filter.withoutPeople.length > 0 ||
    filter.faces.length > 0 ||
    filter.tags.length > 0 ||
    filter.only ||
    filter.dates.some(hasDateFilter) ||
    hasColorFilter(filter.colors) ||
    filter.folder !== null ||
    filter.favorites ||
    filter.content !== null
  );
}

/** A face named as its person: seed, manual or auto ("rejected" says it is not). */
export const OWNED = "('seed', 'manual', 'auto')";

/**
 * A face good enough to read how it looks: cluster_eligible (det_score >=
 * 0.8, a side >= 112 px, sharp, at most 45° from the camera). On smaller,
 * blurred or turned faces the expression model guesses.
 */
const READABLE = (f: string) => `${f}.cluster_eligible`;

/**
 * Each expression over a face f, from the faces pass's measures
 * (db/schema.sql): expression_scores in the order anger, contempt,
 * disgust, fear, happiness, neutral, sadness, surprise (1-based), the eyes
 * (lid gap over eye width, ~0.3 open, < 0.15 closed; both measured) and the
 * mouth (inner lip gap over mouth width, ~0 closed), compared as real, as
 * stored (0.9 as a double is above the stored 0.9). Set for precision
 * rather than recall, as the owner asked (2026-10-19): 9 in 10 right or
 * not offered. A smile reads on any face of 60 px or more; the other looks
 * only on READABLE faces.
 * The owner's answers (2026-10-19, 15 readable faces each, 5 per band):
 *   rit: a strong smile, the mouth open from 0.25: 10 of 10 laughing
 *     (0.20 to 0.25: 4 of 5);
 *   triste: from 0.6 on faces named as someone, 6 of 6 sad (under 0.6,
 *     1 of 2); on the others, 1 of 4: anyone's sad face counts named ones
 *     only (NAMED_LOOKS).
 * Checked by eye, 12 faces at random: sourit 12 of 12; yeux_fermes 12 of
 * 12 with the head level, 6 of 12 without (the others look down).
 * Not offered: anger, surprise and fear (by eye at 0.9: 9, 6 and 4 of 12,
 * the rest grimaces, statues and dolls; from 0.95, 7, 1 and 2 faces in
 * the library).
 * Partial indexes (db/schema.sql idx_faces_look_*) repeat the rare looks'
 * predicates as anyoneLooks writes them: change both together.
 */
const EXPRESSION_SQL: Record<Expression, (f: string) => string> = {
  sourit: (f) =>
    `${f}.expression_scores[5] >= 0.9::real AND least(${f}.width_px, ${f}.height_px) >= 60`,
  rit: (f) =>
    `${f}.expression_scores[5] >= 0.8::real AND ${f}.mouth_open >= 0.25::real AND ${READABLE(f)}`,
  triste: (f) => `${f}.expression_scores[7] >= 0.6::real AND ${READABLE(f)}`,
  yeux_fermes: (f) =>
    `${f}.eye_left_open IS NOT NULL AND ${f}.eye_right_open IS NOT NULL
      AND greatest(${f}.eye_left_open, ${f}.eye_right_open) < 0.10::real
      AND ${f}.pitch >= -5::real AND ${READABLE(f)}`,
};

/**
 * Looks that, on anyone's face, count on faces named as someone only: at
 * their scores, faces in a crowd that only look sad are most of the rest.
 */
const NAMED_LOOKS: ReadonlySet<Expression> = new Set(["triste"]);

/**
 * Looks few faces have (2026-10-19, as anyone's look: 150 to 700 faces of
 * 146,000; smiling, 40,000). On anyone's face, the planner walks the
 * timeline's date index probing each photo's faces: 92,000 photos read to
 * find 200 sad ones (2.4 s on the library). Given the ids of the photos
 * showing the look, as excluded_folders' patterns are given
 * (outOfGallery), it reads those photos and sorts them, the ids from the
 * look's partial index (db/schema.sql idx_faces_look_*): 7 ms for the sad
 * ones, 82 ms for the laughing ones, on a copy of the library.
 */
const RARE_LOOKS: ReadonlySet<Expression> = new Set([
  "rit",
  "triste",
  "yeux_fermes",
]);

/** A face looking `expression` as anyone's look counts it (NAMED_LOOKS). */
function anyoneLooks(f: string, expression: Expression): string {
  const named = NAMED_LOOKS.has(expression)
    ? ` AND ${f}.person_id IS NOT NULL AND ${f}.assignment IN ${OWNED}`
    : "";
  return `${EXPRESSION_SQL[expression](f)}${named}`;
}

/**
 * Conditions over photos p keeping the photos passing `filter`, values in
 * `params`; always the gallery's photos (outOfGallery). Each is an EXISTS
 * the planner can drive from its own index when it is the narrowest: a
 * person's faces (idx_faces_person_once_per_photo), a tag
 * (photo_tags_tag_score), a color (idx_photo_colors_*); otherwise it probes
 * each photo of the list's own order by photo id. Rare looks and rare
 * tags come as the ids of their photos (RARE_LOOKS, rareTags).
 */
function filterConditions(
  params: unknown[],
  filter: PhotoFilter,
  p = "p",
  id = `${p}.id`,
): string[] {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const conditions = [inGallery(p)];

  for (const personId of filter.people)
    conditions.push(`EXISTS (SELECT 1 FROM faces pf WHERE pf.photo_id = ${id}
      AND pf.person_id = ${add(personId)}::bigint AND pf.assignment IN ${OWNED})`);

  if (filter.withoutPeople.length > 0)
    conditions.push(`NOT EXISTS (SELECT 1 FROM faces xf WHERE xf.photo_id = ${id}
      AND xf.person_id = ANY(${add(filter.withoutPeople)}::bigint[])
      AND xf.assignment IN ${OWNED})`);

  const anyone = filter.faces.flatMap((face) =>
    face.person === null ? [face.expression] : [],
  );
  for (const face of filter.faces) {
    if (face.person === null) {
      const looks = anyoneLooks("ef", face.expression);
      conditions.push(
        RARE_LOOKS.has(face.expression)
          ? `${id} = ANY (ARRAY(SELECT ef.photo_id FROM faces ef WHERE ${looks}))`
          : `EXISTS (SELECT 1 FROM faces ef WHERE ef.photo_id = ${id} AND ${looks})`,
      );
    } else
      conditions.push(`EXISTS (SELECT 1 FROM faces ef WHERE ef.photo_id = ${id}
        AND ef.person_id = ${add(face.person)}::bigint AND ef.assignment IN ${OWNED}
        AND ${EXPRESSION_SQL[face.expression]("ef")})`);
  }

  if (filter.only) {
    // Nobody but the filter's people: a face of anyone else, or of no one
    // named, rules the photo out; with looks on anyone's face (« que des
    // enfants qui sourient »), every other face must look so. The faces
    // pass must have looked at the photo: one it has not read yet has no
    // face rows either.
    const ours = [
      ...filter.people,
      ...filter.faces.flatMap((face) =>
        face.person === null ? [] : [face.person],
      ),
    ];
    const others = [
      ours.length === 0
        ? null
        : `NOT coalesce(nf.assignment IN ${OWNED} AND nf.person_id = ANY(${add(ours)}::bigint[]), false)`,
      ...anyone.map(
        (expression) =>
          `NOT coalesce((${anyoneLooks("nf", expression)}), false)`,
      ),
    ].filter((clause) => clause !== null);
    const other = others.length === 0 ? "true" : others.join(" AND ");
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM faces nf WHERE nf.photo_id = ${id} AND ${other})`,
      `EXISTS (SELECT 1 FROM analysis_jobs fj WHERE fj.photo_id = ${id}
        AND fj.task = 'faces' AND fj.status = 'done')`,
    );
  }

  for (const tag of filter.tags) {
    const name = add(tag.tag);
    const threshold = add(tag.threshold);
    const version = add(tag.version);
    const shows = (t: string) => `${t}.tag = ${name}::text
      AND ${t}.score >= ${threshold}::real AND ${t}.vocab_version = ${version}::int`;
    conditions.push(
      tag.negated
        ? // Rows under 0.05 are not stored (db/schema.sql): a tagged photo
          // (its interieur row) without a row at the threshold is without it
          `EXISTS (SELECT 1 FROM photo_tags mt WHERE mt.photo_id = ${id}
            AND mt.tag = 'interieur' AND mt.vocab_version = ${version}::int)
          AND NOT EXISTS (SELECT 1 FROM photo_tags nt WHERE nt.photo_id = ${id} AND ${shows("nt")})`
        : tag.rare
          ? // As RARE_LOOKS: the ids of the photos showing it, from photo_tags_tag_score
            `${id} = ANY (ARRAY(SELECT pt.photo_id FROM photo_tags pt WHERE ${shows("pt")}))`
          : `EXISTS (SELECT 1 FROM photo_tags pt WHERE pt.photo_id = ${id} AND ${shows("pt")})`,
    );
  }

  for (const dates of filter.dates) {
    const clause = dateClause(params, dates, p);
    if (clause) conditions.push(clause);
  }

  const colors = colorFilterSql(params, filter.colors, id);
  if (colors) conditions.push(colors);

  if (filter.folder !== null) {
    const path = add(filter.folder);
    conditions.push(`${p}.folder_id IN (SELECT fo.id FROM folders fo
      WHERE fo.path = ${path}::text OR starts_with(fo.path, ${path}::text || '/'))`);
  }

  if (filter.favorites) conditions.push(`${p}.is_favorite`);

  if (filter.content) {
    conditions.push(`${id} = ANY (${add(filter.content.ids)}::bigint[])`);
  }
  return conditions;
}

/**
 * The looks a person has on some photo of the gallery, in EXPRESSIONS
 * order: what their page offers to filter by. One scan of their faces.
 */
export async function personExpressions(
  personId: number,
): Promise<Expression[]> {
  const result = await query<Record<Expression, boolean>>(
    `SELECT ${EXPRESSIONS.map(
      (expression) =>
        `bool_or(${EXPRESSION_SQL[expression]("f")}) AS ${expression}`,
    ).join(", ")}
     FROM faces f JOIN photos p ON p.id = f.photo_id
     WHERE f.person_id = $1 AND f.assignment IN ${OWNED}
       AND ${inGallery()}`,
    [personId],
  );
  const row = requireRow(result, "Person expressions");
  return EXPRESSIONS.filter((expression) => row[expression]);
}

/** filterConditions as `AND` lines for a WHERE clause over photos `p`. */
export function andPhotoFilter(
  params: unknown[],
  filter: PhotoFilter,
  p?: string,
  id?: string,
): string {
  return filterConditions(params, filter, p, id)
    .map((condition) => `AND ${condition}`)
    .join("\n");
}

/** filterConditions over photos BETTER, for stackFront. */
export function betterPassFilter(
  params: unknown[],
  filter: PhotoFilter,
): string[] {
  return filterConditions(params, filter, BETTER);
}

/**
 * The photos (photos `p`) taken within `dates`, compared as text with the
 * ISO date_taken like the timeline and the map; the days of the year are
 * its "MM-DD". Null for any date.
 */
function dateClause(
  params: unknown[],
  dates: DateFilter,
  p = "p",
): string | null {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}::text`;
  };
  const taken = `(${p}.metadata->>'date_taken')`;
  const day = `substr(${taken}, 6, 5)`;
  const clauses: string[] = [];
  if (dates.ranges.length > 0)
    clauses.push(
      dates.ranges
        .map((range) => {
          const sides = [
            range.from === null ? null : `${taken} >= ${add(range.from)}`,
            range.before === null ? null : `${taken} < ${add(range.before)}`,
          ].filter((side) => side !== null);
          return sides.length > 0
            ? `(${sides.join(" AND ")})`
            : `${taken} IS NOT NULL`;
        })
        .join(" OR "),
    );
  if (dates.annual.length > 0)
    clauses.push(
      dates.annual
        .map((window) =>
          window.from <= window.to
            ? `${day} BETWEEN ${add(window.from)} AND ${add(window.to)}`
            : `(${day} >= ${add(window.from)} OR ${day} <= ${add(window.to)})`,
        )
        .join(" OR "),
    );
  return clauses.length > 0
    ? clauses.map((clause) => `(${clause})`).join(" AND ")
    : null;
}

export type ColorRankedPhoto = TimelinePhoto & {
  /** hues[color] with a color, else colorfulness (chroma for nb), see TONE_RANK */
  color_score: number;
};

interface ColorRank {
  /** Expression over photo_colors pc the list is ordered by */
  score: string;
  order: "ASC" | "DESC";
  where: string[];
}

/**
 * Within a tone, the most colorful photos first. Ranked on the measure that
 * defines them, the darkest Sombre are black frames, the brightest
 * Lumineuse blown-out white and the most Neutres flat grey walls; ranked by
 * colorfulness, night lights, bright beaches and fog with a hint of color
 * come first and those sink to the end. Noir et blanc has no color to rank
 * by: the least chroma, the plainest black and white, first.
 */
const TONE_RANK: Record<ColorTone, Pick<ColorRank, "score" | "order">> = {
  vives: { score: "pc.colorfulness", order: "DESC" },
  douces: { score: "pc.colorfulness", order: "DESC" },
  lumineuse: { score: "pc.colorfulness", order: "DESC" },
  sombre: { score: "pc.colorfulness", order: "DESC" },
  neutres: { score: "pc.colorfulness", order: "DESC" },
  nb: { score: "pc.chroma", order: "ASC" },
};

/**
 * Order and condition of a ranked list: by share of the color when there is
 * one (the tone then only filters), else by the tone's measure. The hue
 * position and HOLDS are written into the SQL, not bound: the partial
 * index of each hue (db/schema.sql) only serves a query naming the same
 * expression and predicate. Both come from this file, never from a request.
 */
function colorRank(filter: ColorFilter): ColorRank | null {
  const tone = filter.tone ? [TONE_WHERE[filter.tone]] : [];
  if (filter.color) {
    const share = `pc.hues[${hueIndex(filter.color)}]`;
    return {
      score: share,
      order: "DESC",
      where: [`${share} >= ${HOLDS}::real`, ...tone],
    };
  }
  if (filter.tone) return { ...TONE_RANK[filter.tone], where: tone };
  return null;
}

/** Dated photos, the timeline's: leaves out sprites, album art and scans, which carry no date taken. */
const dated = (p: string) => `(${p}.metadata->>'date_taken') IS NOT NULL`;
const DATED = dated("p");

/** The photos a list of the gallery shows: dated, and in the gallery. */
const DATED_IN_GALLERY = `${DATED} AND ${inGallery()}`;

/**
 * The rank's condition over photos `p` (its colors read under the alias pc
 * the rank's expressions name, inside the subquery).
 */
function colorRanked(rank: ColorRank, p: string): string {
  return `EXISTS (SELECT 1 FROM photo_colors pc WHERE pc.photo_id = ${p}.id
    AND ${rank.where.join(" AND ") || "true"})`;
}

/** The filter of a list ranked by color: its rank says the color (HOLDS, not NARROWS). */
function withoutColors(filter: PhotoFilter): PhotoFilter {
  return { ...filter, colors: NO_COLOR_FILTER };
}

/**
 * Dated photos of the gallery passing the color filter, most marked first
 * (see colorRank), keyset-paginated on (score, id); only those passing the
 * rest of `filter`. The page is picked on photo_colors through its index,
 * then read in full.
 */
export async function getPhotosByColor(
  filter: PhotoFilter,
  after: ColorRankCursor | null,
  limit: number,
): Promise<{ photos: ColorRankedPhoto[]; next: ColorRankCursor | null }> {
  const rank = colorRank(filter.colors);
  if (!rank) throw new Error("getPhotosByColor needs a color or a tone");
  const params: unknown[] = [limit + 1];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [...rank.where, DATED];
  if (after)
    where.push(
      `(${rank.score}, pc.photo_id) ${rank.order === "DESC" ? "<" : ">"} (${add(after.score)}::real, ${add(after.id)}::bigint)`,
    );
  const narrow = andPhotoFilter(params, withoutColors(filter));
  const front = stackFront([
    colorRanked(rank, BETTER),
    dated(BETTER),
    ...betterPassFilter(params, withoutColors(filter)),
  ]);
  const result = await listQuery<
    DatabasePhoto & { folder_path: string; color_score: number }
  >(
    `
    WITH page AS (
      SELECT pc.photo_id AS id, ${rank.score} AS score
      FROM photo_colors pc
      JOIN photos p ON p.id = pc.photo_id
      WHERE ${where.join("\n        AND ")}
        ${narrow}
        AND ${front}
      ORDER BY ${rank.score} ${rank.order}, pc.photo_id ${rank.order}
      LIMIT $1
    )
    SELECT p.*, f.path AS folder_path, page.score AS color_score, ${stackColumns()}
    FROM page
    JOIN photos p ON p.id = page.id
    JOIN folders f ON f.id = p.folder_id
    ORDER BY page.score ${rank.order}, page.id ${rank.order}
  `,
    params,
  );
  const photos = result.rows.slice(0, limit).map((row) => ({
    ...normalizePhoto(row),
    folder_path: row.folder_path,
    color_score: row.color_score,
  }));
  const last = photos[photos.length - 1];
  return {
    photos,
    next:
      result.rows.length > limit && last
        ? { score: last.color_score, id: Number(last.id) }
        : null,
  };
}

/** One band of the Couleurs page: a color or a tone and its most marked photos. */
export interface ColorBand {
  kind: "color" | "tone";
  key: Hue | ColorTone;
  /** Most marked first; `hex` is the photo's main palette color, `rotation` its hand rotation */
  photos: { id: number; hex: string | null; rotation: QuarterTurn }[];
}

export interface ColorOverview {
  bands: ColorBand[];
  /**
   * While the worker's "thumbs" task still has photos queued: dated photos
   * of the gallery whose colors are measured, of all of them. Null once it
   * is done.
   */
  coverage: { measured: number; photos: number } | null;
}

/** Candidates read per photo a band shows, so a burst does not fill it. */
const BAND_CANDIDATES = 4;

/** Shots of one folder this close in time are one moment: a band shows one. */
const BURST_MS = 10 * 60_000;

interface BandCandidate {
  folderId: string;
  /** Size and palette: a copy of a file under another name measures the same */
  look: string;
  /** date_taken in ms */
  taken: number;
}

/**
 * The best photos of a band, one per folder first: ten shots of one burst
 * would otherwise fill it with one picture. Short of folders, the next best
 * come in, in rank order, except copies (same `look`) and shots taken
 * within BURST_MS of one already shown from the same folder. A band may
 * stay shorter than `size`.
 */
function spreadAcrossFolders<T extends BandCandidate>(
  ranked: T[],
  size: number,
): T[] {
  const looks = new Set<string>();
  const unique = ranked.filter((photo) => {
    if (looks.has(photo.look)) return false;
    looks.add(photo.look);
    return true;
  });
  const folders = new Set<string>();
  const first = unique.filter((photo) => {
    if (folders.has(photo.folderId)) return false;
    folders.add(photo.folderId);
    return true;
  });
  const picked = new Set(first.slice(0, size));
  for (const photo of unique) {
    if (picked.size >= size) break;
    const burst = [...picked].some(
      (shown) =>
        shown.folderId === photo.folderId &&
        Math.abs(shown.taken - photo.taken) < BURST_MS,
    );
    if (!burst) picked.add(photo);
  }
  return unique.filter((photo) => picked.has(photo));
}

/**
 * The Couleurs page: per color, then per tone, `perBand` of its most marked
 * dated photos passing `filter` (colorRank's order, spread across
 * folders), and how far the measuring has got. One indexed top-N per band
 * (db/schema.sql); the counts, two scans, only while the measuring goes on.
 */
export async function getColorOverview(
  perBand: number,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<ColorOverview> {
  const filters: [ColorBand["kind"], Hue | ColorTone, ColorFilter][] = [
    ...HUES.map((hue): [ColorBand["kind"], Hue, ColorFilter] => [
      "color",
      hue,
      { color: hue, tone: null },
    ]),
    ...COLOR_TONES.map((tone): [ColorBand["kind"], ColorTone, ColorFilter] => [
      "tone",
      tone,
      { color: null, tone },
    ]),
  ];
  const params: unknown[] = [perBand * BAND_CANDIDATES];
  // A filter of few photos given by their ids (a rare look or tag, a
  // content): its
  // photos once for all the bands. Inline, each of the 18 bands repeated
  // the filter's scans (a rare look: 1.5 s on the library); kept for a
  // filter of many photos, each band read them all (outdoors, 165,000
  // photos: 7.5 s), where inline it stops at the band's first 48.
  const narrowed = withoutColors(filter);
  const byIds =
    narrowed.faces.some(
      (face) => face.person === null && RARE_LOOKS.has(face.expression),
    ) ||
    narrowed.tags.some((tag) => tag.rare && !tag.negated) ||
    narrowed.content !== null;
  const kept = byIds
    ? `WITH kept AS MATERIALIZED (
         SELECT p.id FROM photos p WHERE ${DATED} ${andPhotoFilter(params, narrowed)})`
    : "";
  const keep = kept
    ? "pc.photo_id IN (SELECT id FROM kept)"
    : `${DATED_IN_GALLERY} ${andPhotoFilter(params, narrowed)}`;
  // Band numbers, not keys, go into the SQL; the rank expressions are this file's.
  const tops = filters.map(([, , colors], band) => {
    const rank = colorRank(colors);
    if (!rank) throw new Error("A band needs a color or a tone");
    // The band's candidates, picked in index order first (with a probe per
    // photo inside, the planner read every photo and sorted: 16 s for the
    // bands), then one per stack among them: its best ranked. Against the
    // whole stack, a candidate whose front missed the cut took the stack
    // out of the band.
    return `(SELECT band, id, folder_id, hex, rotation, look, taken FROM (
      SELECT candidate.*, row_number() OVER (
               PARTITION BY coalesce(stack_of.group_id, -candidate.id)
               ORDER BY stack_of.rank) AS stack_pick
      FROM (
        SELECT ${band} AS band, pc.photo_id AS id, p.folder_id,
               pc.palette_hex[1] AS hex, p.metadata->'user_rotation' AS rotation,
               p.size::text || pc.palette_hex::text || pc.palette_share::text AS look,
               p.metadata->>'date_taken' AS taken, ${rank.score} AS score
        FROM photo_colors pc
        JOIN photos p ON p.id = pc.photo_id
        WHERE ${[...rank.where, DATED, keep].join(" AND ")}
        ORDER BY ${rank.score} ${rank.order}, pc.photo_id ${rank.order}
        LIMIT $1) candidate
      LEFT JOIN photo_groups stack_of ON stack_of.photo_id = candidate.id) picked
      WHERE stack_pick = 1
      ORDER BY score ${rank.order}, id ${rank.order})`;
  });
  const [bands, coverage] = await Promise.all([
    listQuery<{
      band: number;
      id: number;
      folder_id: string;
      hex: string | null;
      rotation: unknown;
      look: string;
      taken: string;
    }>(
      `${kept}
       SELECT band, id::int AS id, folder_id::text AS folder_id, hex, rotation, look, taken
       FROM (${tops.join("\nUNION ALL\n")}) t`,
      params,
    ),
    getColorCoverage(),
  ]);
  // UNION ALL keeps each band's order: rows arrive band by band, best first.
  const ranked = filters.map(
    (): (BandCandidate & { photo: ColorBand["photos"][number] })[] => [],
  );
  for (const row of bands.rows)
    ranked[row.band]?.push({
      folderId: row.folder_id,
      look: row.look,
      taken: Date.parse(row.taken),
      photo: {
        id: row.id,
        hex: row.hex,
        rotation: asQuarterTurn(row.rotation),
      },
    });
  return {
    bands: filters.map(([kind, key], band) => ({
      kind,
      key,
      photos: spreadAcrossFolders(ranked[band] ?? [], perBand).map(
        ({ photo }) => photo,
      ),
    })),
    coverage,
  };
}

async function getColorCoverage(): Promise<ColorOverview["coverage"]> {
  const pending = await query<{ pending: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM analysis_jobs
      WHERE task = 'thumbs' AND status IN ('queued', 'leased')
    ) AS pending
  `);
  if (!requireRow(pending).pending) return null;
  const counts = await query<{ measured: number; photos: number }>(`
    SELECT
      (SELECT COUNT(*) FROM photo_colors pc JOIN photos p ON p.id = pc.photo_id
       WHERE ${DATED_IN_GALLERY})::int AS measured,
      (SELECT COUNT(*) FROM photos p
       WHERE p.mime_type LIKE 'image/%' AND ${DATED_IN_GALLERY})::int AS photos
  `);
  return requireRow(counts, "Color coverage");
}

export interface PhotoColors {
  /** Share of each family, in HUES order */
  hues: number[];
  palette: Swatch[];
  colorfulness: number;
  chroma: number;
  luminance: number;
  monochrome: boolean;
  center_sigma: number;
  model: string;
}

/** A photo's measured colors; null until the worker has measured it, or out of the gallery. */
export async function getPhotoColors(
  photoId: number,
): Promise<PhotoColors | null> {
  const result = await query<{
    hues: number[];
    palette_hex: string[];
    palette_share: number[];
    colorfulness: number;
    chroma: number;
    luminance: number;
    monochrome: boolean;
    center_sigma: number;
    model: string;
  }>(
    `SELECT hues, palette_hex, palette_share, colorfulness, chroma, luminance,
            monochrome, center_sigma, model
     FROM photo_colors pc JOIN photos p ON p.id = pc.photo_id
     WHERE pc.photo_id = $1 ${andInGallery()}`,
    [photoId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const { palette_hex, palette_share, ...rest } = row;
  return {
    ...rest,
    palette: palette_hex.map((hex, i) => ({
      hex,
      share: palette_share[i] ?? 0,
    })),
  };
}

// ---- search ---------------------------------------------------------------

/** The query as every search SQL below takes it: $1 is `like`, $2 (suggestions) is `regex`. */
interface SearchTerms {
  /** Normalized query with LIKE wildcards escaped, so "_" in "IMG_01" is literal */
  like: string;
  /** Normalized query with regex metacharacters escaped */
  regex: string;
}

function searchTerms(q: string): SearchTerms {
  const text = normalizeTextForSearch(q);
  return {
    like: text.replace(/[\\%_]/g, "\\$&"),
    regex: text.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&"),
  };
}

/**
 * `column` without its accents, the way normalizeTextForSearch strips them
 * from the query (NFD, combining marks dropped), so "soiree" finds "Soirée".
 * ASCII values, nearly all of them, skip the work; ILIKE handles case.
 */
function unaccented(column: string): string {
  return `(CASE WHEN octet_length(${column}) = char_length(${column}) THEN ${column}
    ELSE regexp_replace(normalize(${column}, NFD), '[\\u0300-\\u036f]', '', 'g') END)`;
}

function containsSql(column: string, likeParam: string): string {
  return `${unaccented(column)} ILIKE '%' || ${likeParam} || '%'`;
}

/** Folders worth opening: the empty ones lead nowhere. */
const HAS_CONTENT = "(f.photo_count > 0 OR f.subfolder_count > 0)";

/** 0 when the folder's own name matches, 1 when only a parent folder's does */
function nameRankSql(name: string): string {
  return `(CASE WHEN ${containsSql(name, "$1")} THEN 0 ELSE 1 END)`;
}

export interface FolderSearchCursor {
  name: string;
  path: string;
}

export interface PhotoSearchCursor {
  folderPath: string;
  filename: string;
  id: string;
}

export interface SearchPage<T, C> {
  items: T[];
  /** Where the next page starts; null on the last page */
  next: C | null;
}

/**
 * Non-empty folders whose path matches (their own name or a parent's), named
 * matches first, then by name; keyset-paginated on (rank, name, path). The
 * rank is a function of the name, so the cursor only carries name and path.
 */
export async function searchFolders(
  q: string,
  after: FolderSearchCursor | null,
  limit: number,
): Promise<SearchPage<Folder, FolderSearchCursor>> {
  const params: unknown[] = [searchTerms(q).like, limit + 1];
  let seek = "";
  if (after) {
    params.push(after.name, after.path);
    seek = `AND (${nameRankSql("f.name")}, f.name, f.path)
                > (${nameRankSql("$3::text")}, $3::text, $4::text)`;
  }
  const rows = await listFolders(
    `SELECT f.* FROM folders f
     WHERE ${containsSql("f.path", "$1")} AND ${HAS_CONTENT}
       ${seek}
     ORDER BY ${nameRankSql("f.name")}, f.name, f.path
     LIMIT $2`,
    `${nameRankSql("s.name")}, s.name, s.path`,
    params,
  );
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next:
      rows.length > limit && last ? { name: last.name, path: last.path } : null,
  };
}

/** Photos whose filename or folder path matches, as (id, folder_id, filename, s3_key) */
const PHOTO_HITS = `hits AS (
  SELECT p.id, p.folder_id, p.filename, p.s3_key FROM photos p
  WHERE p.folder_id IN (
    SELECT f.id FROM folders f WHERE ${containsSql("f.path", "$1")}
  ) AND ${notTrashed()}
  UNION
  SELECT p.id, p.folder_id, p.filename, p.s3_key FROM photos p
  WHERE ${containsSql("p.filename", "$1")} AND ${notTrashed()}
)`;

/**
 * Name matches (hits h, with their photo p and folder f) passing `filter`
 * as `select`: names find every photo, filters only those of the gallery.
 * One per stack, the best of the stack's photos the name and the filter
 * find. Read whole (sorted by folder, counted), so the stacks are settled
 * in the same pass (oneOfEachStack): stackFront's probe, put by the
 * planner inside the page's join with the folders, ran 2.6 million times
 * for « plage ».
 */
function hitRows(
  params: unknown[],
  filter: PhotoFilter,
  select: string,
): string {
  return oneOfEachStack(
    select,
    "hits h JOIN photos p ON p.id = h.id JOIN folders f ON f.id = h.folder_id",
    hasPhotoFilter(filter) ? filterConditions(params, filter) : [],
  );
}

export type SearchPhoto = Photo & { folder_name: string; folder_path: string };

/**
 * Photos whose filename or folder path matches, folder by folder (path, then
 * filename); keyset-paginated on (folder path, filename, id); only those
 * passing `filter` when given (hitRows). The page is picked on narrow
 * rows and only its photos are read in full.
 */
export async function searchPhotos(
  q: string,
  after: PhotoSearchCursor | null,
  limit: number,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<SearchPage<SearchPhoto, PhotoSearchCursor>> {
  const params: unknown[] = [searchTerms(q).like, limit + 1];
  let seek = "";
  if (after) {
    params.push(after.folderPath, after.filename, after.id);
    seek =
      "WHERE (r.path, r.filename, r.id) > ($3::text, $4::text, $5::bigint)";
  }
  const rows = hitRows(params, filter, "h.id, f.path, h.filename");
  const result = await query<
    DatabasePhoto & { folder_name: string; folder_path: string }
  >(
    `WITH ${PHOTO_HITS},
     page AS (
       SELECT r.id, r.path, r.filename FROM ${rows} r
       ${seek}
       ORDER BY r.path, r.filename, r.id
       LIMIT $2
     )
     SELECT p.*, f.name AS folder_name, f.path AS folder_path, ${stackColumns()}
     FROM page
     JOIN photos p ON p.id = page.id
     JOIN folders f ON f.id = p.folder_id
     ORDER BY page.path, page.filename, page.id`,
    params,
  );
  const items = result.rows.slice(0, limit).map((row) => ({
    ...normalizePhoto(row),
    folder_name: row.folder_name,
    folder_path: row.folder_path,
  }));
  const last = items[items.length - 1];
  return {
    items,
    next:
      result.rows.length > limit && last
        ? {
            folderPath: last.folder_path,
            filename: last.filename,
            id: String(last.id),
          }
        : null,
  };
}

/** How many photos and folders searchPhotos and searchFolders page through */
export async function countSearchMatches(
  q: string,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<{ photos: number; folders: number }> {
  const params: unknown[] = [searchTerms(q).like];
  const rows = hitRows(params, filter, "h.id");
  const result = await query<{ photos: number; folders: number }>(
    `WITH ${PHOTO_HITS}
     SELECT
       (SELECT COUNT(*) FROM ${rows} r)::int AS photos,
       (SELECT COUNT(*) FROM folders f
        WHERE ${containsSql("f.path", "$1")} AND ${HAS_CONTENT})::int AS folders`,
    params,
  );
  return requireRow(result, "Search count");
}

// ---- semantic search ------------------------------------------------------
//
// The worker embeds every image (photo_embeddings, task "embed"); the
// embedder on the worker machine embeds queries over HTTPS
// (lib/embedderClient.ts). The app never runs a model; it keeps the query
// embeddings it got in search_query_embeddings. db/schema.sql has the contract.

/** A query's embedding as pgvector text, and the model that wrote it. */
export interface QueryEmbedding {
  embedding: string;
  model: string;
}

/** The stored embedding of a normalized query (normalizeSemanticQuery), if asked before. */
export async function cachedQueryEmbedding(
  text: string,
): Promise<QueryEmbedding | null> {
  const result = await query<QueryEmbedding>(
    `UPDATE search_query_embeddings SET last_used_at = now()
     WHERE text = $1
     RETURNING embedding::text AS embedding, model`,
    [text],
  );
  return result.rows[0] ?? null;
}

/** Keeps a query's embedding for the next time it is asked. */
export async function cacheQueryEmbedding(
  text: string,
  embedding: QueryEmbedding,
): Promise<void> {
  await query(
    `INSERT INTO search_query_embeddings (text, embedding, model)
     VALUES ($1, $2::halfvec, $3)
     ON CONFLICT (text) DO UPDATE SET
       embedding = EXCLUDED.embedding, model = EXCLUDED.model,
       last_used_at = now()`,
    [text, embedding.embedding, embedding.model],
  );
}

/** The people the owner named, as the search box reads queries (lib/searchQuery.ts). */
export async function listPersonNames(): Promise<
  { id: number; name: string }[]
> {
  const result = await query<{ id: number; name: string }>(
    "SELECT id::int AS id, name FROM people WHERE name IS NOT NULL ORDER BY id",
  );
  return result.rows;
}

/**
 * Those of `tags` the worker has scored a photo of the gallery for, with
 * the vocabulary `version` (photo_tags_tag_score, the first such photo).
 * Before the photo_tags migration, none.
 */
export async function tagsWithPhotos(
  tags: string[],
  version: number,
): Promise<Set<string>> {
  if (tags.length === 0) return new Set();
  try {
    const result = await query<{ tag: string }>(
      // In score order, the first row is enough; an EXISTS took the tag's
      // whole bitmap first (1.7 s, cold, for 25 tags of 800,000 rows)
      `SELECT t.tag FROM unnest($1::text[]) AS t(tag)
       CROSS JOIN LATERAL (
         SELECT 1 FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id
         WHERE pt.tag = t.tag AND pt.vocab_version = $2::int ${andInGallery()}
         ORDER BY pt.score DESC LIMIT 1) found`,
      [tags, version],
    );
    return new Set(result.rows.map((row) => row.tag));
  } catch (error) {
    // undefined_table: db/schema.sql not applied yet
    if ((error as { code?: unknown }).code === "42P01") return new Set();
    throw error;
  }
}

/**
 * Photos a tag may show and still count as rare: a list walked in its own
 * order (by date, by color) then probes each photo for it. A copy of the
 * library with photo_tags filled for every (photo, tag), 2026-10-19: a tag
 * on 0.2% of the photos (450) took 1.0 s for a page of the timeline, 3.1 s
 * of the color list and 5.6 s of the Couleurs bands; on half of them, 9 ms.
 */
const RARE_TAG = 20_000;

/**
 * Those of `tags` fewer than RARE_TAG photos show: one count, stopped at
 * RARE_TAG, on photo_tags_tag_score alone for each (the index holds tag
 * and score; the version would read the table, and every row of a tagged
 * photo has the same one).
 */
export async function rareTags(
  tags: readonly { tag: string; threshold: number }[],
): Promise<Set<string>> {
  if (tags.length === 0) return new Set();
  const result = await query<{ tag: string }>(
    `SELECT t.tag FROM unnest($1::text[], $2::real[]) AS t(tag, threshold)
     WHERE (SELECT count(*) FROM (
       SELECT 1 FROM photo_tags pt
       WHERE pt.tag = t.tag AND pt.score >= t.threshold LIMIT $3) few) < $3`,
    [tags.map((t) => t.tag), tags.map((t) => t.threshold), RARE_TAG],
  );
  return new Set(result.rows.map((row) => row.tag));
}

/**
 * The share of the gallery's photos the worker has scored for the scene
 * tags of `version` (their interieur row, db/schema.sql), 0..1. While a run
 * goes on, a tag keeps only the photos read so far.
 */
export async function taggedShare(version: number): Promise<number> {
  const result = await query<{ tagged: number; photos: number }>(
    `SELECT
       (SELECT count(*) FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id
        WHERE pt.tag = 'interieur' AND pt.vocab_version = $1::int
          ${andInGallery()})::int AS tagged,
       (SELECT count(*) FROM photos p
        WHERE p.mime_type LIKE 'image/%' ${andInGallery()})::int AS photos`,
    [version],
  );
  const { tagged, photos } = requireRow(result, "Tagged share");
  return photos === 0 ? 1 : Math.min(1, tagged / photos);
}

/** How many photos semantic search can find (an index-only count of the key). */
export async function countPhotoEmbeddings(): Promise<number> {
  const result = await query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM photo_embeddings",
  );
  return requireRow(result).n;
}

export type ScoredPhoto = SearchPhoto & {
  /** Cosine similarity between the query and the photo, 3 decimals */
  score: number;
};

/**
 * Fewest nearest photos the index query asks for (well past the reference
 * rank). Asked for a handful (a 5-photo MCP page), the planner walks the
 * HNSW index even for a person photographed 1,667 times, and iterative scan
 * gives up at hnsw.max_scan_tuples with 1 of the 6 nearest; asked for about
 * 20 or more, it measures each of that person's photos instead (EXPLAIN
 * ANALYZE, 2026-10-18). At 100 every filter tried got the faster plan.
 */
const SEMANTIC_MIN_WINDOW = 100;

/**
 * Photos of the gallery nearest to the query embedding, most similar
 * first, among those passing `filter`; with `cut`, only down to
 * SEMANTIC_MARGIN below the SEMANTIC_REFERENCE_RANK-th one (never under
 * SEMANTIC_MIN_SIMILARITY);
 * offset-paginated (the ranking exists only for this query). One query
 * shape whatever the filter: the planner picks the plan from its estimates,
 * and on the library (EXPLAIN ANALYZE, 2026-10-18) its pick was the faster
 * one each time. A person photographed 7,000 to 20,000 times, or a common
 * color: it walks the HNSW index and iterative scan goes on until enough
 * photos pass, in relaxed order, hence the outer sort (6 to 35 ms, against
 * 74 to 290 ms for the exact distance to each; 54 to 61 of the 61 nearest,
 * the same reference photo). A year, the days of Christmas, a person in a
 * year: it measures the distance to each photo passing the filter, exact
 * (1 to 170 ms).
 * `next` is the offset of the next page, null on the last one.
 */
export async function searchPhotosByContent(
  q: QueryEmbedding,
  filter: PhotoFilter,
  offset: number,
  limit: number,
  cut = true,
): Promise<{ items: ScoredPhoto[]; next: number | null }> {
  const window = Math.max(offset + limit + 1, SEMANTIC_MIN_WINDOW);
  const params: unknown[] = [q.embedding, q.model, window];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const narrow = andPhotoFilter(params, filter, "p", "e.photo_id");
  // A stack once (a burst would fill the page with one picture), where its
  // member nearest to the query is: in the scan, a photo stays when no
  // other member the list keeps is nearer (then ranked before). The pages
  // so cut a stack at one place, whatever their window; a stack whose
  // front is far from the query still comes by its near member.
  const listed = (b: string) =>
    [`${b}.mime_type LIKE 'image/%'`, ...filterConditions(params, filter, b)]
      .map((condition) => `AND ${condition}`)
      .join("\n             ");
  const nearest = `NOT EXISTS (
           SELECT 1 FROM photo_groups stack_of
           JOIN photo_groups stack_near ON stack_near.group_id = stack_of.group_id
             AND stack_near.photo_id <> stack_of.photo_id
           JOIN photo_embeddings near_e ON near_e.photo_id = stack_near.photo_id
             AND near_e.model = $2
           JOIN photos stack_nearer ON stack_nearer.id = stack_near.photo_id
           WHERE stack_of.photo_id = e.photo_id
             AND (near_e.embedding <=> $1::halfvec, stack_near.rank)
               < (e.embedding <=> $1::halfvec, stack_of.rank)
             ${listed("stack_nearer")}
           OFFSET 0)`;
  // Shown as every list shows a stack: its best ranked photo the list keeps
  const front = `LEFT JOIN LATERAL (
         SELECT stack_front.photo_id FROM photo_groups stack_of
         JOIN photo_groups stack_front ON stack_front.group_id = stack_of.group_id
         JOIN photos front_p ON front_p.id = stack_front.photo_id
         WHERE stack_of.photo_id = n.photo_id
           AND EXISTS (SELECT 1 FROM photo_embeddings be
                       WHERE be.photo_id = front_p.id AND be.model = $2)
           ${listed("front_p")}
         ORDER BY stack_front.rank
         LIMIT 1) front ON true`;
  const floor = cut
    ? `AND n.distance <= least(
               ${add(1 - SEMANTIC_MIN_SIMILARITY)}::float8,
               coalesce(
                 (SELECT distance FROM nearest ORDER BY distance
                  OFFSET ${add(SEMANTIC_REFERENCE_RANK - 1)} LIMIT 1),
                 (SELECT max(distance) FROM nearest)) + ${add(SEMANTIC_MARGIN)}::float8)`
    : "";
  const pageOffset = add(offset);
  const pageLimit = add(limit + 1);

  const rows = await runTransaction(async (client) => {
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    await client.query("SET LOCAL jit = off");
    // ef_search is capped at 1000; iterative scan goes on past it anyway
    await client.query(
      `SET LOCAL hnsw.ef_search = ${Math.min(1000, Math.max(100, window))}`,
    );
    const result = await client.query<
      DatabasePhoto & {
        folder_name: string;
        folder_path: string;
        distance: number;
      }
    >(
      `WITH nearest AS (
         SELECT e.photo_id, e.embedding <=> $1::halfvec AS distance
         FROM photo_embeddings e
         JOIN photos p ON p.id = e.photo_id
         WHERE e.model = $2 AND p.mime_type LIKE 'image/%'
           ${narrow}
           AND ${nearest}
         ORDER BY e.embedding <=> $1::halfvec
         LIMIT $3
       )
       SELECT p.*, f.name AS folder_name, f.path AS folder_path, n.distance,
              ${stackColumns()}
       FROM nearest n
       ${front}
       JOIN photos p ON p.id = coalesce(front.photo_id, n.photo_id)
       JOIN folders f ON f.id = p.folder_id
       WHERE p.mime_type LIKE 'image/%'
         ${floor}
       ORDER BY n.distance, n.photo_id
       OFFSET ${pageOffset} LIMIT ${pageLimit}`,
      params,
    );
    return result.rows;
  });

  const items = rows.slice(0, limit).map(({ distance, ...row }) => ({
    ...normalizePhoto(row),
    folder_name: row.folder_name,
    folder_path: row.folder_path,
    score: Math.round((1 - distance) * 1000) / 1000,
  }));
  return { items, next: rows.length > limit ? offset + limit : null };
}

/**
 * Most photos a content keeps in the lists kept in their own order. Their
 * ids are given to the planner, as the rare looks' (RARE_LOOKS): the
 * distance to the content measured on each photo of a list instead took
 * 3.9 s for the months of the timeline and 3.2 s for the Couleurs bands
 * with « plage » (2026-10-19, the library).
 */
export const CONTENT_LIMIT = 5_000;

/**
 * The photos showing `q` among those passing `filter`: within the cut
 * searchPhotosByContent ranks with (SEMANTIC_MARGIN past the
 * SEMANTIC_REFERENCE_RANK-th nearest, never past 1 - SEMANTIC_MIN_SIMILARITY),
 * at most CONTENT_LIMIT, the nearest. The lists kept in their own order
 * (timeline, colors, map, a person's photos) keep those
 * (PhotoFilter.content), so a query keeps the same photos in every view.
 * `complete`: false when the limit cut the list.
 */
export async function contentPhotos(
  q: QueryEmbedding,
  filter: PhotoFilter,
): Promise<{ ids: number[]; complete: boolean }> {
  const params: unknown[] = [
    q.embedding,
    q.model,
    CONTENT_LIMIT,
    1 - SEMANTIC_MIN_SIMILARITY,
    SEMANTIC_REFERENCE_RANK,
    SEMANTIC_MARGIN,
  ];
  const narrow = andPhotoFilter(
    params,
    { ...filter, content: null },
    "p",
    "e.photo_id",
  );
  const row = await runTransaction(async (client) => {
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    await client.query("SET LOCAL jit = off");
    await client.query("SET LOCAL hnsw.ef_search = 1000");
    const result = await client.query<{ ids: string[]; nearest: number }>(
      `WITH nearest AS MATERIALIZED (
         SELECT e.photo_id, e.embedding <=> $1::halfvec AS distance
         FROM photo_embeddings e
         JOIN photos p ON p.id = e.photo_id
         WHERE e.model = $2 AND p.mime_type LIKE 'image/%'
           ${narrow}
         ORDER BY e.embedding <=> $1::halfvec
         LIMIT $3
       ),
       -- Every row of nearest sorted, not the first ones the relaxed scan
       -- returns; least() skips a NULL: no photo leaves the absolute floor
       cut AS (
         SELECT least($4::float8,
           coalesce((array_agg(distance ORDER BY distance))[$5::int],
                    max(distance)) + $6::float8) AS distance
         FROM nearest
       )
       SELECT coalesce(array_agg(n.photo_id) FILTER (WHERE n.distance <= cut.distance),
                       '{}') AS ids,
              count(*)::int AS nearest
       FROM nearest n CROSS JOIN cut`,
      params,
    );
    return requireRow(result, "Content photos");
  });
  const ids = row.ids.map(Number);
  return {
    ids,
    complete: !(row.nearest === CONTENT_LIMIT && ids.length === CONTENT_LIMIT),
  };
}

export interface FolderSuggestion {
  id: number;
  name: string;
  path: string;
  cover_photo_id: number | null;
}

/** 0 the name is the query, 1 starts with it, 2 one of its words does, 3 contains it */
function suggestRankSql(name: string): string {
  const plain = unaccented(name);
  return `(CASE
    WHEN ${plain} ILIKE $1 THEN 0
    WHEN ${plain} ILIKE $1 || '%' THEN 1
    WHEN ${plain} ~* ('(^|[^[:alnum:]])' || $2) THEN 2
    ELSE 3 END)`;
}

function depthSql(path: string): string {
  return `(length(${path}) - length(replace(${path}, '/', '')))`;
}

/**
 * Non-empty folders whose own name matches, best match first, then the
 * shallowest, then by name: where typing a few letters should lead.
 */
export async function suggestFolders(
  q: string,
  limit: number,
): Promise<FolderSuggestion[]> {
  const { like, regex } = searchTerms(q);
  const folders = await listFolders(
    `SELECT f.* FROM folders f
     WHERE ${containsSql("f.name", "$1")} AND f.path <> '' AND ${HAS_CONTENT}
     ORDER BY ${suggestRankSql("f.name")}, ${depthSql("f.path")}, f.name, f.path
     LIMIT $3`,
    `${suggestRankSql("s.name")}, ${depthSql("s.path")}, s.name, s.path`,
    [like, regex, limit],
  );
  return folders.map(({ id, name, path, cover_photo_id }) => ({
    id,
    name,
    path,
    cover_photo_id,
  }));
}

export interface LibrarySummary {
  photos: number;
  videos: number;
  /** All folders, containers included */
  folders: number;
  /** Folders holding media directly */
  albums: number;
  /** Year span of date_taken; null until some metadata exists */
  years: { from: number; to: number } | null;
}

/** The first and last year a photo of the gallery was taken; null before any is dated. */
export async function takenYears(): Promise<{
  from: number;
  to: number;
} | null> {
  // The two ends of idx_photos_date_taken, past the photos out of the gallery
  const result = await query<{ first: string | null; last: string | null }>(`
    SELECT
      (SELECT p.metadata->>'date_taken' FROM photos p
       WHERE (p.metadata->>'date_taken') IS NOT NULL ${andInGallery()}
       ORDER BY (p.metadata->>'date_taken'), p.id LIMIT 1) AS first,
      (SELECT p.metadata->>'date_taken' FROM photos p
       WHERE (p.metadata->>'date_taken') IS NOT NULL ${andInGallery()}
       ORDER BY (p.metadata->>'date_taken') DESC, p.id DESC LIMIT 1) AS last
  `);
  const { first, last } = requireRow(result);
  return first && last
    ? { from: Number(first.slice(0, 4)), to: Number(last.slice(0, 4)) }
    : null;
}

export async function getLibrarySummary(): Promise<LibrarySummary> {
  // min/max read the ends of idx_photos_date_taken; the counts scan photos
  // once; the Corbeille's photos left out
  const [media, folders, span] = await Promise.all([
    query<{ photos: number; videos: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE p.mime_type LIKE 'image/%')::int AS photos,
        COUNT(*) FILTER (WHERE p.mime_type LIKE 'video/%')::int AS videos
      FROM photos p WHERE ${notTrashed()}
    `),
    query<{ folders: number; albums: number }>(`
      SELECT COUNT(*)::int AS folders,
             COUNT(*) FILTER (WHERE photo_count > 0)::int AS albums
      FROM folders WHERE path <> ''
    `),
    query<{ first: string | null; last: string | null }>(`
      SELECT
        (SELECT p.metadata->>'date_taken' FROM photos p
         WHERE (p.metadata->>'date_taken') IS NOT NULL AND ${notTrashed()}
         ORDER BY (p.metadata->>'date_taken'), p.id LIMIT 1) AS first,
        (SELECT p.metadata->>'date_taken' FROM photos p
         WHERE (p.metadata->>'date_taken') IS NOT NULL AND ${notTrashed()}
         ORDER BY (p.metadata->>'date_taken') DESC, p.id DESC LIMIT 1) AS last
    `),
  ]);

  const { first, last } = requireRow(span);
  const { photos, videos } = requireRow(media);
  const counts = requireRow(folders);
  return {
    photos,
    videos,
    folders: counts.folders,
    albums: counts.albums,
    years:
      first && last
        ? { from: Number(first.slice(0, 4)), to: Number(last.slice(0, 4)) }
        : null,
  };
}

export async function getFolderByPath(path: string): Promise<Folder | null> {
  const result = await query<Folder>("SELECT * FROM folders WHERE path = $1", [
    path,
  ]);
  return result.rows[0] ?? null;
}

export async function createOrUpdateFolder(
  folderData: CreateFolderData,
): Promise<Folder> {
  const result = await query<Folder>(
    `
    INSERT INTO folders (path, name, parent_id, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      name = EXCLUDED.name,
      parent_id = EXCLUDED.parent_id,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `,
    [folderData.path, folderData.name, folderData.parent_id],
  );

  return requireRow(result);
}

/**
 * A folder's files, by name, but those in the Corbeille. With `stacked`
 * (the Bibliothèque), one per stack of near-duplicates: the best of the
 * stack's photos in this folder. Shares and MCP list the files as they are.
 */
export async function getPhotosInFolder(
  folderId: number,
  stacked = false,
): Promise<Photo[]> {
  const result = await query<DatabasePhoto>(
    stacked
      ? `SELECT p.*, ${stackColumns()} FROM photos p
         WHERE p.folder_id = $1 AND ${notTrashed()}
           AND ${stackFront([`${BETTER}.folder_id = $1`])}
         ORDER BY p.filename`
      : `SELECT * FROM photos p WHERE p.folder_id = $1 AND ${notTrashed()}
         ORDER BY p.filename`,
    [folderId],
  );

  return result.rows.map(normalizePhoto);
}

/**
 * In a photo upsert: true when the incoming file differs from the stored one
 * (bucketDiff.ts isFileChanged): another size or date, or another ETag when
 * both are known. A sync that rewrote metadata for every unchanged file wiped
 * the EXIF data of 91k photos on 2026-10-18; only a replaced file may lose
 * what was extracted.
 */
const FILE_CHANGED = `(photos.size IS DISTINCT FROM EXCLUDED.size
  OR photos.modified_at IS DISTINCT FROM EXCLUDED.modified_at
  OR (photos.etag IS NOT NULL AND EXCLUDED.etag IS NOT NULL AND photos.etag <> EXCLUDED.etag))`;

/**
 * The Corbeille's marks of a photo whose file is `changed`: a new file put
 * on a key in the Corbeille is not what the owner threw away, so it comes
 * back (the purge would erase it).
 */
const TRASH_KEPT_UNLESS = (changed: string) =>
  ["trashed_at", "trashed_by", "trash_batch", "trashed_for"]
    .map(
      (column) =>
        `${column} = CASE WHEN ${changed} THEN NULL ELSE photos.${column} END`,
    )
    .join(",\n      ");

/** An ETag as stored: quotes stripped, none when empty. */
export function storedEtag(etag: string | undefined | null): string | null {
  const value = etag?.replace(/"/g, "") ?? "";
  return value === "" ? null : value;
}

export async function createOrUpdatePhoto(
  photoData: CreatePhotoData,
): Promise<Photo> {
  const metadataStatus =
    photoData.metadata_status ?? (photoData.metadata ? "extracted" : "none");
  const thumbnailStatus = photoData.thumbnail_status ?? "none";

  const result = await query<DatabasePhoto>(
    `
    INSERT INTO photos (
      folder_id, filename, s3_key, size, mime_type, modified_at,
      metadata, metadata_status, thumbnail_status, etag, last_synced
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
    ON CONFLICT(s3_key) DO UPDATE SET
      folder_id = EXCLUDED.folder_id,
      filename = EXCLUDED.filename,
      size = EXCLUDED.size,
      mime_type = EXCLUDED.mime_type,
      modified_at = EXCLUDED.modified_at,
      -- A rescan of an unchanged file keeps everything extracted from it;
      -- only a new size or date (the file was replaced) resets it.
      metadata = CASE WHEN ${FILE_CHANGED} THEN EXCLUDED.metadata ELSE photos.metadata END,
      metadata_status = CASE WHEN ${FILE_CHANGED} THEN EXCLUDED.metadata_status ELSE photos.metadata_status END,
      thumbnail_status = CASE WHEN ${FILE_CHANGED} THEN EXCLUDED.thumbnail_status ELSE photos.thumbnail_status END,
      -- The new file's, else the stored one while it is still that file's
      etag = coalesce(EXCLUDED.etag, CASE WHEN ${FILE_CHANGED} THEN NULL ELSE photos.etag END),
      ${TRASH_KEPT_UNLESS(FILE_CHANGED)},
      last_synced = CURRENT_TIMESTAMP
    RETURNING *
  `,
    [
      photoData.folder_id,
      photoData.filename,
      photoData.s3_key,
      photoData.size,
      photoData.mime_type,
      photoData.modified_at,
      photoData.metadata, // PostgreSQL JSONB handles objects directly
      metadataStatus,
      thumbnailStatus,
      storedEtag(photoData.etag),
    ],
  );

  return normalizePhoto(requireRow(result));
}

/** A photo file as the sync diff compares it with the bucket */
export interface PhotoFile {
  id: number;
  s3_key: string;
  size: number;
  modified_at: Date;
  etag: string | null;
}

/**
 * Rows per read of getPhotoFiles. The whole table (~30 MB for 215k photos)
 * in one result took 100 s over a slow link, past the pool's 60 s query
 * timeout; a page stays well under it.
 */
const PHOTO_FILES_PAGE = 20_000;

/**
 * Every photo's file (or those under `prefix`), read in id order by pages:
 * the sync diffs the bucket against it.
 */
export async function getPhotoFiles(prefix?: string): Promise<PhotoFile[]> {
  const files: PhotoFile[] = [];
  let afterId = 0;
  for (;;) {
    const { rows } = await query<PhotoFile>(
      `
      SELECT id::int AS id, s3_key, size::float8 AS size, modified_at, etag
      FROM photos
      WHERE id > $1 AND ($3::text IS NULL OR starts_with(s3_key, $3))
      ORDER BY id LIMIT $2
    `,
      [afterId, PHOTO_FILES_PAGE, prefix ?? null],
    );
    for (const row of rows) files.push(row);
    const last = rows[rows.length - 1];
    if (last === undefined || rows.length < PHOTO_FILES_PAGE) return files;
    afterId = last.id;
  }
}

/** Every folder's id by path, in one read */
export async function getFolderIdsByPath(): Promise<Map<string, number>> {
  const result = await query<{ id: number; path: string }>(
    "SELECT id::int AS id, path FROM folders",
  );
  return new Map(result.rows.map((row) => [row.path, row.id]));
}

/** A photo as the sync first records it: nothing extracted from the file yet */
export type NewPhoto = Omit<CreatePhotoData, "metadata"> &
  Required<Pick<CreatePhotoData, "metadata_status" | "thumbnail_status">>;

/**
 * Inserts photos the database doesn't have. A key that is already there is
 * left exactly as it is: inserting never overwrites what was extracted.
 * Returns how many rows were inserted.
 */
export async function insertNewPhotos(photos: NewPhoto[]): Promise<number> {
  if (photos.length === 0) return 0;

  const result = await query(
    `
    INSERT INTO photos (
      folder_id, filename, s3_key, size, mime_type, modified_at,
      metadata_status, thumbnail_status, etag, last_synced
    )
    SELECT n.*, CURRENT_TIMESTAMP
    FROM unnest(
      $1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::text[],
      $6::timestamp[], $7::text[], $8::text[], $9::text[]
    ) AS n
    ON CONFLICT (s3_key) DO NOTHING
  `,
    [
      photos.map((p) => p.folder_id),
      photos.map((p) => p.filename),
      photos.map((p) => p.s3_key),
      photos.map((p) => p.size),
      photos.map((p) => p.mime_type),
      photos.map((p) => p.modified_at),
      photos.map((p) => p.metadata_status),
      photos.map((p) => p.thumbnail_status),
      photos.map((p) => storedEtag(p.etag)),
    ],
  );
  return result.rowCount ?? 0;
}

export interface ReplacedFile {
  id: number;
  size: number;
  modified_at: string;
  etag: string | null;
  thumbnail_status: ThumbnailStatus;
}

/**
 * Records that these photos' files were replaced: what was extracted from the
 * old file (metadata, thumbnail) is dropped so it is read again from the new
 * one. Faces, colours and descriptions are not touched here. A photo in the
 * Corbeille comes back: the new file is not the one thrown away, and the
 * purge would erase it.
 */
export async function resetReplacedPhotos(
  files: ReplacedFile[],
): Promise<void> {
  if (files.length === 0) return;

  await query(
    `
    UPDATE photos p SET
      size = f.size,
      modified_at = f.modified_at,
      metadata = NULL,
      metadata_status = 'none',
      thumbnail_status = f.thumbnail_status,
      thumbnail_path = NULL,
      etag = f.etag,
      trashed_at = NULL,
      trashed_by = NULL,
      trash_batch = NULL,
      trashed_for = NULL,
      last_synced = CURRENT_TIMESTAMP
    FROM unnest($1::bigint[], $2::bigint[], $3::timestamp[], $4::text[], $5::text[])
      AS f(id, size, modified_at, thumbnail_status, etag)
    WHERE p.id = f.id
  `,
    [
      files.map((f) => f.id),
      files.map((f) => f.size),
      files.map((f) => f.modified_at),
      files.map((f) => f.thumbnail_status),
      files.map((f) => storedEtag(f.etag)),
    ],
  );
}

/**
 * Deletes photos whose file left the bucket. Their faces, descriptions and
 * analysis jobs go with them (ON DELETE CASCADE); share access logs keep
 * their row without the photo. Returns how many were deleted.
 */
export async function deletePhotos(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;

  return runTransaction(async (client) => {
    await client.query(
      "UPDATE share_access_logs SET photo_id = NULL WHERE photo_id = ANY($1::bigint[])",
      [ids],
    );
    const result = await client.query(
      "DELETE FROM photos WHERE id = ANY($1::bigint[])",
      [ids],
    );
    return result.rowCount ?? 0;
  });
}

export async function bulkCreateOrUpdateFolders(
  foldersData: CreateFolderData[],
): Promise<Folder[]> {
  if (foldersData.length === 0) return [];

  return runTransaction(async (client) => {
    // Prepare data for bulk insert
    const values: unknown[] = [];
    const placeholders: string[] = [];

    foldersData.forEach((folderData, index) => {
      const baseIndex = index * 3;
      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, CURRENT_TIMESTAMP)`,
      );

      values.push(folderData.path, folderData.name, folderData.parent_id);
    });

    // Execute single bulk INSERT with ON CONFLICT
    const result = await client.query<Folder>(
      `
      INSERT INTO folders (path, name, parent_id, updated_at)
      VALUES ${placeholders.join(", ")}
      ON CONFLICT(path) DO UPDATE SET
        name = EXCLUDED.name,
        parent_id = EXCLUDED.parent_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
      values,
    );

    return result.rows;
  });
}

export async function updatePhotoThumbnail(
  photoId: number,
  thumbnailPath: string,
): Promise<void> {
  await query(
    "UPDATE photos SET thumbnail_path = $1, thumbnail_status = $2 WHERE id = $3",
    [thumbnailPath, "generated", photoId],
  );
}

export async function updatePhotoMetadata(
  photoId: number,
  metadata: PhotoMetadata,
): Promise<void> {
  await query(
    "UPDATE photos SET metadata = $1, metadata_status = $2 WHERE id = $3",
    [metadata, "extracted", photoId], // PostgreSQL JSONB handles objects directly
  );
}

/** Persists probed metadata only when the row has none yet (never overwrites) */
export async function fillPhotoMetadataIfMissing(
  photoId: number,
  metadata: PhotoMetadata,
): Promise<boolean> {
  const result = await query(
    `UPDATE photos SET metadata = $1, metadata_status = 'extracted'
     WHERE id = $2 AND metadata IS NULL`,
    [metadata, photoId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * RAW files report the 160×120 strip of IFD0 as their size until the sensor
 * size is read from their larger IFDs; this corrects it (display-oriented).
 */
export async function setPhotoDimensions(
  photoId: number,
  dimensions: { width: number; height: number },
): Promise<void> {
  await query(
    `UPDATE photos
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{dimensions}', $1::jsonb)
     WHERE id = $2`,
    [JSON.stringify(dimensions), photoId],
  );
}

export interface TimelineCursor {
  dateTaken: string;
  id: number;
}

export type TimelinePhoto = Photo & { folder_path: string };

/**
 * Photos of the gallery with a date_taken, newest first, keyset-paginated
 * on (date_taken, id); only those passing `filter` when given.
 * Uses idx_photos_date_taken (db/schema.sql).
 */
export async function getTimelinePhotos(
  before: TimelineCursor | null,
  limit: number,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<TimelinePhoto[]> {
  const params: unknown[] = [limit];
  let cursorFilter = "";
  if (before) {
    params.push(before.dateTaken, before.id);
    // Row comparison so the btree on (date_taken, id) serves the seek
    cursorFilter = `AND ((p.metadata->>'date_taken'), p.id) < ($2::text, $3::bigint)`;
  }
  const narrow = andPhotoFilter(params, filter);
  const front = stackFront([
    dated(BETTER),
    ...betterPassFilter(params, filter),
  ]);

  const result = await listQuery<DatabasePhoto & { folder_path: string }>(
    `
    SELECT p.*, f.path AS folder_path, ${stackColumns()}
    FROM photos p
    JOIN folders f ON f.id = p.folder_id
    WHERE (p.metadata->>'date_taken') IS NOT NULL
      ${cursorFilter}
      ${narrow}
      AND ${front}
    ORDER BY (p.metadata->>'date_taken') DESC, p.id DESC
    LIMIT $1
  `,
    params,
  );

  return result.rows.map((row) => ({
    ...normalizePhoto(row),
    folder_path: row.folder_path,
  }));
}

export interface TimelineSummary {
  /** Tiles per month: a stack counts once */
  months: { month: string; count: number }[];
  /** Every photo (images and videos) of the gallery passing the filter, dated or not, a stack once */
  total_photos: number;
}

/** Months as getTimelinePhotos pages through them, with the same filter. */
export async function getTimelineSummary(
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<TimelineSummary> {
  const params: unknown[] = [];
  const months = oneOfEachStack(
    "substr(p.metadata->>'date_taken', 1, 7) AS month",
    "photos p",
    [dated("p"), ...filterConditions(params, filter)],
  );
  const totalParams: unknown[] = [];
  const all = oneOfEachStack(
    "p.id",
    "photos p",
    filterConditions(totalParams, filter),
  );
  const [byMonth, total] = await Promise.all([
    listQuery<{ month: string; count: number }>(
      `SELECT month, COUNT(*)::int AS count FROM ${months} m
       GROUP BY 1 ORDER BY 1 DESC`,
      params,
    ),
    listQuery<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM ${all} a`,
      totalParams,
    ),
  ]);
  return { months: byMonth.rows, total_photos: requireRow(total).total };
}

// On the map: a GPS fix (imageProbe only writes finite numbers, never 0,0)
// and a date taken, which the period and the newest-first order need.
const onMap = (p: string) => `(${p}.metadata->'location') IS NOT NULL
  AND (${p}.metadata->>'date_taken') IS NOT NULL`;
const latitude = (p: string) =>
  `((${p}.metadata->'location'->>'latitude')::float8)`;
const longitude = (p: string) =>
  `((${p}.metadata->'location'->>'longitude')::float8)`;
const LATITUDE = latitude("p");
const LONGITUDE = longitude("p");

/**
 * Conditions over photos `p` of the gallery on the map passing `filter`,
 * within the period and the box when given; values go to `params`. The
 * period is one more date range of the filter (periodFilter): months and
 * days compare as text against the ISO date_taken, so idx_photos_date_taken
 * serves them.
 */
function mapConditions(
  params: unknown[],
  filter: PhotoFilter,
  period: MapPeriod,
  box: MapBox | null,
  p: string,
): string[] {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [
    onMap(p),
    ...filterConditions(
      params,
      { ...filter, dates: [...filter.dates, periodFilter(period)] },
      p,
    ),
  ];
  if (box) {
    where.push(
      `${latitude(p)} BETWEEN ${add(box.south)}::float8 AND ${add(box.north)}::float8`,
      `${longitude(p)} BETWEEN ${add(box.west)}::float8 AND ${add(box.east)}::float8`,
    );
  }
  return where;
}

/** WHERE clause of mapConditions over photos p, one tile per stack: for a page of photos. */
function mapFilter(
  params: unknown[],
  filter: PhotoFilter,
  period: MapPeriod,
  box: MapBox | null,
): string {
  return [
    ...mapConditions(params, filter, period, box, "p"),
    stackFront(mapConditions(params, filter, period, box, BETTER)),
  ].join("\n  AND ");
}

/** mapFilter for a count over the whole map: the CTE to put in WITH, and the WHERE clause. */
function mapWhole(
  params: unknown[],
  filter: PhotoFilter,
  period: MapPeriod,
  box: MapBox | null,
  select: string,
): string {
  return oneOfEachStack(
    select,
    "photos p",
    mapConditions(params, filter, period, box, "p"),
  );
}

/**
 * Photos per map cell as [latitude, longitude, count], placed at the mean
 * position of the cell's photos (4 decimals, about 10 m): circles land
 * where the photos were taken instead of on a grid.
 */
export async function getMapPoints(
  period: MapPeriod,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<[number, number, number][]> {
  const params: unknown[] = [CELLS_PER_DEGREE];
  const whole = mapWhole(
    params,
    filter,
    period,
    null,
    `${LATITUDE} AS lat, ${LONGITUDE} AS lng`,
  );
  const result = await listQuery<{ lat: number; lng: number; count: number }>(
    `
    SELECT round(AVG(w.lat)::numeric, 4)::float8 AS lat,
           round(AVG(w.lng)::numeric, 4)::float8 AS lng,
           COUNT(*)::int AS count
    FROM ${whole} w
    GROUP BY round(w.lat * $1), round(w.lng * $1)
  `,
    params,
  );
  return result.rows.map((row) => [row.lat, row.lng, row.count]);
}

/**
 * Photos on the map per day of date taken when they span at most DAY_SPAN
 * days, else per month, oldest first; only those taken inside the box when
 * one is given. One scan: the days are counted, then folded into months.
 */
export async function getMapDates(
  box: MapBox | null,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<{
  unit: "day" | "month";
  dates: { date: string; count: number }[];
}> {
  const params: unknown[] = [DAY_SPAN];
  const whole = mapWhole(
    params,
    filter,
    { from: null, to: null },
    box,
    "substr(p.metadata->>'date_taken', 1, 10) AS day",
  );
  const result = await listQuery<{ date: string; count: number }>(
    `
    WITH days AS (
      SELECT w.day, COUNT(*)::int AS count FROM ${whole} w GROUP BY 1
    ), span AS (
      SELECT max(day)::date - min(day)::date <= $1::int AS by_day FROM days
    )
    SELECT CASE WHEN span.by_day THEN days.day ELSE substr(days.day, 1, 7) END AS date,
           SUM(days.count)::int AS count
    FROM days CROSS JOIN span
    GROUP BY 1
    ORDER BY 1
  `,
    params,
  );
  const first = result.rows[0];
  return {
    unit: first && isDay(first.date) ? "day" : "month",
    dates: result.rows,
  };
}

/**
 * Photos taken inside the box, newest first, keyset-paginated on
 * (date_taken, id) like the timeline. No index covers the coordinates, so
 * each page scans the table (0.1–0.2 s warm for 210k photos); the page is
 * picked on narrow rows first and only its photos are read in full and
 * joined to their folder, which halves a page over the whole world.
 */
export async function getMapPhotos(
  box: MapBox,
  period: MapPeriod,
  after: TimelineCursor | null,
  limit: number,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<TimelinePhoto[]> {
  const params: unknown[] = [limit];
  const where = mapFilter(params, filter, period, box);
  let seek = "";
  if (after) {
    params.push(after.dateTaken, after.id);
    seek = `AND ((p.metadata->>'date_taken'), p.id) < ($${params.length - 1}::text, $${params.length}::bigint)`;
  }
  const result = await listQuery<DatabasePhoto & { folder_path: string }>(
    `
    WITH page AS (
      SELECT p.id, (p.metadata->>'date_taken') AS taken
      FROM photos p
      WHERE ${where}
        ${seek}
      ORDER BY (p.metadata->>'date_taken') DESC, p.id DESC
      LIMIT $1
    )
    SELECT p.*, f.path AS folder_path, ${stackColumns()}
    FROM page
    JOIN photos p ON p.id = page.id
    JOIN folders f ON f.id = p.folder_id
    ORDER BY page.taken DESC, page.id DESC
  `,
    params,
  );
  return result.rows.map((row) => ({
    ...normalizePhoto(row),
    folder_path: row.folder_path,
  }));
}

/** How many photos getMapPhotos pages through. */
export async function countMapPhotos(
  box: MapBox,
  period: MapPeriod,
  filter: PhotoFilter = NO_PHOTO_FILTER,
): Promise<number> {
  const params: unknown[] = [];
  const whole = mapWhole(params, filter, period, box, "p.id");
  const result = await listQuery<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM ${whole} w`,
    params,
  );
  return requireRow(result).total;
}

export async function updatePhotoStatus(
  photoId: number,
  status: UpdatePhotoStatus,
): Promise<void> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramCount = 1;

  if (status.metadata_status) {
    updates.push(`metadata_status = $${paramCount}`);
    values.push(status.metadata_status);
    paramCount++;
  }

  if (status.thumbnail_status) {
    updates.push(`thumbnail_status = $${paramCount}`);
    values.push(status.thumbnail_status);
    paramCount++;
  }

  if (updates.length > 0) {
    values.push(photoId);
    await query(
      `UPDATE photos SET ${updates.join(", ")} WHERE id = $${paramCount}`,
      values,
    );
  }
}

export async function getPhoto(photoId: number): Promise<Photo | null> {
  const result = await query<DatabasePhoto>(
    "SELECT * FROM photos WHERE id = $1",
    [photoId],
  );
  const photo = result.rows[0];

  if (!photo) return null;

  return normalizePhoto(photo);
}

/**
 * getPhoto, null for a photo in the Corbeille: what a share link may serve
 * (the owner's own routes still show it, from the Corbeille page).
 */
export async function getPhotoOutOfCorbeille(
  photoId: number,
): Promise<Photo | null> {
  const result = await query<DatabasePhoto>(
    `SELECT * FROM photos p WHERE p.id = $1 AND ${notTrashed()}`,
    [photoId],
  );
  const photo = result.rows[0];
  return photo ? normalizePhoto(photo) : null;
}

export async function createSyncJob(
  jobData: CreateSyncJobData,
): Promise<SyncJob> {
  const result = await query<SyncJob>(
    `
    INSERT INTO sync_jobs (type, folder_path, status, processed_items, total_items)
    VALUES ($1, $2, 'pending', 0, 0)
    RETURNING *
  `,
    [jobData.type, jobData.folder_path],
  );

  return requireRow(result);
}

/** Every update is also a heartbeat: the job's process is alive. */
export async function updateSyncJob(
  jobId: number,
  updates: Partial<SyncJob>,
): Promise<void> {
  const fields = [
    ...Object.keys(updates).map((key, index) => `${key} = $${index + 1}`),
    "heartbeat_at = CURRENT_TIMESTAMP",
  ].join(", ");
  const values = [...Object.values(updates), jobId];

  await query(
    `UPDATE sync_jobs SET ${fields} WHERE id = $${values.length}`,
    values,
  );
}

/**
 * Takes a pending job for this process: false when another process got it
 * first, so two sync loops never run the same job.
 */
export async function claimSyncJob(jobId: number): Promise<boolean> {
  const result = await query(
    `
    UPDATE sync_jobs
    SET status = 'running', started_at = CURRENT_TIMESTAMP, heartbeat_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND status = 'pending'
  `,
    [jobId],
  );
  return result.rowCount === 1;
}

/**
 * Fails running jobs whose process stopped beating `minutes` ago or more, so
 * a scan left behind by a dead process no longer blocks the queue. Returns
 * the ids it failed.
 */
export async function failStaleSyncJobs(minutes: number): Promise<number[]> {
  const result = await query<{ id: number }>(
    `
    UPDATE sync_jobs
    SET status = 'failed',
        completed_at = CURRENT_TIMESTAMP,
        error_message = $2
    WHERE status = 'running'
      AND COALESCE(heartbeat_at, started_at, created_at)
          < CURRENT_TIMESTAMP - make_interval(mins => $1::int)
    RETURNING id
  `,
    [
      minutes,
      `Abandoned: no heartbeat for ${minutes} minutes (the process running it stopped)`,
    ],
  );
  return result.rows.map((row) => row.id);
}

export async function getSyncJob(jobId: number): Promise<SyncJob | null> {
  const result = await query<SyncJob>("SELECT * FROM sync_jobs WHERE id = $1", [
    jobId,
  ]);
  return result.rows[0] ?? null;
}

export async function getActiveSyncJobs(): Promise<SyncJob[]> {
  const result = await query<SyncJob>(`
    SELECT * FROM sync_jobs
    WHERE status IN ('pending', 'running')
    ORDER BY id ASC
  `);

  return result.rows;
}

export async function updateFolderCounts(folderId: number): Promise<void> {
  // COUNT(*) is a bigint: pg returns it as a string, passed back as a parameter below
  const photoCountResult = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM photos WHERE folder_id = $1",
    [folderId],
  );
  const subfolderCountResult = await query<{ count: string }>(
    "SELECT COUNT(*) as count FROM folders WHERE parent_id = $1",
    [folderId],
  );

  const photoCount = requireRow(photoCountResult).count;
  const subfolderCount = requireRow(subfolderCountResult).count;

  await query(
    `
    UPDATE folders
    SET photo_count = $1, subfolder_count = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
  `,
    [photoCount, subfolderCount, folderId],
  );
}

// Incremental folder count updates
export async function incrementFolderPhotoCount(
  folderId: number,
  delta = 1,
): Promise<void> {
  await query(
    `
    UPDATE folders
    SET photo_count = photo_count + $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `,
    [delta, folderId],
  );
}

export async function incrementFolderSubfolderCount(
  folderId: number,
  delta = 1,
): Promise<void> {
  await query(
    `
    UPDATE folders
    SET subfolder_count = subfolder_count + $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `,
    [delta, folderId],
  );
}

// Update folder last synced timestamp
export async function updateFolderLastSynced(folderId: number): Promise<void> {
  await query(
    `
    UPDATE folders
    SET last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
  `,
    [folderId],
  );
}

export async function updateFolderLastVisited(
  folderPath: string,
): Promise<void> {
  await query(
    `
    UPDATE folders
    SET last_visited = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE path = $1
  `,
    [folderPath],
  );
}

/**
 * Stamps as synced every folder (or `folder` and those under it): called
 * after a complete listing, which checked each of them, changed or not.
 */
export async function markFoldersSynced(folder?: string): Promise<void> {
  await query(
    `
    UPDATE folders SET last_synced = CURRENT_TIMESTAMP
    WHERE $1::text IS NULL OR path = $1 OR starts_with(path, $1 || '/')
  `,
    [folder ?? null],
  );
}

/**
 * Recounts the direct photos and subfolders of every folder and writes only
 * the counts that are wrong: a full scan leaves them all right, whatever
 * changed them since (a photo deleted from the app, a scan stopped midway),
 * without rewriting the ~23k folders. Returns how many it corrected.
 */
export async function recountDriftedFolders(): Promise<number> {
  const result = await query(`
    UPDATE folders f SET
      photo_count = n.photos,
      subfolder_count = n.subfolders,
      updated_at = CURRENT_TIMESTAMP
    FROM (
      SELECT d.id,
        (SELECT COUNT(*) FROM photos p WHERE p.folder_id = d.id) AS photos,
        (SELECT COUNT(*) FROM folders c WHERE c.parent_id = d.id) AS subfolders
      FROM folders d
    ) n
    WHERE f.id = n.id
      AND (f.photo_count, f.subfolder_count) IS DISTINCT FROM (n.photos, n.subfolders)
  `);
  return result.rowCount ?? 0;
}

export async function deleteOldThumbnails(
  maxAgeDays: number,
): Promise<string[]> {
  const selectResult = await query<{ thumbnail_path: string }>(
    `
    SELECT thumbnail_path FROM photos
    WHERE thumbnail_path IS NOT NULL
    AND last_synced < NOW() - INTERVAL '$1 days'
  `,
    [maxAgeDays],
  );

  const thumbnailPaths = selectResult.rows.map((row) => row.thumbnail_path);

  await query(
    `
    UPDATE photos
    SET thumbnail_path = NULL
    WHERE thumbnail_path IS NOT NULL
    AND last_synced < NOW() - INTERVAL '$1 days'
  `,
    [maxAgeDays],
  );

  return thumbnailPaths;
}

// ============================================================================
// FOLDER SHARING FUNCTIONS
// ============================================================================

export interface SharedFolder {
  id: number;
  folder_path: string;
  folder_id: number | null;
  share_token: string;
  password_hash: string | null;
  expires_at: string | null;
  created_at: string;
  description: string | null;
  view_count: number;
  last_accessed: string | null;
  allow_download: boolean;
  is_active: boolean;
  created_by: string;
  /** Present on listings (getAllSharedFolders) only */
  cover_photo_id?: number | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface ShareAccessLog {
  id: number;
  share_id: number;
  ip_address: string | null;
  user_agent: string | null;
  access_type: "view" | "download" | "password_attempt";
  accessed_at: string;
  success: boolean;
}

export interface CreateShareData {
  folder_path: string;
  folder_id?: number;
  password?: string;
  expires_at?: string;
  description?: string;
  allow_download?: boolean;
}

export async function createFolderShare(
  shareData: CreateShareData,
): Promise<SharedFolder> {
  // Generate a unique share token
  const shareToken = crypto.randomUUID();

  // Hash password if provided
  let passwordHash: string | null = null;
  if (shareData.password) {
    passwordHash = await hash(shareData.password, 12);
  }

  // Get folder ID if not provided
  let folderId = shareData.folder_id;
  if (!folderId && shareData.folder_path) {
    const folder = await getFolderByPath(shareData.folder_path);
    folderId = folder?.id ?? undefined;
  }

  const result = await query<SharedFolder>(
    `
    INSERT INTO shared_folders (
      share_token, folder_path, folder_id, password_hash,
      expires_at, description, allow_download
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `,
    [
      shareToken,
      shareData.folder_path,
      folderId,
      passwordHash,
      textOrNull(shareData.expires_at),
      textOrNull(shareData.description),
      shareData.allow_download !== false,
    ],
  );

  return normalizeShare(requireRow(result));
}

export async function getSharedFolder(
  shareToken: string,
): Promise<SharedFolder | null> {
  const result = await query<SharedFolder>(
    `
    SELECT * FROM shared_folders
    WHERE share_token = $1 AND is_active = true
  `,
    [shareToken],
  );

  const share = result.rows[0];

  if (!share) return null;

  // Check if share has expired
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }

  return normalizeShare(share);
}

export async function validateSharePassword(
  shareToken: string,
  password: string,
): Promise<boolean> {
  const result = await query<{ password_hash: string | null }>(
    `
    SELECT password_hash FROM shared_folders
    WHERE share_token = $1 AND is_active = true
  `,
    [shareToken],
  );

  const shareData = result.rows[0];

  if (!shareData?.password_hash) {
    return true; // No password required
  }

  return await compare(password, shareData.password_hash);
}

export async function incrementShareViewCount(
  shareToken: string,
): Promise<void> {
  await query(
    `
    UPDATE shared_folders
    SET view_count = view_count + 1, last_accessed = CURRENT_TIMESTAMP
    WHERE share_token = $1 AND is_active = true
  `,
    [shareToken],
  );
}

export async function logShareAccess(
  shareId: number,
  accessData: {
    ip_address?: string;
    user_agent?: string;
    access_type: "view" | "download" | "password_attempt";
    success?: boolean;
  },
): Promise<void> {
  await query(
    `
    INSERT INTO share_access_logs (
      shared_folder_id, ip_address, user_agent, access_type, success
    )
    VALUES ($1, $2, $3, $4, $5)
  `,
    [
      shareId,
      textOrNull(accessData.ip_address),
      textOrNull(accessData.user_agent),
      accessData.access_type,
      accessData.success !== false,
    ],
  );
}

export async function getAllSharedFolders(): Promise<SharedFolder[]> {
  // A share exposes the folder's own photos, so the cover comes from those only.
  const result = await query<SharedFolder & { folder_name: string }>(`
    SELECT
      sf.*,
      f.name AS folder_name,
      cover.id::int AS cover_photo_id,
      dates.date_from,
      dates.date_to
    FROM shared_folders sf
    LEFT JOIN folders f ON sf.folder_id = f.id
    LEFT JOIN LATERAL (
      SELECT p.id FROM photos p
      WHERE p.folder_id = sf.folder_id AND p.mime_type LIKE 'image/%'
      ORDER BY (p.thumbnail_status = 'generated') DESC, p.filename, p.id
      LIMIT 1
    ) cover ON true
    LEFT JOIN LATERAL (
      SELECT
        MIN(p.metadata->>'date_taken') AS date_from,
        MAX(p.metadata->>'date_taken') AS date_to
      FROM photos p
      WHERE p.folder_id = sf.folder_id
    ) dates ON true
    ORDER BY sf.created_at DESC
  `);

  return result.rows.map(normalizeShare);
}

export async function deactivateShare(shareToken: string): Promise<void> {
  await query(
    `
    UPDATE shared_folders
    SET is_active = false
    WHERE share_token = $1
  `,
    [shareToken],
  );
}

export async function deleteExpiredShares(): Promise<number> {
  const result = await query(`
    DELETE FROM shared_folders
    WHERE expires_at IS NOT NULL
    AND expires_at < CURRENT_TIMESTAMP
  `);

  return result.rowCount ?? 0;
}

export async function getShareAccessLogs(
  shareId: number,
  limit = 100,
): Promise<ShareAccessLog[]> {
  const result = await query<ShareAccessLog>(
    `
    SELECT * FROM share_access_logs
    WHERE share_id = $1
    ORDER BY accessed_at DESC
    LIMIT $2
  `,
    [shareId, limit],
  );

  return result.rows.map((log) => ({
    ...log,
    success: Boolean(log.success),
  }));
}
