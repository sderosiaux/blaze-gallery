export interface Folder {
  id: number;
  name: string;
  path: string;
  parent_id?: number;
  photo_count: number;
  subfolder_count: number;
  last_synced?: string;
  last_visited?: string;
  thumbnails_generated: boolean;
  total_size: number;
  folder_created_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Photo {
  id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  created_at: string;
  modified_at: string;
  thumbnail_url: string;
  thumbnail_path?: string;
  metadata?: PhotoMetadata;
  metadata_status: import("./common").MetadataStatus;
  thumbnail_status: import("./common").ThumbnailStatus;
  is_favorite: boolean;
}

export interface PhotoMetadata {
  date_taken?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  dimensions?: {
    width: number;
    height: number;
  };
}

export interface SyncJob {
  id: number;
  type: import("./common").SyncJobType;
  status: import("./common").SyncJobStatus;
  folder_path?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  processed_items: number;
  total_items: number;
}

export interface Config {
  backblaze_endpoint: string;
  backblaze_bucket: string;
  backblaze_access_key: string;
  backblaze_secret_key: string;
  thumbnail_storage: "local" | "s3";
  thumbnail_s3_prefix: string;
  thumbnail_max_age_days: number;
  sync_interval_hours: number;
  auto_metadata_threshold_mb: number;
  auto_thumbnail_threshold_mb: number;
  sync_throttle_seconds: number;
}

export interface FolderContents {
  folder: Folder;
  subfolders: Folder[];
  photos: Photo[];
}
