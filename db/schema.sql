-- Blaze Gallery schema, applied by scripts/migrate.mjs.
--
-- Every statement is IF NOT EXISTS: on a database that already has the
-- schema, running this file changes nothing. A column added later needs its
-- own statement (ALTER TABLE ... ADD COLUMN IF NOT EXISTS), not an edit of a
-- CREATE TABLE, which an existing database skips.
--
-- Taken from the production database (PostgreSQL 17). Two deliberate
-- differences:
--   * no deletion_jobs table: production still has it, nothing reads it;
--   * folders.path is COLLATE "C": listFolders (src/lib/database.ts) finds
--     descendants with the range [path || '/', path || '0'), which only holds
--     in code-point order. Production gets that order from its database
--     locale (C.UTF-8); the column collation makes it hold on any locale.
--
-- `timestamp` columns (without time zone) store UTC: the server writes
-- CURRENT_TIMESTAMP in a UTC session and database.ts reads them as UTC.

CREATE TABLE IF NOT EXISTS folders (
  id bigserial PRIMARY KEY,
  path varchar COLLATE "C" NOT NULL UNIQUE,
  name varchar NOT NULL,
  parent_id bigint REFERENCES folders (id),
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
  last_synced timestamp,
  last_visited timestamp,
  photo_count integer DEFAULT 0,
  subfolder_count integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photos (
  id bigserial PRIMARY KEY,
  folder_id bigint NOT NULL REFERENCES folders (id),
  filename varchar NOT NULL,
  s3_key varchar NOT NULL UNIQUE,
  size bigint NOT NULL,
  mime_type varchar NOT NULL,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  modified_at timestamp NOT NULL,
  thumbnail_path varchar,
  metadata jsonb,
  metadata_status varchar NOT NULL DEFAULT 'none',
  thumbnail_status varchar NOT NULL DEFAULT 'none',
  is_favorite boolean DEFAULT false,
  last_synced timestamp
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id bigserial PRIMARY KEY,
  folder_path varchar NOT NULL,
  status varchar NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at timestamp,
  completed_at timestamp,
  error_message text,
  total_items integer DEFAULT 0,
  processed_items integer DEFAULT 0,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  type varchar NOT NULL
    CHECK (type IN ('full_scan', 'folder_scan', 'metadata_scan', 'cleanup'))
);

-- Touched every minute by the process running the job. A running job that
-- stops beating was left by a process that died (a serverless function frozen
-- mid-scan): it is failed instead of blocking every later sync.
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamp;

CREATE TABLE IF NOT EXISTS shared_folders (
  id bigserial PRIMARY KEY,
  folder_id bigint NOT NULL REFERENCES folders (id),
  share_token varchar NOT NULL UNIQUE,
  password_hash varchar,
  expires_at timestamp,
  max_views integer,
  current_views integer DEFAULT 0,
  created_at timestamp DEFAULT CURRENT_TIMESTAMP,
  is_active boolean DEFAULT true,
  folder_path text,
  description text,
  allow_download boolean DEFAULT true,
  view_count integer DEFAULT 0,
  last_accessed timestamp
);

CREATE TABLE IF NOT EXISTS share_access_logs (
  id bigserial PRIMARY KEY,
  shared_folder_id bigint NOT NULL REFERENCES shared_folders (id),
  ip_address inet,
  user_agent text,
  accessed_at timestamp DEFAULT CURRENT_TIMESTAMP,
  photo_id bigint REFERENCES photos (id),
  share_id bigint,
  access_type varchar(50),
  success boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id varchar(36) PRIMARY KEY,
  email varchar(255) NOT NULL,
  name varchar(255) NOT NULL,
  picture text,
  google_id varchar(255),
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  last_activity timestamptz DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  identifier varchar(255) PRIMARY KEY,
  count integer NOT NULL DEFAULT 1,
  reset_time bigint NOT NULL,
  created_at timestamptz DEFAULT CURRENT_TIMESTAMP
);

-- gen_random_uuid() is built in from PostgreSQL 13: no extension needed.
CREATE TABLE IF NOT EXISTS s3_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operation text NOT NULL CHECK (operation IN (
    'ListBuckets', 'ListObjects', 'GetObject', 'HeadObject', 'PutObject',
    'DeleteObject', 'GetBucketLocation', 'GetObjectMetadata',
    'GeneratePresignedUrl', 'DownloadFile', 'UploadFile',
    'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload',
    'AbortMultipartUpload'
  )),
  method text NOT NULL
    CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'HEAD')),
  endpoint text NOT NULL,
  bucket text NOT NULL,
  key text,
  duration_ms integer NOT NULL,
  status_code integer NOT NULL,
  bytes_transferred bigint,
  user_agent text,
  ip_address inet,
  session_id text,
  user_id text,
  error_message text,
  cache_hit boolean DEFAULT false,
  estimated_cost_usd numeric(10, 6),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_folders_last_visited ON folders (last_visited);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders (parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_path ON folders (path);
CREATE INDEX IF NOT EXISTS idx_folders_photo_count ON folders (photo_count);

CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos (created_at);
-- Keyset of /api/timeline (getTimelinePhotos)
CREATE INDEX IF NOT EXISTS idx_photos_date_taken
  ON photos ((metadata ->> 'date_taken'), id)
  WHERE (metadata ->> 'date_taken') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos (filename);
CREATE INDEX IF NOT EXISTS idx_photos_folder_id ON photos (folder_id);
CREATE INDEX IF NOT EXISTS idx_photos_folder_modified ON photos (folder_id, modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_is_favorite ON photos (is_favorite);
CREATE INDEX IF NOT EXISTS idx_photos_last_synced ON photos (last_synced);
CREATE INDEX IF NOT EXISTS idx_photos_metadata_status ON photos (metadata_status);
CREATE INDEX IF NOT EXISTS idx_photos_modified_at ON photos (modified_at);
CREATE INDEX IF NOT EXISTS idx_photos_s3_key ON photos (s3_key);
CREATE INDEX IF NOT EXISTS idx_photos_size ON photos (size);
CREATE INDEX IF NOT EXISTS idx_photos_status_composite ON photos (metadata_status, thumbnail_status);
CREATE INDEX IF NOT EXISTS idx_photos_thumbnail_status ON photos (thumbnail_status);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at ON sync_jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_folder_path ON sync_jobs (folder_path);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs (status);

CREATE INDEX IF NOT EXISTS idx_shared_folders_expires_at ON shared_folders (expires_at);
CREATE INDEX IF NOT EXISTS idx_shared_folders_folder_id ON shared_folders (folder_id);
CREATE INDEX IF NOT EXISTS idx_shared_folders_is_active ON shared_folders (is_active);
CREATE INDEX IF NOT EXISTS idx_shared_folders_share_token ON shared_folders (share_token);

CREATE INDEX IF NOT EXISTS idx_share_access_logs_accessed_at ON share_access_logs (accessed_at);
CREATE INDEX IF NOT EXISTS idx_share_access_logs_ip_address ON share_access_logs (ip_address);
CREATE INDEX IF NOT EXISTS idx_share_access_logs_shared_folder_id ON share_access_logs (shared_folder_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_email ON user_sessions (email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_time ON rate_limits (reset_time);

CREATE INDEX IF NOT EXISTS idx_s3_audit_bucket ON s3_audit_logs (bucket);
CREATE INDEX IF NOT EXISTS idx_s3_audit_bucket_operation ON s3_audit_logs (bucket, operation);
CREATE INDEX IF NOT EXISTS idx_s3_audit_created_at ON s3_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_s3_audit_duration ON s3_audit_logs (duration_ms);
CREATE INDEX IF NOT EXISTS idx_s3_audit_operation ON s3_audit_logs (operation);
CREATE INDEX IF NOT EXISTS idx_s3_audit_session_timestamp ON s3_audit_logs (session_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_s3_audit_status_code ON s3_audit_logs (status_code);
CREATE INDEX IF NOT EXISTS idx_s3_audit_timestamp ON s3_audit_logs ("timestamp");
CREATE INDEX IF NOT EXISTS idx_s3_audit_timestamp_operation ON s3_audit_logs ("timestamp", operation);
