export interface Photo {
    id: number;
    folder_id: number;
    filename: string;
    s3_key: string;
    size: number;
    mime_type: string;
    created_at: string;
    modified_at: string;
    thumbnail_path?: string;
    metadata?: PhotoMetadata;
    metadata_status: 'none' | 'pending' | 'extracted' | 'skipped_size';
    thumbnail_status: 'none' | 'pending' | 'generated' | 'skipped_size';
    is_favorite: boolean;
    last_synced?: string;
    thumbnail_url: string;
}
export interface Folder {
    id: number;
    path: string;
    name: string;
    parent_id?: number;
    created_at: string;
    updated_at: string;
    last_synced?: string;
    last_visited?: string;
    photo_count: number;
    subfolder_count: number;
    thumbnails_generated?: boolean;
    total_size?: number;
    folder_created_at?: string;
}
export interface PhotoMetadata {
    width?: number;
    height?: number;
    make?: string;
    model?: string;
    orientation?: number;
    dateTime?: string;
    gps?: {
        latitude?: number;
        longitude?: number;
        altitude?: number;
    };
    [key: string]: any;
}
export interface SearchFilters {
    folder_path?: string;
    filename?: string;
    mime_type?: string;
    is_favorite?: boolean;
    has_metadata?: boolean;
    min_size?: number;
    max_size?: number;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
}
export interface FolderSearchFilters {
    parent_path?: string;
    folder_name?: string;
    has_photos?: boolean;
    min_photo_count?: number;
    max_photo_count?: number;
    limit?: number;
    offset?: number;
}
//# sourceMappingURL=types.d.ts.map