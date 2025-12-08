// Common reusable types and status enums for the application

// Status types for photo processing
export type MetadataStatus = "none" | "pending" | "extracted" | "skipped_size";
export type ThumbnailStatus =
  | "none"
  | "pending"
  | "generated"
  | "skipped_size"
  | "skipped_unsupported"
  | "skipped_corrupted";
export type SyncJobType =
  | "full_scan"
  | "folder_scan"
  | "metadata_scan"
  | "cleanup";
export type SyncJobStatus = "pending" | "running" | "completed" | "failed";
export type ConfigSource = "env" | "database" | "api";

// Base context interface for logging
export interface BaseLogContext {
  component?: string;
  operation?: string;
}

// Specific log context types
export interface S3LogContext extends BaseLogContext {
  endpoint?: string;
  bucket?: string;
  s3Key?: string;
  region?: string;
  duration?: number;
  hasAccessKey?: boolean;
  hasSecretKey?: boolean;
  operation?: string;
  prefix?: string;
  maxKeys?: number;
  hasContinuationToken?: boolean;
  hasNextToken?: boolean;
  objectCount?: number;
  isTruncated?: boolean;
  key?: string;
  contentLength?: number;
  lastModified?: string;
  expiresIn?: number;
  urlLength?: number;
  contentType?: string;
  // DEBUG mode fields
  sampleObjects?: Array<{
    key: string;
    size: number;
    lastModified: string;
    etag: string;
  }>;
  totalObjects?: number;
  showingSample?: number;
  message?: string;
}

export interface SyncLogContext extends BaseLogContext {
  jobId?: number;
  jobType?: SyncJobType;
  jobCount?: number;
  runningJobId?: number;
  runningJobType?: SyncJobType;
  folderPath?: string;
  photoId?: number;
  s3Key?: string;
  progress?: {
    processed: number;
    total: number;
  };
  percentComplete?: number;
  processedCount?: number;
  totalObjects?: number;
  foldersCreated?: number;
  status?: string;
  totalPhotos?: number;
  maxSizeMB?: number;
  bucket?: string;
  endpoint?: string;
  processedObjects?: number;
  imageObjects?: number;
  skippedObjects?: number;
  deletedCount?: number;
  totalThumbnails?: number;
  maxAgeDays?: number;
  thumbnailPath?: string;
  fileSize?: number;
  lastCompletedAt?: string | Date;
  pausedJobId?: number;
  priorityJobId?: number;
  priorityJobType?: SyncJobType;
}

export interface ThumbnailLogContext extends BaseLogContext {
  photoId?: number;
  s3Key?: string;
  thumbnailPath?: string;
  sizeMB?: number;
  thresholdMB?: number;
  bucket?: string;
  count?: number;
  deletedCount?: number;
  maxAgeDays?: number;
}

export interface DatabaseLogContext extends BaseLogContext {
  table?: string;
  recordId?: number;
  query?: string;
}

export interface ApiLogContext extends BaseLogContext {
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  photoId?: number;
  folderPath?: string;
}

export interface ConfigLogContext extends BaseLogContext {
  configKey?: string;
  source?: ConfigSource;
  varsSet?: Record<string, boolean>;
  updatedKeys?: string[];
  validationErrors?: string[];
  hasEndpoint?: boolean;
  hasBucket?: boolean;
  hasAccessKey?: boolean;
  hasSecretKey?: boolean;
  thumbnailMaxAge?: number;
  syncInterval?: number;
  autoMetadataThreshold?: number;
  autoThumbnailThreshold?: number;
  syncThrottleSeconds?: number;
  bucketAccessMode?: string;
  objectsFound?: number;
  dbConfigKeys?: string[];
  originalError?: string;
  detailedError?: string;
  isReadOnly?: boolean;
  endpoint?: string;
  bucket?: string;
  duration?: number;
}

// Photo creation/update interfaces
export interface CreatePhotoData {
  folder_id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  modified_at: string;
  metadata?: import("./index").PhotoMetadata;
  metadata_status?: MetadataStatus;
  thumbnail_status?: ThumbnailStatus;
}

export interface UpdatePhotoStatus {
  metadata_status?: MetadataStatus;
  thumbnail_status?: ThumbnailStatus;
}

// Folder creation interface
export interface CreateFolderData {
  path: string;
  name: string;
  parent_id?: number;
}

// Sync job creation interface
export interface CreateSyncJobData {
  type: SyncJobType;
  folder_path?: string;
}

// API response interfaces
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SyncJobResponse
  extends ApiResponse<import("./index").SyncJob> {}
export interface PhotoResponse extends ApiResponse<import("./index").Photo> {}
export interface FolderResponse extends ApiResponse<import("./index").Folder> {}
export interface ConfigResponse extends ApiResponse<import("./index").Config> {}

// Thumbnail generation options
export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: "jpeg" | "png" | "webp";
}

// S3 configuration interface is defined in @/lib/s3

// Database query builder types
export interface DatabaseUpdateFields {
  updates: string[];
  values: any[];
}

// Pagination interface
export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "ASC" | "DESC";
}

// Search filters
export interface PhotoFilters {
  folderId?: number;
  metadataStatus?: MetadataStatus;
  thumbnailStatus?: ThumbnailStatus;
  sizeLessThan?: number;
  sizeGreaterThan?: number;
  modifiedAfter?: string;
  modifiedBefore?: string;
}

export interface FolderFilters {
  parentId?: number;
  hasPhotos?: boolean;
  lastSyncedAfter?: string;
  lastSyncedBefore?: string;
}

// Stats and metrics interfaces
export interface ThumbnailStats {
  totalThumbnails: number;
  totalSize: number;
  oldestThumbnail?: Date;
  newestThumbnail?: Date;
}

export interface SyncStats {
  totalJobs: number;
  pendingJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  lastSyncTime?: string;
}

export interface SystemStats {
  totalPhotos: number;
  totalFolders: number;
  thumbnailStats: ThumbnailStats;
  syncStats: SyncStats;
  diskUsage: {
    database: number;
    thumbnails: number;
    total: number;
  };
}
