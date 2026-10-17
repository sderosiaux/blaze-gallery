// Response shapes of /api/stats/**. Counts and byte totals are cast to numbers
// in SQL (byte sums as float8, exact up to 9 PB), so no string parsing here.

export interface StatsSummary {
  photos: number;
  videos: number;
  storage_bytes: number;
  video_bytes: number;
  /** Folders that hold at least one photo or video */
  albums: number;
  folders: number;
  favorites: number;
  metadata: {
    /** Images only: the backfill reads metadata for images, not videos */
    images: number;
    with_dimensions: number;
    with_date: number;
    /** Not read yet (metadata IS NULL, not marked failed) */
    pending: number;
  };
  sync: {
    stale_folders: number;
    last_synced: string | null;
  };
  generated_at: string;
}

export interface AlbumStat {
  id: number;
  name: string;
  path: string;
  photo_count: number;
  video_count: number;
  total_size: number;
}

export interface FileTypeStat {
  extension: string;
  kind: "photo" | "video";
  count: number;
  total_size_bytes: number;
}

export interface StorageStats {
  largest_by_size: AlbumStat[];
  largest_by_count: AlbumStat[];
  file_types: FileTypeStat[];
}

export interface VideoStats {
  summary: {
    total_videos: number;
    total_size_bytes: number;
    avg_size_bytes: number;
    max_size_bytes: number;
    albums_with_videos: number;
  };
  formats: { format: string; count: number; total_size_bytes: number }[];
  largest: {
    id: number;
    filename: string;
    size: number;
    format: string;
    folder_path: string;
    folder_name: string;
  }[];
  albums: {
    id: number;
    name: string;
    path: string;
    video_count: number;
    total_size_bytes: number;
  }[];
}

export interface DuplicateFileGroup {
  filename: string;
  size: number;
  count: number;
  /** At most six locations; `count` says how many there are in total */
  photos: { id: number; folder_path: string; folder_name: string }[];
}

export interface DuplicateFiles {
  summary: {
    total_duplicate_filenames: number;
    total_duplicate_photos: number;
    potential_space_saved_bytes: number;
  };
  /** The groups that free the most space, largest first */
  duplicates: DuplicateFileGroup[];
}

export interface DuplicateFolderGroup {
  folder_signature: string;
  count: number;
  file_count: number;
  total_size_bytes: number;
  folders: {
    id: number;
    path: string;
    name: string;
    photo_count: number;
    total_size_bytes: number;
  }[];
}

export interface DuplicateFolders {
  summary: {
    total_duplicate_folder_groups: number;
    total_duplicate_folders: number;
    potential_space_saved_bytes: number;
  };
  duplicates: DuplicateFolderGroup[];
}

export interface HealthStats {
  metadata: {
    images: number;
    with_dimensions: number;
    with_date: number;
    with_camera: number;
    with_location: number;
    pending: number;
    failed: number;
    videos: number;
  };
  sync: {
    total_folders: number;
    synced_last_day: number;
    synced_last_week: number;
    stale: number;
    never_synced: number;
    last_synced: string | null;
    oldest_synced: string | null;
  };
}

export interface IgnoredFiles {
  summary: {
    total_ignored_files: number;
    total_ignored_size_bytes: number;
  };
  breakdown: {
    category: string;
    label: string;
    count: number;
    total_size_bytes: number;
    examples: string[];
  }[];
}
