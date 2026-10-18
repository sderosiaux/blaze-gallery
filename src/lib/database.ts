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
  "thumbnails_generated" | "cover_photo_id" | "date_from" | "date_to"
> & {
  thumbnails_generated: boolean | null;
  cover_photo_id: number | null | undefined;
  date_from: string | null | undefined;
  date_to: string | null | undefined;
};

/**
 * Adds listing fields (thumbnail state, size, date span, cover) to the
 * folders selected by `baseSql`, which must select `f.*` from `folders f`.
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
       END)::int AS cover_photo_id
    FROM sub s
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
  }));
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
 * filename); keyset-paginated on (folder path, filename, id). The page is
 * picked on narrow rows and only its photos are read in full.
 */
export async function searchPhotos(
  q: string,
  after: PhotoSearchCursor | null,
  limit: number,
): Promise<SearchPage<SearchPhoto, PhotoSearchCursor>> {
  const params: unknown[] = [searchTerms(q).like, limit + 1];
  let seek = "";
  if (after) {
    params.push(after.folderPath, after.filename, after.id);
    seek =
      "WHERE (f.path, h.filename, h.id) > ($3::text, $4::text, $5::bigint)";
  }
  const result = await query<
    DatabasePhoto & { folder_name: string; folder_path: string }
  >(
    `WITH ${PHOTO_HITS},
     page AS (
       SELECT h.id, f.path, h.filename
       FROM hits h JOIN folders f ON f.id = h.folder_id
       ${seek}
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
): Promise<{ photos: number; folders: number }> {
  const result = await query<{ photos: number; folders: number }>(
    `WITH ${PHOTO_HITS}
     SELECT
       (SELECT COUNT(*) FROM hits)::int AS photos,
       (SELECT COUNT(*) FROM folders f
        WHERE ${containsSql("f.path", "$1")} AND ${HAS_CONTENT})::int AS folders`,
    [searchTerms(q).like],
  );
  return requireRow(result, "Search count");
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
      metadata = EXCLUDED.metadata,
      metadata_status = EXCLUDED.metadata_status,
      thumbnail_status = EXCLUDED.thumbnail_status,
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

// Bulk operations for sync performance
export async function bulkCreateOrUpdatePhotos(
  photosData: CreatePhotoData[],
): Promise<Photo[]> {
  if (photosData.length === 0) return [];

  return runTransaction(async (client) => {
    // Prepare data for bulk insert
    const values: unknown[] = [];
    const placeholders: string[] = [];

    photosData.forEach((photoData, index) => {
      const metadataStatus =
        photoData.metadata_status ??
        (photoData.metadata ? "extracted" : "none");
      const thumbnailStatus = photoData.thumbnail_status ?? "none";

      const baseIndex = index * 9;
      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, CURRENT_TIMESTAMP)`,
      );

      values.push(
        photoData.folder_id,
        photoData.filename,
        photoData.s3_key,
        photoData.size,
        photoData.mime_type,
        photoData.modified_at,
        photoData.metadata,
        metadataStatus,
        thumbnailStatus,
      );
    });

    // Execute single bulk INSERT with ON CONFLICT
    const result = await client.query<DatabasePhoto>(
      `
      INSERT INTO photos (
        folder_id, filename, s3_key, size, mime_type, modified_at,
        metadata, metadata_status, thumbnail_status, last_synced
      )
      VALUES ${placeholders.join(", ")}
      ON CONFLICT(s3_key) DO UPDATE SET
        folder_id = EXCLUDED.folder_id,
        filename = EXCLUDED.filename,
        size = EXCLUDED.size,
        mime_type = EXCLUDED.mime_type,
        modified_at = EXCLUDED.modified_at,
        metadata = EXCLUDED.metadata,
        metadata_status = EXCLUDED.metadata_status,
        thumbnail_status = EXCLUDED.thumbnail_status,
        last_synced = CURRENT_TIMESTAMP
      RETURNING *
    `,
      values,
    );

    // Convert results to Photo objects
    return result.rows.map(normalizePhoto);
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
 * Photos with a date_taken, newest first, keyset-paginated on (date_taken, id).
 * Uses idx_photos_date_taken (db/schema.sql).
 */
