import type {
  MetadataStatus,
  SyncJobStatus,
  SyncJobType,
  ThumbnailStatus,
} from "./common";

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
  /** An image from this folder, else from its first descendant folder holding images */
  cover_photo_id: number | null;
  /** Min/max metadata.date_taken of the folder's direct photos */
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Up to 5 colors of its photos, heaviest first, shares summing to 1 (lib/palette.ts).
   * Listings only; absent while none of its photos has measured colors.
   */
  palette?: { hex: string; share: number }[];
  /** Listings only: it or a folder above it is marked « pas une galerie photo » */
  excluded?: boolean;
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
  metadata_status: MetadataStatus;
  thumbnail_status: ThumbnailStatus;
  is_favorite: boolean;
  /** In a list: the stack of near-duplicates it fronts (photo_groups), two members or more */
  stack?: PhotoStack;
}

/** A stack of near-duplicates: its group id, and how many of its photos the gallery shows. */
export interface PhotoStack {
  id: number;
  count: number;
}

export interface PhotoMetadata {
  /** EXIF wall-clock time serialized as ISO with a `Z` suffix: format it with timeZone "UTC" */
  date_taken?: string;
  /** The EXIF tag date_taken was read from; absent on photos probed before 2026-10-21 */
  date_tag?: "DateTimeOriginal" | "DateTimeDigitized" | "DateTime";
  /** EXIF exposure bias in EV; absent when the file has none, or probed before 2026-10-21 */
  exposure_bias?: number;
  location?: {
    latitude: number;
    longitude: number;
  };
  /** Display orientation: width/height are already swapped for EXIF orientations 5-8 */
  dimensions?: {
    width: number;
    height: number;
  };
  camera?: {
    make?: string;
    model?: string;
  };
  /** Raw EXIF orientation (1-8) */
  orientation?: number;
  /** Clockwise quarter turns the owner applied by hand (see src/lib/rotation.ts) */
  user_rotation?: 0 | 90 | 180 | 270;
}

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

export interface Config {
  backblaze_endpoint: string;
  backblaze_bucket: string;
  backblaze_access_key: string;
  backblaze_secret_key: string;
  /** Storage endpoint as browsers reach it, when it differs from backblaze_endpoint */
  backblaze_public_endpoint?: string;
  thumbnail_storage: "local" | "s3";
  thumbnail_s3_endpoint?: string;
  thumbnail_s3_bucket?: string;
  thumbnail_s3_access_key?: string;
  thumbnail_s3_secret_key?: string;
  thumbnail_s3_prefix: string;
  thumbnail_max_age_days: number;
  auto_thumbnail_threshold_mb: number;
  sync_throttle_seconds: number;
}

export interface FolderContents {
  folder: Folder;
  subfolders: Folder[];
  photos: Photo[];
}
