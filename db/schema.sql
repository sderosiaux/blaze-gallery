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

-- ---------------------------------------------------------------------------
-- Photo analysis: a job queue shared by workers on several machines (worker/),
-- and what the "faces" task finds. Only new tables: nothing above changes.
-- Rows cascade away with their photo, so deletePhoto keeps working.

-- halfvec (pgvector >= 0.7) keeps a 512-d embedding at ~1 KB.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per (photo, task). `task` is free text so a new task (describe,
-- embed) is new rows, not new schema. Workers claim queued rows with
-- FOR UPDATE SKIP LOCKED and hold them under a lease: a worker that dies stops
-- renewing it, and the next claimer puts the row back in the queue (or marks
-- it failed once attempts reaches max_attempts). A worker that lost its lease
-- cannot complete the row: completion checks lease_owner.
--   queued  -> leased -> done | skipped (nothing to analyze, e.g. SVG)
--                     -> queued (retry after not_before) | failed
-- lease_owner stays set on done/failed/skipped: it is the machine that did it.
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id bigserial PRIMARY KEY,
  photo_id bigint NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  task text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'leased', 'done', 'failed', 'skipped')),
  -- Higher first; the enqueue script uses the year taken (0 when unknown)
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  -- Backoff: a failed attempt is retried no earlier than this
  not_before timestamptz,
  last_error text,
  -- Model that produced the result, e.g. "insightface/buffalo_l"
  model text,
  -- Per-run measurements: bytes fetched, ms per stage, result counts
  stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (photo_id, task)
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_claim
  ON analysis_jobs (task, priority DESC, id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_lease
  ON analysis_jobs (lease_expires_at) WHERE status = 'leased';

-- People the owner names. The system proposes groups of faces; a row may
-- exist unnamed until he names it.
CREATE TABLE IF NOT EXISTS people (
  id bigserial PRIMARY KEY,
  name text,
  birth_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per face worth keeping (det_score >= 0.7 and a box side >= 25 px
-- in the 1024 px rendition the detector sees). A photo with no such face has
-- no row here; its analysis_jobs row (task 'faces', status 'done') says it
-- was looked at.
--
-- Geometry. box = [x, y, w, h] and landmarks = [x1, y1, ... x5, y5] (the two
-- eyes, nose tip, two mouth corners) are fractions of the image in its
-- DISPLAYED orientation: EXIF orientation applied,
-- photos.metadata.user_rotation NOT applied. To draw on a photo the owner
-- turned by hand, turn the box clockwise on top:
--   90:  (x, y, w, h) -> (1 - y - h, x, h, w)
--   180: (x, y, w, h) -> (1 - x - w, 1 - y - h, w, h)
--   270: (x, y, w, h) -> (y, 1 - x - w, h, w)
-- detect_rotation: 0, or 90/270 when the face was only found on the image
-- turned that much clockwise (a photo stored on its side without EXIF
-- orientation). box and landmarks are converted back to the displayed
-- orientation; yaw/pitch/roll and the eye/mouth measures are taken in the
-- turned frame.
--
-- Quality. width_px/height_px: the box in pixels of the decoded original
-- (displayed orientation; half-size for the rare RAW without a preview).
-- sharpness: variance of the Laplacian of the aligned 112 px face crop
-- (higher = sharper). yaw/pitch/roll: degrees, 0 = facing the camera.
-- cluster_eligible: good enough to define who someone is (clustering seeds);
-- the other faces can still be matched to a person.
--
-- Look. eye_left_open/eye_right_open: lid gap over eye width from the
-- 106-point landmarks, left/right as seen in the photo (~0.3 open, < 0.15
-- closed). mouth_open: inner-lip gap over mouth width (~0 closed).
-- expression: strongest of expression_scores, the 8 probabilities in order
-- anger, contempt, disgust, fear, happiness, neutral, sadness, surprise.
--
-- Identity. embedding: L2-normalized ArcFace vector; compare with <=>
-- (cosine distance). model names the embedding space (pack, file, weights
-- hash): vectors of two different models never compare; a new model means
-- re-embedding every face. The HNSW index serves queries ("faces like this
-- one"); with a WHERE clause, pgvector >= 0.8 needs
-- SET hnsw.iterative_scan = relaxed_order to return enough rows.
-- assignment: how person_id was set. seed = picked by the owner as an
-- example, auto = proposed by clustering, manual = confirmed by the owner,
-- rejected = the owner said this face is NOT person_id.
CREATE TABLE IF NOT EXISTS faces (
  id bigserial PRIMARY KEY,
  photo_id bigint NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  box real[] NOT NULL CHECK (array_length(box, 1) = 4),
  landmarks real[] NOT NULL CHECK (array_length(landmarks, 1) = 10),
  detect_rotation smallint NOT NULL DEFAULT 0
    CHECK (detect_rotation IN (0, 90, 180, 270)),
  det_score real NOT NULL,
  width_px integer NOT NULL,
  height_px integer NOT NULL,
  sharpness real,
  yaw real,
  pitch real,
  roll real,
  cluster_eligible boolean GENERATED ALWAYS AS (
    coalesce(
      det_score >= 0.8
      AND least(width_px, height_px) >= 112
      AND sharpness >= 50
      AND abs(yaw) <= 45,
      false
    )
  ) STORED,
  eye_left_open real,
  eye_right_open real,
  mouth_open real,
  expression text,
  expression_scores real[]
    CHECK (expression_scores IS NULL OR array_length(expression_scores, 1) = 8),
  embedding halfvec(512) NOT NULL,
  model text NOT NULL,
  person_id bigint REFERENCES people (id) ON DELETE SET NULL,
  assignment text
    CHECK (assignment IN ('seed', 'auto', 'manual', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces (photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id
  ON faces (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_faces_embedding
  ON faces USING hnsw (embedding halfvec_cosine_ops);

-- What a photo shows, in the words of a vision-language model run on the
-- owner's Mac (task 'describe'). Only what the pixels show: the date and the
-- folder stay in photos and folders, and how faces look (pose, eyes, mouth,
-- expression) is in faces; the model is not asked about either. The photo is
-- seen upright as the owner sees it (EXIF orientation and user_rotation).
-- data: caption, activity, setting, place_type, occasion, people_count,
-- framing, objects, mood. Their allowed values are in
-- worker/src/blaze_worker/photo_description.schema.json; the worker writes
-- nothing that fails it. Texts are French; occasion comes from visible cues
-- only (a tree, candles, a wedding dress), not from the date.
-- model: weights and prompt that wrote it, e.g.
-- "mlx-community/Qwen3-VL-4B-Instruct-4bit@<commit> describe-v1". One row per
-- photo: a run with another model or prompt replaces it.
CREATE TABLE IF NOT EXISTS photo_descriptions (
  photo_id bigint PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  model text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