export async function getTimelinePhotos(
  before: TimelineCursor | null,
  limit: number,
): Promise<TimelinePhoto[]> {
  const params: unknown[] = [limit];
  let cursorFilter = "";
  if (before) {
    params.push(before.dateTaken, before.id);
    // Row comparison so the btree on (date_taken, id) serves the seek
    cursorFilter = `AND ((p.metadata->>'date_taken'), p.id) < ($2::text, $3::bigint)`;
  }

  const result = await query<DatabasePhoto & { folder_path: string }>(
    `
    SELECT p.*, f.path AS folder_path
    FROM photos p
    JOIN folders f ON f.id = p.folder_id
    WHERE (p.metadata->>'date_taken') IS NOT NULL
      ${cursorFilter}
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

export async function getTimelineSummary(): Promise<TimelineSummary> {
  const [months, total] = await Promise.all([
    query<{ month: string; count: number }>(`
      SELECT substr(p.metadata->>'date_taken', 1, 7) AS month, COUNT(*)::int AS count
      FROM photos p
      WHERE (p.metadata->>'date_taken') IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
    `),
    query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM photos`),
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
 * WHERE clause for photos on the map, within the period and the box when
 * given; values go to `params`. Months and days compare as text against the
 * ISO date_taken, like the timeline's months, so idx_photos_date_taken serves
 * them: `to` stops before the day after it.
 */
function mapFilter(
  params: unknown[],
  period: MapPeriod,
  box: MapBox | null,
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
  return where.join("\n  AND ");
}

/**
 * Photos per map cell as [latitude, longitude, count], placed at the mean
 * position of the cell's photos (4 decimals, about 10 m): circles land
 * where the photos were taken instead of on a grid.
 */
export async function getMapPoints(
  period: MapPeriod,
): Promise<[number, number, number][]> {
  const params: unknown[] = [CELLS_PER_DEGREE];
  const result = await query<{ lat: number; lng: number; count: number }>(
    `
    SELECT round(AVG(${LATITUDE})::numeric, 4)::float8 AS lat,
           round(AVG(${LONGITUDE})::numeric, 4)::float8 AS lng,
           COUNT(*)::int AS count
    FROM photos p
    WHERE ${mapFilter(params, period, null)}
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
export async function getMapDates(box: MapBox | null): Promise<{
  unit: "day" | "month";
  dates: { date: string; count: number }[];
}> {
  const params: unknown[] = [DAY_SPAN];
  const result = await query<{ date: string; count: number }>(
    `
    WITH days AS (
      SELECT substr(p.metadata->>'date_taken', 1, 10) AS day, COUNT(*)::int AS count
      FROM photos p
      WHERE ${mapFilter(params, { from: null, to: null }, box)}
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
): Promise<TimelinePhoto[]> {
  const params: unknown[] = [limit];
  const where = mapFilter(params, period, box);
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
): Promise<number> {
  const params: unknown[] = [];
  const result = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM photos p WHERE ${mapFilter(params, period, box)}`,
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

// Bulk update folder last synced for sync operations
export async function bulkUpdateFoldersLastSynced(
  folderIds: number[],
): Promise<void> {
  if (folderIds.length === 0) return;

  await query(
    `
      UPDATE folders
      SET last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1::int[])
    `,
    [folderIds],
  );
}

// Bulk folder count updates for sync operations
export async function bulkUpdateFolderCounts(
  folderIds: number[],
): Promise<void> {
  if (folderIds.length === 0) return;

  return runTransaction(async (client) => {
    // Single query to update all folder counts at once using CTEs
    await client.query(
      `
      WITH photo_counts AS (
        SELECT folder_id, COUNT(*) as photo_count
        FROM photos
        WHERE folder_id = ANY($1::int[])
        GROUP BY folder_id
      ),
      subfolder_counts AS (
        SELECT parent_id, COUNT(*) as subfolder_count
        FROM folders
        WHERE parent_id = ANY($1::int[])
        GROUP BY parent_id
      )
      UPDATE folders SET
        photo_count = COALESCE(pc.photo_count, 0),
        subfolder_count = COALESCE(sc.subfolder_count, 0),
        updated_at = CURRENT_TIMESTAMP
      FROM photo_counts pc
      FULL OUTER JOIN subfolder_counts sc ON pc.folder_id = sc.parent_id
      WHERE folders.id = ANY($1::int[])
        AND (folders.id = pc.folder_id OR folders.id = sc.parent_id)
    `,
      [folderIds],
    );
  });
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
