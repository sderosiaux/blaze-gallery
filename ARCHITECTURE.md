# Photo Gallery Architecture Design

## Database Schema (SQLite)

### folders
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `path` TEXT UNIQUE NOT NULL (full S3 path)
- `name` TEXT NOT NULL (folder name)
- `parent_id` INTEGER NULL (references folders.id)
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `last_synced` DATETIME NULL
- `photo_count` INTEGER DEFAULT 0
- `subfolder_count` INTEGER DEFAULT 0

### photos
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `folder_id` INTEGER NOT NULL (references folders.id)
- `filename` TEXT NOT NULL
- `s3_key` TEXT UNIQUE NOT NULL (full S3 object key)
- `size` INTEGER NOT NULL (bytes)
- `mime_type` TEXT NOT NULL
- `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
- `modified_at` DATETIME NOT NULL (from S3 LastModified)
- `thumbnail_path` TEXT NULL (local thumbnail file path)
- `metadata` TEXT NULL (JSON: date_taken, location, dimensions)
- `last_synced` DATETIME NULL

### sync_jobs
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `type` TEXT NOT NULL (full_scan, folder_scan, cleanup)
- `status` TEXT NOT NULL (pending, running, completed, failed)
- `folder_path` TEXT NULL (for folder_scan jobs)
- `started_at` DATETIME NULL
- `completed_at` DATETIME NULL
- `error_message` TEXT NULL
- `processed_items` INTEGER DEFAULT 0
- `total_items` INTEGER DEFAULT 0

### config
- `key` TEXT PRIMARY KEY
- `value` TEXT NOT NULL
- `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP

## API Endpoints

### Folders
- `GET /api/folders` - Get root folders
- `GET /api/folders/[...path]` - Get folder contents (photos + subfolders)
- `POST /api/folders/sync` - Trigger folder sync

### Photos  
- `GET /api/photos/[id]` - Get photo metadata
- `GET /api/photos/[id]/thumbnail` - Serve thumbnail image
- `GET /api/photos/[id]/download` - Redirect to S3 signed URL for original

### Sync
- `GET /api/sync/status` - Get current sync status
- `POST /api/sync/full` - Trigger full bucket scan
- `POST /api/sync/cleanup` - Trigger thumbnail cleanup

### Config
- `GET /api/config` - Get configuration (sanitized)
- `POST /api/config` - Update configuration

## TypeScript Models

```typescript
interface Folder {
  id: number;
  name: string;
  path: string;
  parent_id?: number;
  photo_count: number;
  subfolder_count: number;
  last_synced?: string;
  created_at: string;
  updated_at: string;
}

interface Photo {
  id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  created_at: string;
  modified_at: string;
  thumbnail_url: string;
  metadata?: PhotoMetadata;
}

interface PhotoMetadata {
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

interface SyncJob {
  id: number;
  type: 'full_scan' | 'folder_scan' | 'cleanup';
  status: 'pending' | 'running' | 'completed' | 'failed';
  folder_path?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  processed_items: number;
  total_items: number;
}

interface Config {
  backblaze_endpoint: string;
  backblaze_bucket: string;
  backblaze_access_key: string;
  backblaze_secret_key: string;
  thumbnail_max_age_days: number;
  sync_interval_hours: number;
}
```

## Sync Strategy

### 1. Full Scan (Initial Setup)
- List all objects in S3 bucket with pagination
- Build folder hierarchy in database
- Queue photo processing jobs
- Generate thumbnails asynchronously

### 2. Incremental Sync
- Use S3 ListObjectsV2 with `StartAfter` for pagination
- Compare LastModified dates with database
- Only process new/changed files
- Remove deleted files from database

### 3. Thumbnail Management
- Generate 400px width thumbnails (maintain aspect ratio)
- Store in local `/thumbnails` directory
- Cleanup thumbnails older than configured days
- Use photo ID as filename to avoid conflicts

## Caching Strategy

### Database as Cache
- SQLite acts as metadata cache
- Tracks sync timestamps for incremental updates
- Stores folder hierarchy for fast navigation

### Thumbnail Cache
- Local filesystem storage
- Time-based cleanup (configurable)
- Generate on-demand for new photos
- Serve via Next.js API route with proper headers

## Background Processing

### Sync Service
- Runs as separate process/thread
- Configurable interval (default: 24 hours)
- Processes sync_jobs table as queue
- Updates job status and progress

### Cleanup Service  
- Runs weekly
- Removes old thumbnails
- Cleans up orphaned database records
- Compacts SQLite database