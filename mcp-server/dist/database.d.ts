import { Photo, Folder, SearchFilters, FolderSearchFilters } from './types.js';
export declare class GalleryDatabase {
    private db;
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
    close(): void;
}
//# sourceMappingURL=database.d.ts.map