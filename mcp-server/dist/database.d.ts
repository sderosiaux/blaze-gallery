import { Photo, Folder, SearchFilters, FolderSearchFilters } from './types.js';
export declare class GalleryDatabase {
    private sqliteConnection;
    constructor(dbPath?: string);
    private convertPhoto;
    searchPhotos(filters: SearchFilters): Promise<Photo[]>;
    getPhoto(photoId: number): Promise<Photo | null>;
    getPhotosByFolder(folderPath: string, limit?: number): Promise<Photo[]>;
    searchFolders(filters: FolderSearchFilters): Promise<Folder[]>;
    getFolderByPath(folderPath: string): Promise<Folder | null>;
    getFolderTree(rootPath?: string): Promise<Folder[]>;
    getFavoritePhotos(limit?: number): Promise<Photo[]>;
    getRecentPhotos(limit?: number): Promise<Photo[]>;
    getGalleryStats(): Promise<{
        total_photos: number;
        total_folders: number;
        total_size: number;
        favorite_photos: number;
        photos_with_metadata: number;
    }>;
    getPhotoAnalytics(options: {
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
    }>>;
    getPhotoTrends(options: {
        timeRange?: 'last-30-days' | 'last-year' | 'all-time';
        groupBy?: 'day' | 'week' | 'month' | 'year';
        metric?: 'count' | 'size' | 'favorites';
    }): Promise<Array<{
        period: string;
        value: number;
    }>>;
    close(): void;
}
//# sourceMappingURL=database.d.ts.map