import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { Pool, types } from "pg";
import type { Folder, Photo, PhotoMetadata } from "@/types";
import * as crypto from "crypto";
import { compare, hash } from "bcryptjs";
import { logger } from "./logger";
import { thumbnailUrl } from "./photoUrls";
import {
  addDays,
  CELLS_PER_DEGREE,
  DAY_SPAN,
  isDay,
  lastDay,
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
  ANY_DATE,
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
}

/**
 * Normalize database photo row to Photo type with proper boolean and URL handling
 */
function normalizePhoto(dbPhoto: DatabasePhoto): Photo {
  return {
    ...dbPhoto,
    is_favorite: Boolean(dbPhoto.is_favorite),
    thumbnail_url: thumbnailUrl(dbPhoto.id),
    metadata: dbPhoto.metadata,
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
> & {
  thumbnails_generated: boolean | null;
  cover_photo_id: number | null | undefined;
  date_from: string | null | undefined;
  date_to: string | null | undefined;
  palette: Swatch[] | null;
};

/**
 * Adds listing fields (thumbnail state, size, date span, cover, palette)
 * to the folders selected by `baseSql`, which must select `f.*` from
 * `folders f`.
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
  const sql = `
    WITH sub AS (${baseSql})
    SELECT
      s.*,
      agg.thumbnails_generated,
      agg.total_size,
      agg.folder_created_at,
      agg.date_from,
      agg.date_to,
      (CASE WHEN own_cover.is_photo THEN own_cover.id
            ELSE COALESCE(descendant_photo.id, own_cover.id, descendant_image.id)
       END)::int AS cover_photo_id,
      fp.swatches AS palette
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
        MIN(p.modified_at) AS folder_created_at,
        MIN(p.metadata->>'date_taken') AS date_from,
        MAX(p.metadata->>'date_taken') AS date_to
      FROM photos p
      WHERE p.folder_id = s.id
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT p.id, ${PHOTO_LIKE} AS is_photo
      FROM photos p
      WHERE p.folder_id = s.id AND p.mime_type LIKE 'image/%'
      ORDER BY ${COVER_RANK}
      LIMIT 1
    ) own_cover ON true
    LEFT JOIN LATERAL (
      SELECT (
        SELECT p.id FROM photos p
        WHERE p.folder_id = d.id AND ${PHOTO_LIKE}
        ORDER BY ${COVER_RANK}
        LIMIT 1
      ) AS id
      FROM folders d
      WHERE own_cover.is_photo IS NOT TRUE
        AND d.path >= s.path || '/'
        AND d.path < s.path || '0'
        AND starts_with(d.path, s.path || '/')
        AND d.photo_count > 0
        AND EXISTS (
          SELECT 1 FROM photos p WHERE p.folder_id = d.id AND ${PHOTO_LIKE}
        )
      ORDER BY d.path
      LIMIT 1
    ) descendant_photo ON true
    LEFT JOIN LATERAL (
      SELECT (
        SELECT p.id FROM photos p
        WHERE p.folder_id = d.id AND p.mime_type LIKE 'image/%'
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
        AND EXISTS (
          SELECT 1 FROM photos p
          WHERE p.folder_id = d.id AND p.mime_type LIKE 'image/%'
        )
      ORDER BY d.path
      LIMIT 1
    ) descendant_image ON true
    ORDER BY ${orderBy}
  `;

  const result = await query<FolderListingRow>(sql, params);

  return result.rows.map((folder) => ({
    ...folder,
    thumbnails_generated: Boolean(folder.thumbnails_generated),
    cover_photo_id: folder.cover_photo_id ?? null,
    date_from: folder.date_from ?? null,
    date_to: folder.date_to ?? null,
    palette: folder.palette ?? undefined,
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

/** `AND <filter>` for a WHERE clause, or nothing. */
function andColorFilter(
  params: unknown[],
  filter: ColorFilter,
  photoId?: string,
): string {
  const sql = colorFilterSql(params, filter, photoId);
  return sql ? `AND ${sql}` : "";
}

// ---- photo filters --------------------------------------------------------

/** What a list of photos keeps: those showing all of `people`, taken within `dates`, holding `colors`. */
export interface PhotoFilter {
  people: readonly number[];
  dates: DateFilter;
  colors: ColorFilter;
}

export const NO_PHOTO_FILTER: PhotoFilter = {
  people: [],
  dates: ANY_DATE,
  colors: NO_COLOR_FILTER,
};

/**
 * AND clauses keeping the photos (id `photoId`) where every one of `people`
 * is (a face named as that person: seed, manual or auto; the partial unique
 * index idx_faces_person_once_per_photo serves each); ids go to `params`.
 */
function andPeopleFilter(
  params: unknown[],
  people: readonly number[],
  photoId = "p.id",
): string {
  return people
    .map((personId) => {
      params.push(personId);
      return `AND EXISTS (SELECT 1 FROM faces pf WHERE pf.photo_id = ${photoId}
        AND pf.person_id = $${params.length} AND pf.assignment IN ('seed', 'manual', 'auto'))`;
    })
    .join("\n");
}

/**
 * AND clauses keeping the photos (photos p) taken within `dates`, compared
 * as text with the ISO date_taken like the timeline and the map; the days
 * of the year are its "MM-DD". Nothing for any date.
 */
function andDateFilter(params: unknown[], dates: DateFilter): string {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}::text`;
  };
  const taken = "(p.metadata->>'date_taken')";
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
  return clauses.map((clause) => `AND (${clause})`).join("\n");
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
const DATED = "(p.metadata->>'date_taken') IS NOT NULL";

/**
 * Dated photos passing the color filter, most marked first (see
 * colorRank), keyset-paginated on (score, id); only those showing
 * `filter.people` and taken within `filter.dates` when given. The page is
 * picked on photo_colors through its index, then read in full.
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
  const narrow = [
    andDateFilter(params, filter.dates),
    andPeopleFilter(params, filter.people),
  ].join("\n");
  const result = await query<
    DatabasePhoto & { folder_path: string; color_score: number }
  >(
    `
    WITH page AS (
      SELECT pc.photo_id AS id, ${rank.score} AS score
      FROM photo_colors pc
      JOIN photos p ON p.id = pc.photo_id
      WHERE ${where.join("\n        AND ")}
        ${narrow}
      ORDER BY ${rank.score} ${rank.order}, pc.photo_id ${rank.order}
      LIMIT $1
    )
    SELECT p.*, f.path AS folder_path, page.score AS color_score
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
   * whose colors are measured, of all dated photos. Null once it is done.
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
 * dated photos (colorRank's order, spread across folders), and how far the
 * measuring has got. One indexed top-N per band (db/schema.sql); the
 * counts, two scans, only while the measuring goes on.
 */
export async function getColorOverview(
  perBand: number,
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
  // Band numbers, not keys, go into the SQL; the rank expressions are this file's.
  const tops = filters.map(([, , filter], band) => {
    const rank = colorRank(filter);
    if (!rank) throw new Error("A band needs a color or a tone");
    return `(SELECT ${band} AS band, pc.photo_id AS id, p.folder_id,
             pc.palette_hex[1] AS hex, p.metadata->'user_rotation' AS rotation,
             p.size::text || pc.palette_hex::text || pc.palette_share::text AS look,
             p.metadata->>'date_taken' AS taken
      FROM photo_colors pc
      JOIN photos p ON p.id = pc.photo_id
      WHERE ${[...rank.where, DATED].join(" AND ")}
      ORDER BY ${rank.score} ${rank.order}, pc.photo_id ${rank.order}
      LIMIT $1)`;
  });
  const [bands, coverage] = await Promise.all([
    query<{
      band: number;
      id: number;
      folder_id: string;
      hex: string | null;
      rotation: unknown;
      look: string;
      taken: string;
    }>(
      `SELECT band, id::int AS id, folder_id::text AS folder_id, hex, rotation, look, taken
       FROM (${tops.join("\nUNION ALL\n")}) t`,
      [perBand * BAND_CANDIDATES],
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
       WHERE ${DATED})::int AS measured,
      (SELECT COUNT(*) FROM photos p
       WHERE p.mime_type LIKE 'image/%' AND ${DATED})::int AS photos
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

/** A photo's measured colors; null until the worker has measured it. */
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
     FROM photo_colors WHERE photo_id = $1`,
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

/** Photos whose filename or folder path matches, as (id, folder_id, filename) */
const PHOTO_HITS = `hits AS (
  SELECT p.id, p.folder_id, p.filename FROM photos p
  WHERE p.folder_id IN (
    SELECT f.id FROM folders f WHERE ${containsSql("f.path", "$1")}
  )
  UNION
  SELECT p.id, p.folder_id, p.filename FROM photos p
  WHERE ${containsSql("p.filename", "$1")}
)`;

export type SearchPhoto = Photo & { folder_name: string; folder_path: string };

/**
 * Photos whose filename or folder path matches, folder by folder (path, then
 * filename); keyset-paginated on (folder path, filename, id); only those
 * passing the color filter when given. The page is picked on narrow rows
 * and only its photos are read in full.
 */
export async function searchPhotos(
  q: string,
  after: PhotoSearchCursor | null,
  limit: number,
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<SearchPage<SearchPhoto, PhotoSearchCursor>> {
  const params: unknown[] = [searchTerms(q).like, limit + 1];
  const where: string[] = [];
  if (after) {
    params.push(after.folderPath, after.filename, after.id);
    where.push("(f.path, h.filename, h.id) > ($3::text, $4::text, $5::bigint)");
  }
  const colorWhere = colorFilterSql(params, colors, "h.id");
  if (colorWhere) where.push(colorWhere);
  const result = await query<
    DatabasePhoto & { folder_name: string; folder_path: string }
  >(
    `WITH ${PHOTO_HITS},
     page AS (
       SELECT h.id, f.path, h.filename
       FROM hits h JOIN folders f ON f.id = h.folder_id
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY f.path, h.filename, h.id
       LIMIT $2
     )
     SELECT p.*, f.name AS folder_name, f.path AS folder_path
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
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<{ photos: number; folders: number }> {
  const params: unknown[] = [searchTerms(q).like];
  const colorWhere = colorFilterSql(params, colors, "h.id");
  const result = await query<{ photos: number; folders: number }>(
    `WITH ${PHOTO_HITS}
     SELECT
       (SELECT COUNT(*) FROM hits h
        ${colorWhere ? `WHERE ${colorWhere}` : ""})::int AS photos,
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
 * Photos nearest to the query embedding, most similar first, among those
 * passing `filter`; with `cut`, only down to SEMANTIC_MARGIN below the
 * SEMANTIC_REFERENCE_RANK-th one (never under SEMANTIC_MIN_SIMILARITY);
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
  const dated = andDateFilter(params, filter.dates);
  const narrow = [
    dated,
    andColorFilter(params, filter.colors, "e.photo_id"),
    andPeopleFilter(params, filter.people, "e.photo_id"),
  ].join("\n");
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
         ${dated === "" ? "" : "JOIN photos p ON p.id = e.photo_id"}
         WHERE e.model = $2
           ${narrow}
         ORDER BY e.embedding <=> $1::halfvec
         LIMIT $3
       )
       SELECT p.*, f.name AS folder_name, f.path AS folder_path, n.distance
       FROM nearest n
       JOIN photos p ON p.id = n.photo_id
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

export async function getLibrarySummary(): Promise<LibrarySummary> {
  // min/max read the ends of idx_photos_date_taken; the counts scan photos once
  const [media, folders, span] = await Promise.all([
    query<{ photos: number; videos: number }>(`
      SELECT
        COUNT(*) FILTER (WHERE mime_type LIKE 'image/%')::int AS photos,
        COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')::int AS videos
      FROM photos
    `),
    query<{ folders: number; albums: number }>(`
      SELECT COUNT(*)::int AS folders,
             COUNT(*) FILTER (WHERE photo_count > 0)::int AS albums
      FROM folders WHERE path <> ''
    `),
    query<{ first: string | null; last: string | null }>(`
      SELECT
        (SELECT metadata->>'date_taken' FROM photos
         WHERE (metadata->>'date_taken') IS NOT NULL
         ORDER BY (metadata->>'date_taken'), id LIMIT 1) AS first,
        (SELECT metadata->>'date_taken' FROM photos
         WHERE (metadata->>'date_taken') IS NOT NULL
         ORDER BY (metadata->>'date_taken') DESC, id DESC LIMIT 1) AS last
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

export async function getPhotosInFolder(folderId: number): Promise<Photo[]> {
  const result = await query<DatabasePhoto>(
    `
    SELECT * FROM photos
    WHERE folder_id = $1
    ORDER BY filename
  `,
    [folderId],
  );

  return result.rows.map(normalizePhoto);
}

/**
 * In a photo upsert: true when the incoming file differs from the stored one.
 * A sync that rewrote metadata for every unchanged file wiped the EXIF data of
 * 91k photos on 2026-10-18; only a replaced file may lose what was extracted.
 */
const FILE_CHANGED =
  "(photos.size IS DISTINCT FROM EXCLUDED.size OR photos.modified_at IS DISTINCT FROM EXCLUDED.modified_at)";

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
      metadata, metadata_status, thumbnail_status, last_synced
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
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
      SELECT id::int AS id, s3_key, size::float8 AS size, modified_at
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
      metadata_status, thumbnail_status, last_synced
    )
    SELECT n.*, CURRENT_TIMESTAMP
    FROM unnest(
      $1::bigint[], $2::text[], $3::text[], $4::bigint[], $5::text[],
      $6::timestamp[], $7::text[], $8::text[]
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
    ],
  );
  return result.rowCount ?? 0;
}

export interface ReplacedFile {
  id: number;
  size: number;
  modified_at: string;
  thumbnail_status: ThumbnailStatus;
}

/**
 * Records that these photos' files were replaced: what was extracted from the
 * old file (metadata, thumbnail) is dropped so it is read again from the new
 * one. Faces, colours and descriptions are not touched here.
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
      last_synced = CURRENT_TIMESTAMP
    FROM unnest($1::bigint[], $2::bigint[], $3::timestamp[], $4::text[])
      AS f(id, size, modified_at, thumbnail_status)
    WHERE p.id = f.id
  `,
    [
      files.map((f) => f.id),
      files.map((f) => f.size),
      files.map((f) => f.modified_at),
      files.map((f) => f.thumbnail_status),
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
 * Photos with a date_taken, newest first, keyset-paginated on (date_taken, id);
 * only those passing `filter` when given.
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
  const narrow = [
    andColorFilter(params, filter.colors),
    andDateFilter(params, filter.dates),
    andPeopleFilter(params, filter.people),
  ].join("\n");

  const result = await query<DatabasePhoto & { folder_path: string }>(
    `
    SELECT p.*, f.path AS folder_path
    FROM photos p
    JOIN folders f ON f.id = p.folder_id
    WHERE (p.metadata->>'date_taken') IS NOT NULL
      ${cursorFilter}
      ${narrow}
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
  months: { month: string; count: number }[];
  /** Every row of photos (images and videos), dated or not */
  total_photos: number;
}

/** Months as getTimelinePhotos pages through them, color filter included. */
export async function getTimelineSummary(
  colors: ColorFilter = NO_COLOR_FILTER,
  personId: number | null = null,
): Promise<TimelineSummary> {
  const params: unknown[] = [];
  const people = personId === null ? [] : [personId];
  const colorFilter = andColorFilter(params, colors);
  const personFilter = andPeopleFilter(params, people);
  const totalParams: unknown[] = [];
  const totalFilter = andPeopleFilter(totalParams, people);
  const [months, total] = await Promise.all([
    query<{ month: string; count: number }>(
      `
      SELECT substr(p.metadata->>'date_taken', 1, 7) AS month, COUNT(*)::int AS count
      FROM photos p
      WHERE (p.metadata->>'date_taken') IS NOT NULL
        ${colorFilter}
        ${personFilter}
      GROUP BY 1
      ORDER BY 1 DESC
    `,
      params,
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM photos p WHERE true ${totalFilter}`,
      totalParams,
    ),
  ]);
  return { months: months.rows, total_photos: requireRow(total).total };
}

// On the map: a GPS fix (imageProbe only writes finite numbers, never 0,0)
// and a date taken, which the period and the newest-first order need.
const ON_MAP = `(p.metadata->'location') IS NOT NULL
  AND (p.metadata->>'date_taken') IS NOT NULL`;
const LATITUDE = `((p.metadata->'location'->>'latitude')::float8)`;
const LONGITUDE = `((p.metadata->'location'->>'longitude')::float8)`;

/**
 * WHERE clause for photos on the map, within the period, the box and the
 * color filter when given; values go to `params`. Months and days compare
 * as text against the ISO date_taken, like the timeline's months, so
 * idx_photos_date_taken serves them: `to` stops before the day after it.
 */
function mapFilter(
  params: unknown[],
  period: MapPeriod,
  box: MapBox | null,
  colors: ColorFilter,
): string {
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [ON_MAP];
  if (period.from)
    where.push(`(p.metadata->>'date_taken') >= ${add(period.from)}::text`);
  if (period.to)
    where.push(
      `(p.metadata->>'date_taken') < ${add(addDays(lastDay(period.to), 1))}::text`,
    );
  if (box) {
    where.push(
      `${LATITUDE} BETWEEN ${add(box.south)}::float8 AND ${add(box.north)}::float8`,
      `${LONGITUDE} BETWEEN ${add(box.west)}::float8 AND ${add(box.east)}::float8`,
    );
  }
  const colorWhere = colorFilterSql(params, colors);
  if (colorWhere) where.push(colorWhere);
  return where.join("\n  AND ");
}

/**
 * Photos per map cell as [latitude, longitude, count], placed at the mean
 * position of the cell's photos (4 decimals, about 10 m): circles land
 * where the photos were taken instead of on a grid.
 */
export async function getMapPoints(
  period: MapPeriod,
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<[number, number, number][]> {
  const params: unknown[] = [CELLS_PER_DEGREE];
  const result = await query<{ lat: number; lng: number; count: number }>(
    `
    SELECT round(AVG(${LATITUDE})::numeric, 4)::float8 AS lat,
           round(AVG(${LONGITUDE})::numeric, 4)::float8 AS lng,
           COUNT(*)::int AS count
    FROM photos p
    WHERE ${mapFilter(params, period, null, colors)}
    GROUP BY round(${LATITUDE} * $1), round(${LONGITUDE} * $1)
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
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<{
  unit: "day" | "month";
  dates: { date: string; count: number }[];
}> {
  const params: unknown[] = [DAY_SPAN];
  const result = await query<{ date: string; count: number }>(
    `
    WITH days AS (
      SELECT substr(p.metadata->>'date_taken', 1, 10) AS day, COUNT(*)::int AS count
      FROM photos p
      WHERE ${mapFilter(params, { from: null, to: null }, box, colors)}
      GROUP BY 1
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
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<TimelinePhoto[]> {
  const params: unknown[] = [limit];
  const where = mapFilter(params, period, box, colors);
  let seek = "";
  if (after) {
    params.push(after.dateTaken, after.id);
    seek = `AND ((p.metadata->>'date_taken'), p.id) < ($${params.length - 1}::text, $${params.length}::bigint)`;
  }
  const result = await query<DatabasePhoto & { folder_path: string }>(
    `
    WITH page AS (
      SELECT p.id, (p.metadata->>'date_taken') AS taken
      FROM photos p
      WHERE ${where}
        ${seek}
      ORDER BY (p.metadata->>'date_taken') DESC, p.id DESC
      LIMIT $1
    )
    SELECT p.*, f.path AS folder_path
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
  colors: ColorFilter = NO_COLOR_FILTER,
): Promise<number> {
  const params: unknown[] = [];
  const result = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM photos p WHERE ${mapFilter(params, period, box, colors)}`,
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

export async function deletePhoto(photoId: number): Promise<boolean> {
  const result = await query("DELETE FROM photos WHERE id = $1 RETURNING id", [
    photoId,
  ]);
  return result.rowCount !== null && result.rowCount > 0;
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
