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

  async getPhotoAnalytics(options: {
    groupBy: 'year' | 'month' | 'year-month' | 'folder';
    orderBy?: 'period' | 'count' | 'size';
    orderDirection?: 'ASC' | 'DESC';
    limit?: number;
  }): Promise<Array<{
    period: string;
    photo_count: number;
    total_size: number;
    favorite_count: number;
    folders_involved?: number;
  }>> {
    let selectFields: string;
    let groupByClause: string;

    switch (options.groupBy) {
      case 'year':
        // Extract the first 4-digit year (20XX) found anywhere in the folder path
        // This handles nested paths like "2020-10-12/subfolder/selection" 
        selectFields = `
          CASE 
            WHEN f.path GLOB '*20[0-9][0-9]*' THEN 
              substr(f.path, instr(f.path, '20'), 4)
            ELSE 'unorganized'
          END as period`;
        groupByClause = `
          CASE 
            WHEN f.path GLOB '*20[0-9][0-9]*' THEN 
              substr(f.path, instr(f.path, '20'), 4)
            ELSE 'unorganized'
          END`;
        break;
      case 'month':
        selectFields = `strftime('%Y-%m', modified_at) as period`;
        groupByClause = `strftime('%Y-%m', modified_at)`;
        break;
      case 'year-month':
        selectFields = `strftime('%Y-%m', modified_at) as period`;
        groupByClause = `strftime('%Y-%m', modified_at)`;
        break;
      case 'folder':
        selectFields = `f.path as period`;
        groupByClause = `f.path`;
        break;
    }

    const orderBy = options.orderBy || 'period';
    const orderDirection = options.orderDirection || 'DESC';
    const limit = options.limit || 100;

    let orderByClause: string;
    switch (orderBy) {
      case 'count':
        orderByClause = 'photo_count';
        break;
      case 'size':
        orderByClause = 'total_size';
        break;
      default:
        orderByClause = 'period';
    }

    const query = options.groupBy === 'folder' ? `
      SELECT 
        ${selectFields},
        COUNT(p.id) as photo_count,
        COALESCE(SUM(p.size), 0) as total_size,
        COUNT(CASE WHEN p.is_favorite = 1 THEN 1 END) as favorite_count
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause} ${orderDirection}
      LIMIT ?
    ` : `
      SELECT 
        ${selectFields},
        COUNT(p.id) as photo_count,
        COALESCE(SUM(p.size), 0) as total_size,
        COUNT(CASE WHEN p.is_favorite = 1 THEN 1 END) as favorite_count,
        COUNT(DISTINCT p.folder_id) as folders_involved
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ${options.groupBy === 'year' ? '' : `WHERE ${groupByClause} IS NOT NULL`}
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause} ${orderDirection}
      LIMIT ?
    `;

    const stmt = this.sqliteConnection.prepare(query);
    return stmt.all(limit) as Array<{
      period: string;
      photo_count: number;
      total_size: number;
      favorite_count: number;
      folders_involved?: number;
    }>;
  }

  async getPhotoTrends(options: {
    timeRange?: 'last-30-days' | 'last-year' | 'all-time';
    groupBy?: 'day' | 'week' | 'month' | 'year';
    metric?: 'count' | 'size' | 'favorites';
  }): Promise<Array<{
    period: string;
    value: number;
  }>> {
    const groupBy = options.groupBy || 'month';
    const metric = options.metric || 'count';
    const timeRange = options.timeRange || 'last-year';

    let dateFilter = '';
    switch (timeRange) {
      case 'last-30-days':
        dateFilter = "AND modified_at >= datetime('now', '-30 days')";
        break;
      case 'last-year':
        dateFilter = "AND modified_at >= datetime('now', '-1 year')";
        break;
      case 'all-time':
        dateFilter = '';
        break;
    }

    let selectFields: string;
    let groupByClause: string;
    switch (groupBy) {
      case 'day':
        selectFields = `strftime('%Y-%m-%d', modified_at) as period`;
        groupByClause = `strftime('%Y-%m-%d', modified_at)`;
        break;
      case 'week':
        selectFields = `strftime('%Y-W%W', modified_at) as period`;
        groupByClause = `strftime('%Y-W%W', modified_at)`;
        break;
      case 'year':
        selectFields = `strftime('%Y', modified_at) as period`;
        groupByClause = `strftime('%Y', modified_at)`;
        break;
      case 'month':
        selectFields = `strftime('%Y-%m', modified_at) as period`;
        groupByClause = `strftime('%Y-%m', modified_at)`;
        break;
      default:
        // Default to month if not specified
        selectFields = `strftime('%Y-%m', modified_at) as period`;
        groupByClause = `strftime('%Y-%m', modified_at)`;
        break;
    }

    let valueClause: string;
    switch (metric) {
      case 'size':
        valueClause = 'COALESCE(SUM(size), 0) as value';
        break;
      case 'favorites':
        valueClause = 'COUNT(CASE WHEN is_favorite = 1 THEN 1 END) as value';
        break;
      default:
        valueClause = 'COUNT(*) as value';
    }

    const query = `
      SELECT 
        ${selectFields},
        ${valueClause}
      FROM photos
      WHERE ${groupByClause} IS NOT NULL ${dateFilter}
      GROUP BY ${groupByClause}
      ORDER BY period ASC
    `;

    const stmt = this.sqliteConnection.prepare(query);
    return stmt.all() as Array<{
      period: string;
      value: number;
    }>;
  }

  close(): void {
    this.sqliteConnection.close();
  }
}