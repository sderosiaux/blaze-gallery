import { Pool, PoolClient, QueryResult } from "pg";
import { Folder, Photo, Config, PhotoMetadata } from "@/types";
import * as crypto from "crypto";
import {
  CreatePhotoData,
  CreateFolderData,
  CreateSyncJobData,
  UpdatePhotoStatus,
  SyncJobType,
  SyncJobStatus,
  MetadataStatus,
  ThumbnailStatus,
} from "@/types/common";
import * as path from "path";

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
  metadata: any | null; // JSONB in PostgreSQL
  metadata_status: MetadataStatus;
  thumbnail_status: ThumbnailStatus;
  is_favorite: boolean; // PostgreSQL native boolean
  last_synced?: string;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: Pool | null = null;
  private isInitialized = false;

  private constructor() {
    // PostgreSQL connection will be initialized with environment variables or connection string
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getPool(): Pool {
    if (!this.pool) {
      this.initialize();
    }
    return this.pool!;
  }

  private initialize(): void {
    if (this.isInitialized) return;

    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is required for PostgreSQL connection",
      );
    }

    this.pool = new Pool({
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
    this.pool.on("error", (err) => {
      console.error("[Database Pool] Unexpected error on idle client:", err);
    });

    // Only log connection events, not every acquisition
    this.pool.on("connect", (client) => {
      console.log(
        "[Database Pool] New client connected, total:",
        this.pool?.totalCount || 0,
      );
    });

    this.pool.on("remove", (client) => {
      console.log(
        "[Database Pool] Client removed, total:",
        this.pool?.totalCount || 0,
      );
    });

    // Log pool stats periodically during development
    if (process.env.NODE_ENV === "development") {
      setInterval(() => {
        if (this.pool) {
          const stats = {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount,
          };
          // Only log if there's activity or issues
          if (stats.waiting > 0 || stats.total > 10) {
            console.log("[Database Pool Stats]", stats);
          }
        }
      }, 30000); // Every 30 seconds
    }

    this.isInitialized = true;
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
      this.isInitialized = false;
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
export async function query(
  text: string,
  params?: any[],
): Promise<QueryResult> {
  const pool = getPool();
  return pool.query(text, params);
}

// PostgreSQL schema is already created via Neon migration
// This function is no longer needed but kept for reference
function initializeDatabase() {
  // Schema is already created in Neon PostgreSQL
  // Tables: folders, photos, sync_jobs, shared_folders, share_access_logs
  // All indexes and constraints are already in place
  console.log("PostgreSQL schema already exists in Neon database");
}

// PostgreSQL migrations are handled via Neon
// Schema version tracking not needed as schema is already deployed
function runMigrations() {
  console.log("PostgreSQL migrations handled via Neon deployment");
}

export async function getFolders(parentPath?: string): Promise<Folder[]> {
  let sql: string;
  let params: any[];

  if (parentPath === undefined || parentPath === "") {
    sql = `
      SELECT
        f.*,
        CASE
          WHEN f.photo_count = 0 THEN false
          WHEN COUNT(CASE WHEN p.thumbnail_status = 'generated' THEN 1 END) = f.photo_count THEN true
          ELSE false
        END as thumbnails_generated,
        COALESCE(SUM(p.size), 0) as total_size,
        MIN(p.modified_at) as folder_created_at
      FROM folders f
      LEFT JOIN photos p ON p.folder_id = f.id
      WHERE f.parent_id IS NULL
      GROUP BY f.id
      ORDER BY f.name
    `;
    params = [];
  } else {
    sql = `
      SELECT
        f.*,
        CASE
          WHEN f.photo_count = 0 THEN false
          WHEN COUNT(CASE WHEN p.thumbnail_status = 'generated' THEN 1 END) = f.photo_count THEN true
          ELSE false
        END as thumbnails_generated,
        COALESCE(SUM(p.size), 0) as total_size,
        MIN(p.modified_at) as folder_created_at
      FROM folders f
      INNER JOIN folders parent ON f.parent_id = parent.id
      LEFT JOIN photos p ON p.folder_id = f.id
      WHERE parent.path = $1
      GROUP BY f.id
      ORDER BY f.name
    `;
    params = [parentPath];
  }

  const result = await query(sql, params);
  const folders = result.rows;

  return folders.map((folder) => ({
    ...folder,
    thumbnails_generated: Boolean(folder.thumbnails_generated),
  })) as Folder[];
}

export async function getFolderByPath(path: string): Promise<Folder | null> {
  const result = await query("SELECT * FROM folders WHERE path = $1", [path]);
  return result.rows[0] || null;
}

export async function createOrUpdateFolder(
  folderData: CreateFolderData,
): Promise<Folder> {
  const result = await query(
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

  return result.rows[0] as Folder;
}

export async function getPhotosInFolder(folderId: number): Promise<Photo[]> {
  const result = await query(
    `
    SELECT * FROM photos
    WHERE folder_id = $1
    ORDER BY filename
  `,
    [folderId],
  );

  const photos = result.rows as DatabasePhoto[];

  return photos.map(
    (photo) =>
      ({
        ...photo,
        is_favorite: Boolean(photo.is_favorite),
        thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
        metadata: photo.metadata, // PostgreSQL JSONB is already parsed
      }) as Photo,
  );
}

export async function createOrUpdatePhoto(
  photoData: CreatePhotoData,
): Promise<Photo> {
  const metadataStatus =
    photoData.metadata_status || (photoData.metadata ? "extracted" : "none");
  const thumbnailStatus = photoData.thumbnail_status || "none";

  const result = await query(
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

  const photo = result.rows[0] as DatabasePhoto;

  return {
    ...photo,
    is_favorite: Boolean(photo.is_favorite),
    thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
    metadata: photo.metadata, // PostgreSQL JSONB is already parsed
  } as Photo;
}

// Bulk operations for sync performance
export async function bulkCreateOrUpdatePhotos(
  photosData: CreatePhotoData[],
): Promise<Photo[]> {
  if (photosData.length === 0) return [];

  return runTransaction(async (client) => {
    // Prepare data for bulk insert
    const values: any[] = [];
    const placeholders: string[] = [];

    photosData.forEach((photoData, index) => {
      const metadataStatus =
        photoData.metadata_status ||
        (photoData.metadata ? "extracted" : "none");
      const thumbnailStatus = photoData.thumbnail_status || "none";

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
    const result = await client.query(
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
    return result.rows.map((photo: DatabasePhoto) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata,
    })) as Photo[];
  });
}

export async function bulkCreateOrUpdateFolders(
  foldersData: CreateFolderData[],
): Promise<Folder[]> {
  if (foldersData.length === 0) return [];

  return runTransaction(async (client) => {
    // Prepare data for bulk insert
    const values: any[] = [];
    const placeholders: string[] = [];

    foldersData.forEach((folderData, index) => {
      const baseIndex = index * 3;
      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, CURRENT_TIMESTAMP)`,
      );

      values.push(folderData.path, folderData.name, folderData.parent_id);
    });

    // Execute single bulk INSERT with ON CONFLICT
    const result = await client.query(
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

    return result.rows as Folder[];
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

export async function updatePhotoStatus(
  photoId: number,
  status: UpdatePhotoStatus,
): Promise<void> {
  const updates: string[] = [];
  const values: any[] = [];
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
  const result = await query("SELECT * FROM photos WHERE id = $1", [photoId]);
  const photo = result.rows[0] as DatabasePhoto | undefined;

  if (!photo) return null;

  return {
    ...photo,
    is_favorite: Boolean(photo.is_favorite),
    thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
    metadata: photo.metadata, // PostgreSQL JSONB is already parsed
  } as Photo;
}

export async function createSyncJob(
  jobData: CreateSyncJobData,
): Promise<SyncJob> {
  const result = await query(
    `
    INSERT INTO sync_jobs (type, folder_path, status, processed_items, total_items)
    VALUES ($1, $2, 'pending', 0, 0)
    RETURNING *
  `,
    [jobData.type, jobData.folder_path],
  );

  return result.rows[0] as SyncJob;
}

export async function updateSyncJob(
  jobId: number,
  updates: Partial<SyncJob>,
): Promise<void> {
  const fields = Object.keys(updates)
    .map((key, index) => `${key} = $${index + 1}`)
    .join(", ");
  const values = [...Object.values(updates), jobId];

  await query(
    `UPDATE sync_jobs SET ${fields} WHERE id = $${values.length}`,
    values,
  );
}

export async function getSyncJob(jobId: number): Promise<SyncJob | null> {
  const result = await query("SELECT * FROM sync_jobs WHERE id = $1", [jobId]);
  return result.rows[0] || null;
}

export async function getActiveSyncJobs(): Promise<SyncJob[]> {
  const result = await query(`
    SELECT * FROM sync_jobs
    WHERE status IN ('pending', 'running')
    ORDER BY id ASC
  `);

  return result.rows as SyncJob[];
}

export async function updateFolderCounts(folderId: number): Promise<void> {
  const photoCountResult = await query(
    "SELECT COUNT(*) as count FROM photos WHERE folder_id = $1",
    [folderId],
  );
  const subfolderCountResult = await query(
    "SELECT COUNT(*) as count FROM folders WHERE parent_id = $1",
    [folderId],
  );

  const photoCount = photoCountResult.rows[0].count;
  const subfolderCount = subfolderCountResult.rows[0].count;

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
  delta: number = 1,
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
  delta: number = 1,
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
  const selectResult = await query(
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
  // Hash password if provided
  let passwordHash = null;
  if (shareData.password) {
    const bcrypt = require("bcrypt");
    passwordHash = await bcrypt.hash(shareData.password, 12);
  }

  // Get folder ID if not provided
  let folderId = shareData.folder_id;
  if (!folderId && shareData.folder_path) {
    const folder = await getFolderByPath(shareData.folder_path);
    folderId = folder?.id || undefined;
  }

  const result = await query(
    `
    INSERT INTO shared_folders (
      folder_path, folder_id, password_hash,
      expires_at, description, allow_download
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `,
    [
      shareData.folder_path,
      folderId,
      passwordHash,
      shareData.expires_at || null,
      shareData.description || null,
      shareData.allow_download !== false,
    ],
  );

  const share = result.rows[0] as SharedFolder;

  return {
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active),
  };
}

export async function getSharedFolder(
  shareToken: string,
): Promise<SharedFolder | null> {
  const result = await query(
    `
    SELECT * FROM shared_folders
    WHERE share_token = $1 AND is_active = true
  `,
    [shareToken],
  );

  const share = result.rows[0] as SharedFolder | undefined;

  if (!share) return null;

  // Check if share has expired
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }

  return {
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active),
  };
}

export async function validateSharePassword(
  shareToken: string,
  password: string,
): Promise<boolean> {
  const result = await query(
    `
    SELECT password_hash FROM shared_folders
    WHERE share_token = $1 AND is_active = true
  `,
    [shareToken],
  );

  const shareData = result.rows[0] as
    | { password_hash: string | null }
    | undefined;

  if (!shareData || !shareData.password_hash) {
    return true; // No password required
  }

  const bcrypt = require("bcrypt");
  return await bcrypt.compare(password, shareData.password_hash);
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
      share_id, ip_address, user_agent, access_type, success
    )
    VALUES ($1, $2, $3, $4, $5)
  `,
    [
      shareId,
      accessData.ip_address || null,
      accessData.user_agent || null,
      accessData.access_type,
      accessData.success !== false,
    ],
  );
}

export async function getAllSharedFolders(): Promise<SharedFolder[]> {
  const result = await query(`
    SELECT sf.*, f.name as folder_name
    FROM shared_folders sf
    LEFT JOIN folders f ON sf.folder_id = f.id
    ORDER BY sf.created_at DESC
  `);

  const shares = result.rows as (SharedFolder & { folder_name: string })[];

  return shares.map((share) => ({
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active),
  }));
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

  return result.rowCount || 0;
}

export async function getShareAccessLogs(
  shareId: number,
  limit: number = 100,
): Promise<ShareAccessLog[]> {
  const result = await query(
    `
    SELECT * FROM share_access_logs
    WHERE share_id = $1
    ORDER BY accessed_at DESC
    LIMIT $2
  `,
    [shareId, limit],
  );

  const logs = result.rows as ShareAccessLog[];

  return logs.map((log) => ({
    ...log,
    success: Boolean(log.success),
  }));
}
