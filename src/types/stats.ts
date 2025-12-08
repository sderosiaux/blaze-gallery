export interface BasicStats {
  total_photos: number;
  total_storage_bytes: number;
  avg_photo_size_bytes: number;
  total_folders_with_photos: number;
  total_favorites: number;
}

export interface FolderStats {
  name: string;
  path: string;
  photo_count: number;
  total_size: number;
  actual_photo_count: number;
  last_visited?: string | null;
  days_since_visited?: number;
  actual_total_size?: number;
}

export interface FileTypeStats {
  file_extension: string;
  count: number;
  total_size_bytes: number;
  avg_size_bytes: number;
}

export interface RecentActivity {
  date: string;
  photos_added: number;
  bytes_added: number;
}

export interface MetadataStats {
  photos_with_metadata: number;
  photos_with_camera_info: number;
  photos_with_date_taken: number;
  photos_with_location: number;
}

export interface CameraStats {
  camera: string;
  photo_count: number;
}

export interface SyncHealth {
  total_folders: number;
  synced_folders: number;
  recently_synced: number;
  stale_folders: number;
}

export interface VideoStats {
  total_videos: number;
  total_size_bytes: number;
  avg_size_bytes: number;
  min_size_bytes: number;
  max_size_bytes: number;
}

export interface VideoFormat {
  format: string;
  count: number;
  total_size_bytes: number;
}

export interface LargestVideo {
  filename: string;
  size: number;
  mime_type: string;
  folder_path: string;
}

export interface VideoFolderStats {
  name: string;
  path: string;
  video_count: number;
  total_size_bytes: number;
}

export interface VideoData {
  stats: VideoStats;
  formats: VideoFormat[];
  largest: LargestVideo[];
  folders_with_most: VideoFolderStats[];
}

export interface GalleryStats {
  basic: BasicStats;
  most_viewed_folders: FolderStats[];
  largest_folders_by_count: FolderStats[];
  largest_folders_by_size: FolderStats[];
  file_types: FileTypeStats[];
  recent_activity: RecentActivity[];
  metadata: MetadataStats;
  top_cameras: CameraStats[];
  sync_health: SyncHealth;
  videos?: VideoData;
}