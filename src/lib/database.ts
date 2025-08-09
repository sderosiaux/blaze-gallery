import Database from "better-sqlite3";
import { Folder, Photo, Config, PhotoMetadata } from "@/types";
import crypto from "crypto";
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
import path from "path";

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
  metadata: string | null; // JSON string in database
  metadata_status: MetadataStatus;
  thumbnail_status: ThumbnailStatus;
  is_favorite: number; // SQLite boolean as number
  last_synced?: string;
}

class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database.Database | null = null;
  private dbPath: string;
  private isInitialized = false;

  private constructor() {
    this.dbPath =
      process.env.DATABASE_PATH ||
      path.join(process.cwd(), "data", "database", "gallery.db");
  }

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  getDatabase(): Database.Database {
    if (!this.db) {
      this.initialize();
    }
    return this.db!;
  }

  private initialize(): void {
    if (this.isInitialized) return;

    const dbDir = path.dirname(this.dbPath);
    const fs = require("fs");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Optimize SQLite settings for performance
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = 10000");
    this.db.pragma("temp_store = MEMORY");
    this.db.pragma("mmap_size = 268435456"); // 256MB

    initializeDatabase(this.db);
    this.isInitialized = true;
  }

  // Transaction wrapper for bulk operations
  transaction<T>(fn: (db: Database.Database) => T): T {
    const db = this.getDatabase();
    const transaction = db.transaction(fn);
    return transaction(db);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}

export function getDatabase(): Database.Database {
  return DatabaseManager.getInstance().getDatabase();
}

export function runTransaction<T>(fn: (db: Database.Database) => T): T {
  return DatabaseManager.getInstance().transaction(fn);
}

