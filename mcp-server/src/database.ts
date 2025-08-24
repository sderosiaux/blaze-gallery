import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Photo, Folder, PhotoMetadata, SearchFilters, FolderSearchFilters } from './types.js';

interface RawPhotoRecord {
  id: number;
  folder_id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  created_at: string;
  modified_at: string;
  thumbnail_path?: string;
  metadata: string | null;
  metadata_status: 'none' | 'pending' | 'extracted' | 'skipped_size';
  thumbnail_status: 'none' | 'pending' | 'generated' | 'skipped_size';
  is_favorite: number;
  last_synced?: string;
}

export class GalleryDatabase {
  private sqliteConnection: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'database', 'gallery.db');
    const finalPath = dbPath || defaultPath;
    
    // Check if database file exists
    if (!fs.existsSync(finalPath)) {
      throw new Error(`Database file not found at ${finalPath}. Please ensure your Blaze Gallery has been synced and the database exists.`);
    }
    
    // Check if directory exists
    const dbDir = path.dirname(finalPath);
    if (!fs.existsSync(dbDir)) {
      throw new Error(`Database directory not found at ${dbDir}. Please ensure your Blaze Gallery has been synced.`);
    }
    
    try {
      this.sqliteConnection = new Database(finalPath, { readonly: true });
      
      // Optimize for read performance
      this.sqliteConnection.pragma('journal_mode = WAL');
      this.sqliteConnection.pragma('synchronous = NORMAL');
      this.sqliteConnection.pragma('cache_size = 10000');
      this.sqliteConnection.pragma('temp_store = MEMORY');
    } catch (error) {
      throw new Error(`Failed to open database at ${finalPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private convertPhoto(rawPhoto: RawPhotoRecord): Photo {
    return {
      ...rawPhoto,
      is_favorite: Boolean(rawPhoto.is_favorite),
      thumbnail_url: `/api/photos/${rawPhoto.id}/thumbnail`,
      metadata: rawPhoto.metadata ? JSON.parse(rawPhoto.metadata) : undefined,
    };
  }

  async searchPhotos(filters: SearchFilters): Promise<Photo[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    // Build WHERE conditions
    if (filters.folder_path) {
      conditions.push('f.path = ? OR f.path LIKE ?');
      params.push(filters.folder_path, `${filters.folder_path}/%`);
    }

    if (filters.filename) {
      conditions.push('p.filename LIKE ?');
      params.push(`%${filters.filename}%`);
    }

    if (filters.mime_type) {
      conditions.push('p.mime_type = ?');
      params.push(filters.mime_type);
    }

    if (typeof filters.is_favorite === 'boolean') {
      conditions.push('p.is_favorite = ?');
      params.push(filters.is_favorite ? 1 : 0);
    }

    if (typeof filters.has_metadata === 'boolean') {
      conditions.push(filters.has_metadata ? 'p.metadata IS NOT NULL' : 'p.metadata IS NULL');
    }

    if (filters.min_size) {
      conditions.push('p.size >= ?');
      params.push(filters.min_size);
    }

    if (filters.max_size) {
      conditions.push('p.size <= ?');
      params.push(filters.max_size);
    }

    if (filters.date_from) {
      conditions.push('p.modified_at >= ?');
      params.push(filters.date_from);
    }

    if (filters.date_to) {
      conditions.push('p.modified_at <= ?');
      params.push(filters.date_to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const query = `
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${whereClause}
      ORDER BY p.modified_at DESC, p.filename
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const stmt = this.sqliteConnection.prepare(query);
    const results = stmt.all(params) as (RawPhotoRecord & { folder_path: string; folder_name: string })[];

    return results.map(photo => this.convertPhoto(photo));
  }

  async getPhoto(photoId: number): Promise<Photo | null> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.id = ?
    `);
    
    const result = stmt.get(photoId) as (RawPhotoRecord & { folder_path: string; folder_name: string }) | undefined;
    
    return result ? this.convertPhoto(result) : null;
  }

  async getPhotosByFolder(folderPath: string, limit: number = 100): Promise<Photo[]> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE f.path = ?
      ORDER BY p.filename COLLATE NOCASE
      LIMIT ?
    `);

    const results = stmt.all(folderPath, limit) as (RawPhotoRecord & { folder_path: string; folder_name: string })[];
    return results.map(photo => this.convertPhoto(photo));
  }

  async searchFolders(filters: FolderSearchFilters): Promise<Folder[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.parent_path) {
      if (filters.parent_path === '') {
        conditions.push('parent_id IS NULL');
      } else {
        conditions.push('parent.path = ?');
        params.push(filters.parent_path);
      }
    }

    if (filters.folder_name) {
      conditions.push('f.name LIKE ?');
      params.push(`%${filters.folder_name}%`);
    }

    if (typeof filters.has_photos === 'boolean') {
      conditions.push(filters.has_photos ? 'f.photo_count > 0' : 'f.photo_count = 0');
    }

    if (filters.min_photo_count) {
      conditions.push('f.photo_count >= ?');
      params.push(filters.min_photo_count);
    }

    if (filters.max_photo_count) {
      conditions.push('f.photo_count <= ?');
      params.push(filters.max_photo_count);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const query = `
      SELECT f.*, 
             COALESCE(SUM(p.size), 0) as total_size,
             COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN folders parent ON f.parent_id = parent.id
      LEFT JOIN photos p ON p.folder_id = f.id
      ${whereClause}
      GROUP BY f.id
      ORDER BY f.name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const stmt = this.sqliteConnection.prepare(query);
    const results = stmt.all(params) as Folder[];

    return results;
  }

  async getFolderByPath(folderPath: string): Promise<Folder | null> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT f.*, 
             COALESCE(SUM(p.size), 0) as total_size,
             COUNT(p.id) as actual_photo_count
      FROM folders f
      LEFT JOIN photos p ON p.folder_id = f.id
      WHERE f.path = ?
      GROUP BY f.id
    `);

    const result = stmt.get(folderPath) as Folder | undefined;
    return result || null;
  }

  async getFolderTree(rootPath?: string): Promise<Folder[]> {
    let query: string;
    let params: any[] = [];

    if (rootPath === undefined || rootPath === '') {
      query = `
        SELECT f.*, 
               COALESCE(SUM(p.size), 0) as total_size
        FROM folders f
        LEFT JOIN photos p ON p.folder_id = f.id
        WHERE f.parent_id IS NULL
        GROUP BY f.id
        ORDER BY f.name COLLATE NOCASE
      `;
    } else {
      query = `
        SELECT f.*, 
               COALESCE(SUM(p.size), 0) as total_size
        FROM folders f
        INNER JOIN folders parent ON f.parent_id = parent.id
        LEFT JOIN photos p ON p.folder_id = f.id
        WHERE parent.path = ?
        GROUP BY f.id
        ORDER BY f.name COLLATE NOCASE
      `;
      params = [rootPath];
    }

    const stmt = this.sqliteConnection.prepare(query);
    return stmt.all(params) as Folder[];
  }

  async getFavoritePhotos(limit: number = 100): Promise<Photo[]> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = 1
      ORDER BY p.created_at DESC
      LIMIT ?
    `);

    const results = stmt.all(limit) as (RawPhotoRecord & { folder_path: string; folder_name: string })[];
    return results.map(photo => this.convertPhoto(photo));
  }

  async getRecentPhotos(limit: number = 50): Promise<Photo[]> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT p.*, f.path as folder_path, f.name as folder_name
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ORDER BY p.modified_at DESC
      LIMIT ?
    `);

    const results = stmt.all(limit) as (RawPhotoRecord & { folder_path: string; folder_name: string })[];
    return results.map(photo => this.convertPhoto(photo));
  }

  async getGalleryStats(): Promise<{
    total_photos: number;
    total_folders: number;
    total_size: number;
    favorite_photos: number;
    photos_with_metadata: number;
  }> {
    const stmt = this.sqliteConnection.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM photos) as total_photos,
        (SELECT COUNT(*) FROM folders) as total_folders,
        (SELECT COALESCE(SUM(size), 0) FROM photos) as total_size,
        (SELECT COUNT(*) FROM photos WHERE is_favorite = 1) as favorite_photos,
        (SELECT COUNT(*) FROM photos WHERE metadata IS NOT NULL) as photos_with_metadata
    `);

    return stmt.get() as {
      total_photos: number;
      total_folders: number;
      total_size: number;
      favorite_photos: number;
      photos_with_metadata: number;
    };
  }

  close(): void {
    this.sqliteConnection.close();
  }
}