function initializeDatabase(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_synced DATETIME,
      last_visited DATETIME,
      photo_count INTEGER DEFAULT 0,
      subfolder_count INTEGER DEFAULT 0,
      FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      s3_key TEXT UNIQUE NOT NULL,
      size INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      modified_at DATETIME NOT NULL,
      thumbnail_path TEXT,
      metadata TEXT,
      metadata_status TEXT NOT NULL DEFAULT 'none' CHECK (metadata_status IN ('none', 'pending', 'extracted', 'skipped_size')),
      thumbnail_status TEXT NOT NULL DEFAULT 'none' CHECK (thumbnail_status IN ('none', 'pending', 'generated', 'skipped_size')),
      is_favorite BOOLEAN DEFAULT 0,
      last_synced DATETIME,
      FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('full_scan', 'folder_scan', 'metadata_scan', 'cleanup')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      folder_path TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      error_message TEXT,
      processed_items INTEGER DEFAULT 0,
      total_items INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Basic indexes
    CREATE INDEX IF NOT EXISTS idx_folders_path ON folders (path);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id);
    CREATE INDEX IF NOT EXISTS idx_photos_folder_id ON photos (folder_id);
    CREATE INDEX IF NOT EXISTS idx_photos_s3_key ON photos (s3_key);
    CREATE INDEX IF NOT EXISTS idx_photos_modified_at ON photos (modified_at);
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs (status);
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_type ON sync_jobs (type);
    
    -- Composite indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_photos_folder_status ON photos (folder_id, metadata_status, thumbnail_status);
    CREATE INDEX IF NOT EXISTS idx_photos_size_status ON photos (size, metadata_status);
    CREATE INDEX IF NOT EXISTS idx_photos_folder_modified ON photos (folder_id, modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_type ON sync_jobs (status, type);
    CREATE INDEX IF NOT EXISTS idx_folders_parent_updated ON folders (parent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_status_size ON photos (metadata_status, size);
    CREATE INDEX IF NOT EXISTS idx_photos_thumbnail_status ON photos (thumbnail_status, size);
    
    -- Search performance indexes
    CREATE INDEX IF NOT EXISTS idx_photos_filename_search ON photos (filename COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_folders_name_search ON folders (name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_folders_path_search ON folders (path COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_photos_favorite_search ON photos (is_favorite, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_folder_thumbnail ON photos (folder_id, thumbnail_status);
  `);

  // Run migrations for existing databases
  runMigrations(database);
}

function runMigrations(database: Database.Database) {
  // Get current schema version
  let schemaVersion = 0;
  try {
    const result = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    schemaVersion = result.user_version;
  } catch {
    // First installation, schema version is 0
  }

  // Migration 1: Add status columns to photos table
  if (schemaVersion < 1) {
    try {
      database.exec(`
        ALTER TABLE photos ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'none' 
        CHECK (metadata_status IN ('none', 'pending', 'extracted', 'skipped_size'));
        
        ALTER TABLE photos ADD COLUMN thumbnail_status TEXT NOT NULL DEFAULT 'none' 
        CHECK (thumbnail_status IN ('none', 'pending', 'generated', 'skipped_size'));
      `);

      // Update existing photos based on current state
      database.exec(`
        UPDATE photos SET 
          metadata_status = CASE WHEN metadata IS NOT NULL THEN 'extracted' ELSE 'none' END,
          thumbnail_status = CASE WHEN thumbnail_path IS NOT NULL THEN 'generated' ELSE 'none' END;
      `);

      database.pragma("user_version = 1");
    } catch (error) {
      // Columns might already exist, continue
    }
  }

  // Migration 2: Add folder sharing tables
  if (schemaVersion < 2) {
    try {
      database.exec(`
        CREATE TABLE IF NOT EXISTS shared_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_path TEXT NOT NULL,
          folder_id INTEGER,
          share_token TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          expires_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          description TEXT,
          view_count INTEGER DEFAULT 0,
          last_accessed DATETIME,
          allow_download BOOLEAN DEFAULT 1,
          is_active BOOLEAN DEFAULT 1,
          created_by TEXT DEFAULT 'admin',
          FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS share_access_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          share_id INTEGER NOT NULL,
          ip_address TEXT,
          user_agent TEXT,
          access_type TEXT NOT NULL DEFAULT 'view' CHECK (access_type IN ('view', 'download', 'password_attempt')),
          accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          success BOOLEAN DEFAULT 1,
          FOREIGN KEY (share_id) REFERENCES shared_folders (id) ON DELETE CASCADE
        );

        -- Indexes for sharing performance
        CREATE INDEX IF NOT EXISTS idx_shared_folders_token ON shared_folders (share_token);
        CREATE INDEX IF NOT EXISTS idx_shared_folders_folder_path ON shared_folders (folder_path);
        CREATE INDEX IF NOT EXISTS idx_shared_folders_active_expires ON shared_folders (is_active, expires_at);
        CREATE INDEX IF NOT EXISTS idx_share_access_logs_share_id ON share_access_logs (share_id, accessed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_share_access_logs_ip ON share_access_logs (ip_address, accessed_at DESC);
      `);

      database.pragma("user_version = 2");
    } catch (error) {
      console.error('Failed to create sharing tables:', error);
    }
  }
}

export async function getFolders(parentPath?: string): Promise<Folder[]> {
  const database = getDatabase();

  let query: string;
  let params: any[];

  if (parentPath === undefined || parentPath === "") {
    query = `
      SELECT 
        f.*,
        CASE 
          WHEN f.photo_count = 0 THEN 0
          WHEN COUNT(CASE WHEN p.thumbnail_status = 'completed' THEN 1 END) = f.photo_count THEN 1
          ELSE 0
        END as thumbnails_generated,
        COALESCE(SUM(p.size), 0) as total_size,
        MIN(p.modified_at) as folder_created_at
      FROM folders f
      LEFT JOIN photos p ON p.folder_id = f.id
      WHERE f.parent_id IS NULL 
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE
    `;
    params = [];
  } else {
    query = `
      SELECT 
        f.*,
        CASE 
          WHEN f.photo_count = 0 THEN 0
          WHEN COUNT(CASE WHEN p.thumbnail_status = 'completed' THEN 1 END) = f.photo_count THEN 1
          ELSE 0
        END as thumbnails_generated,
        COALESCE(SUM(p.size), 0) as total_size,
        MIN(p.modified_at) as folder_created_at
      FROM folders f
      INNER JOIN folders parent ON f.parent_id = parent.id
      LEFT JOIN photos p ON p.folder_id = f.id
      WHERE parent.path = ?
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE
    `;
    params = [parentPath];
  }

  const stmt = database.prepare(query);
  const folders = stmt.all(params) as any[];

  // Convert thumbnails_generated from 0/1 to boolean
  return folders.map((folder) => ({
    ...folder,
    thumbnails_generated: Boolean(folder.thumbnails_generated),
  })) as Folder[];
}

export async function getFolderByPath(path: string): Promise<Folder | null> {
  const database = getDatabase();
  const stmt = database.prepare("SELECT * FROM folders WHERE path = ?");
  const result = stmt.get(path) as Folder | undefined;
  return result || null;
}

export async function createOrUpdateFolder(
  folderData: CreateFolderData,
): Promise<Folder> {
  const database = getDatabase();

  const updateStmt = database.prepare(`
    INSERT INTO folders (path, name, parent_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      parent_id = excluded.parent_id,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);

  return updateStmt.get(
    folderData.path,
    folderData.name,
    folderData.parent_id,
  ) as Folder;
}

export async function getPhotosInFolder(folderId: number): Promise<Photo[]> {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT * FROM photos 
    WHERE folder_id = ? 
    ORDER BY filename COLLATE NOCASE
  `);

  const photos = stmt.all(folderId) as DatabasePhoto[];

  return photos.map(
    (photo) =>
      ({
        ...photo,
        is_favorite: Boolean(photo.is_favorite),
        thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
        metadata: photo.metadata ? JSON.parse(photo.metadata) : undefined,
      }) as Photo,
  );
}

export async function createOrUpdatePhoto(
  photoData: CreatePhotoData,
): Promise<Photo> {
  const database = getDatabase();

  const metadataJson = photoData.metadata
    ? JSON.stringify(photoData.metadata)
    : null;
  const metadataStatus =
    photoData.metadata_status || (photoData.metadata ? "extracted" : "none");
  const thumbnailStatus = photoData.thumbnail_status || "none";

  const updateStmt = database.prepare(`
    INSERT INTO photos (
      folder_id, filename, s3_key, size, mime_type, modified_at, 
      metadata, metadata_status, thumbnail_status, last_synced
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(s3_key) DO UPDATE SET
      folder_id = excluded.folder_id,
      filename = excluded.filename,
      size = excluded.size,
      mime_type = excluded.mime_type,
      modified_at = excluded.modified_at,
      metadata = excluded.metadata,
      metadata_status = excluded.metadata_status,
      thumbnail_status = excluded.thumbnail_status,
      last_synced = CURRENT_TIMESTAMP
    RETURNING *
  `);

  const photo = updateStmt.get(
    photoData.folder_id,
    photoData.filename,
    photoData.s3_key,
    photoData.size,
    photoData.mime_type,
    photoData.modified_at,
    metadataJson,
    metadataStatus,
    thumbnailStatus,
  ) as DatabasePhoto;

  return {
    ...photo,
    is_favorite: Boolean(photo.is_favorite),
    thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
    metadata: photo.metadata ? JSON.parse(photo.metadata) : undefined,
  } as Photo;
}

// Bulk operations for sync performance
export async function bulkCreateOrUpdatePhotos(
  photosData: CreatePhotoData[],
): Promise<Photo[]> {
  return runTransaction((db) => {
    const updateStmt = db.prepare(`
      INSERT INTO photos (
        folder_id, filename, s3_key, size, mime_type, modified_at, 
        metadata, metadata_status, thumbnail_status, last_synced
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(s3_key) DO UPDATE SET
        folder_id = excluded.folder_id,
        filename = excluded.filename,
        size = excluded.size,
        mime_type = excluded.mime_type,
        modified_at = excluded.modified_at,
        metadata = excluded.metadata,
        metadata_status = excluded.metadata_status,
        thumbnail_status = excluded.thumbnail_status,
        last_synced = CURRENT_TIMESTAMP
      RETURNING *
    `);

    const results: Photo[] = [];

    for (const photoData of photosData) {
      const metadataJson = photoData.metadata
        ? JSON.stringify(photoData.metadata)
        : null;
      const metadataStatus =
        photoData.metadata_status ||
        (photoData.metadata ? "extracted" : "none");
      const thumbnailStatus = photoData.thumbnail_status || "none";

      const photo = updateStmt.get(
        photoData.folder_id,
        photoData.filename,
        photoData.s3_key,
        photoData.size,
        photoData.mime_type,
        photoData.modified_at,
        metadataJson,
        metadataStatus,
        thumbnailStatus,
      ) as DatabasePhoto;

      results.push({
        ...photo,
        is_favorite: Boolean(photo.is_favorite),
        thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
        metadata: photo.metadata ? JSON.parse(photo.metadata) : undefined,
      } as Photo);
    }

    return results;
  });
}

export async function bulkCreateOrUpdateFolders(
  foldersData: CreateFolderData[],
): Promise<Folder[]> {
  return runTransaction((db) => {
    const updateStmt = db.prepare(`
      INSERT INTO folders (path, name, parent_id, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        parent_id = excluded.parent_id,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `);

    const results: Folder[] = [];

    for (const folderData of foldersData) {
      const folder = updateStmt.get(
        folderData.path,
        folderData.name,
        folderData.parent_id,
      ) as Folder;
      results.push(folder);
    }

    return results;
  });
}

export async function updatePhotoThumbnail(
  photoId: number,
  thumbnailPath: string,
): Promise<void> {
  const database = getDatabase();
  const stmt = database.prepare(
    "UPDATE photos SET thumbnail_path = ?, thumbnail_status = ? WHERE id = ?",
  );
  stmt.run(thumbnailPath, "generated", photoId);
}

export async function updatePhotoMetadata(
  photoId: number,
  metadata: PhotoMetadata,
): Promise<void> {
  const database = getDatabase();
  const metadataJson = JSON.stringify(metadata);
  const stmt = database.prepare(
    "UPDATE photos SET metadata = ?, metadata_status = ? WHERE id = ?",
  );
  stmt.run(metadataJson, "extracted", photoId);
}

export async function updatePhotoStatus(
  photoId: number,
  status: UpdatePhotoStatus,
): Promise<void> {
  const database = getDatabase();
  const updates: string[] = [];
  const values: any[] = [];

  if (status.metadata_status) {
    updates.push("metadata_status = ?");
    values.push(status.metadata_status);
  }

  if (status.thumbnail_status) {
    updates.push("thumbnail_status = ?");
    values.push(status.thumbnail_status);
  }

  if (updates.length > 0) {
    values.push(photoId);
    const stmt = database.prepare(
      `UPDATE photos SET ${updates.join(", ")} WHERE id = ?`,
    );
    stmt.run(...values);
  }
}

export async function getPhoto(photoId: number): Promise<Photo | null> {
  const database = getDatabase();
  const stmt = database.prepare("SELECT * FROM photos WHERE id = ?");
  const result = stmt.get(photoId) as DatabasePhoto | undefined;

  if (!result) return null;

  return {
    ...result,
    is_favorite: Boolean(result.is_favorite),
    thumbnail_url: `/api/photos/${result.id}/thumbnail`,
    metadata: result.metadata ? JSON.parse(result.metadata) : undefined,
  } as Photo;
}

export async function createSyncJob(
  jobData: CreateSyncJobData,
): Promise<SyncJob> {
  const database = getDatabase();
  const stmt = database.prepare(`
    INSERT INTO sync_jobs (type, folder_path)
    VALUES (?, ?)
    RETURNING *
  `);

  return stmt.get(jobData.type, jobData.folder_path) as SyncJob;
}

export async function updateSyncJob(
  jobId: number,
  updates: Partial<SyncJob>,
): Promise<void> {
  const database = getDatabase();

  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(updates);

  const stmt = database.prepare(`UPDATE sync_jobs SET ${fields} WHERE id = ?`);
  stmt.run(...values, jobId);
}

export async function getSyncJob(jobId: number): Promise<SyncJob | null> {
  const database = getDatabase();
  const stmt = database.prepare("SELECT * FROM sync_jobs WHERE id = ?");
  const result = stmt.get(jobId) as SyncJob | undefined;
  return result || null;
}

export async function getActiveSyncJobs(): Promise<SyncJob[]> {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT * FROM sync_jobs 
    WHERE status IN ('pending', 'running')
    ORDER BY id ASC
  `);

  return stmt.all() as SyncJob[];
}

export async function updateFolderCounts(folderId: number): Promise<void> {
  const database = getDatabase();

  const photoCountStmt = database.prepare(
    "SELECT COUNT(*) as count FROM photos WHERE folder_id = ?",
  );
  const subfolderCountStmt = database.prepare(
    "SELECT COUNT(*) as count FROM folders WHERE parent_id = ?",
  );

  const photoCount = (photoCountStmt.get(folderId) as { count: number }).count;
  const subfolderCount = (subfolderCountStmt.get(folderId) as { count: number })
    .count;

  const updateStmt = database.prepare(`
    UPDATE folders 
    SET photo_count = ?, subfolder_count = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  updateStmt.run(photoCount, subfolderCount, folderId);
}

// Incremental folder count updates
export async function incrementFolderPhotoCount(
  folderId: number,
  delta: number = 1,
): Promise<void> {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE folders 
    SET photo_count = photo_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(delta, folderId);
}

export async function incrementFolderSubfolderCount(
  folderId: number,
  delta: number = 1,
): Promise<void> {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE folders 
    SET subfolder_count = subfolder_count + ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(delta, folderId);
}

// Update folder last synced timestamp
export async function updateFolderLastSynced(folderId: number): Promise<void> {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE folders 
    SET last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(folderId);
}

export async function updateFolderLastVisited(
  folderPath: string,
): Promise<void> {
  const database = getDatabase();
  const stmt = database.prepare(`
    UPDATE folders 
    SET last_visited = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE path = ?
  `);
  stmt.run(folderPath);
}

// Bulk update folder last synced for sync operations
export async function bulkUpdateFoldersLastSynced(
  folderIds: number[],
): Promise<void> {
  if (folderIds.length === 0) return;

  return runTransaction((db) => {
    const stmt = db.prepare(`
      UPDATE folders 
      SET last_synced = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const folderId of folderIds) {
      stmt.run(folderId);
    }
  });
}

// Bulk folder count updates for sync operations
export async function bulkUpdateFolderCounts(
  folderIds: number[],
): Promise<void> {
  return runTransaction((db) => {
    const photoCountStmt = db.prepare(
      "SELECT COUNT(*) as count FROM photos WHERE folder_id = ?",
    );
    const subfolderCountStmt = db.prepare(
      "SELECT COUNT(*) as count FROM folders WHERE parent_id = ?",
    );
    const updateStmt = db.prepare(`
      UPDATE folders 
      SET photo_count = ?, subfolder_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const folderId of folderIds) {
      const photoCount = (photoCountStmt.get(folderId) as { count: number })
        .count;
      const subfolderCount = (
        subfolderCountStmt.get(folderId) as { count: number }
      ).count;
      updateStmt.run(photoCount, subfolderCount, folderId);
    }
  });
}

export async function getConfig(): Promise<Partial<Config>> {
  const database = getDatabase();
  const stmt = database.prepare("SELECT key, value FROM config");
  const rows = stmt.all() as { key: string; value: string }[];

  const config: Partial<Config> = {};

  for (const row of rows) {
    if (
      row.key === "thumbnail_max_age_days" ||
      row.key === "sync_interval_hours"
    ) {
      (config as any)[row.key] = parseInt(row.value);
    } else {
      (config as any)[row.key] = row.value;
    }
  }

  return config;
}


export async function deleteOldThumbnails(
  maxAgeDays: number,
): Promise<string[]> {
  const database = getDatabase();
  const stmt = database.prepare(`
    SELECT thumbnail_path FROM photos 
    WHERE thumbnail_path IS NOT NULL 
    AND last_synced < datetime('now', '-' || ? || ' days')
  `);

  const rows = stmt.all(maxAgeDays) as { thumbnail_path: string }[];
  const thumbnailPaths = rows.map((row) => row.thumbnail_path);

  const updateStmt = database.prepare(`
    UPDATE photos 
    SET thumbnail_path = NULL 
    WHERE thumbnail_path IS NOT NULL 
    AND last_synced < datetime('now', '-' || ? || ' days')
  `);

  updateStmt.run(maxAgeDays);

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
  access_type: 'view' | 'download' | 'password_attempt';
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

export async function createFolderShare(shareData: CreateShareData): Promise<SharedFolder> {
  const database = getDatabase();
  
  // Generate cryptographically secure token
  const shareToken = crypto.randomUUID();
  
  // Hash password if provided
  let passwordHash = null;
  if (shareData.password) {
    const bcrypt = require('bcrypt');
    passwordHash = await bcrypt.hash(shareData.password, 12);
  }
  
  // Get folder ID if not provided
  let folderId = shareData.folder_id;
  if (!folderId && shareData.folder_path) {
    const folder = await getFolderByPath(shareData.folder_path);
    folderId = folder?.id || undefined;
  }
  
  const stmt = database.prepare(`
    INSERT INTO shared_folders (
      folder_path, folder_id, share_token, password_hash, 
      expires_at, description, allow_download
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  
  const share = stmt.get(
    shareData.folder_path,
    folderId,
    shareToken,
    passwordHash,
    shareData.expires_at || null,
    shareData.description || null,
    shareData.allow_download !== false ? 1 : 0
  ) as SharedFolder;
  
  return {
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active)
  };
}

export async function getSharedFolder(shareToken: string): Promise<SharedFolder | null> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT * FROM shared_folders 
    WHERE share_token = ? AND is_active = 1
  `);
  
  const share = stmt.get(shareToken) as SharedFolder | undefined;
  
  if (!share) return null;
  
  // Check if share has expired
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return null;
  }
  
  return {
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active)
  };
}

export async function validateSharePassword(shareToken: string, password: string): Promise<boolean> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT password_hash FROM shared_folders 
    WHERE share_token = ? AND is_active = 1
  `);
  
  const result = stmt.get(shareToken) as { password_hash: string | null } | undefined;
  
  if (!result || !result.password_hash) {
    return true; // No password required
  }
  
  const bcrypt = require('bcrypt');
  return await bcrypt.compare(password, result.password_hash);
}

export async function incrementShareViewCount(shareToken: string): Promise<void> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    UPDATE shared_folders 
    SET view_count = view_count + 1, last_accessed = CURRENT_TIMESTAMP
    WHERE share_token = ? AND is_active = 1
  `);
  
  stmt.run(shareToken);
}

export async function logShareAccess(
  shareId: number, 
  accessData: {
    ip_address?: string;
    user_agent?: string;
    access_type: 'view' | 'download' | 'password_attempt';
    success?: boolean;
  }
): Promise<void> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    INSERT INTO share_access_logs (
      share_id, ip_address, user_agent, access_type, success
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    shareId,
    accessData.ip_address || null,
    accessData.user_agent || null,
    accessData.access_type,
    accessData.success !== false ? 1 : 0
  );
}

export async function getAllSharedFolders(): Promise<SharedFolder[]> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT sf.*, f.name as folder_name
    FROM shared_folders sf
    LEFT JOIN folders f ON sf.folder_id = f.id
    ORDER BY sf.created_at DESC
  `);
  
  const shares = stmt.all() as (SharedFolder & { folder_name: string })[];
  
  return shares.map(share => ({
    ...share,
    allow_download: Boolean(share.allow_download),
    is_active: Boolean(share.is_active)
  }));
}

export async function deactivateShare(shareToken: string): Promise<void> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    UPDATE shared_folders 
    SET is_active = 0
    WHERE share_token = ?
  `);
  
  stmt.run(shareToken);
}

export async function deleteExpiredShares(): Promise<number> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    DELETE FROM shared_folders 
    WHERE expires_at IS NOT NULL 
    AND expires_at < CURRENT_TIMESTAMP
  `);
  
  const result = stmt.run();
  return result.changes;
}

export async function getShareAccessLogs(shareId: number, limit: number = 100): Promise<ShareAccessLog[]> {
  const database = getDatabase();
  
  const stmt = database.prepare(`
    SELECT * FROM share_access_logs 
    WHERE share_id = ?
    ORDER BY accessed_at DESC
    LIMIT ?
  `);
  
  const logs = stmt.all(shareId, limit) as ShareAccessLog[];
  
  return logs.map(log => ({
    ...log,
    success: Boolean(log.success)
  }));
}
