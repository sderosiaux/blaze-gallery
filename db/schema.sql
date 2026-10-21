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

-- What a full scan found (SyncJobStats in src/lib/database.ts), written
-- before it changes anything. Keeps the ids of photos whose file was
-- replaced: their faces and descriptions still describe the old file.
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS stats jsonb;

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
-- Whether a task still has work, without reading every done row (Couleurs
-- asks it of 'thumbs' at each visit); the predicate is the query's
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_pending
  ON analysis_jobs (task) WHERE status IN ('queued', 'leased');

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
-- was looked at. A 'faces_extra' job (worker/, on chosen photos) looked again
-- with a lower floor (det_score >= 0.5 by default, 25 px in a 2048 px
-- rendition) and only added faces that overlap none stored; the ids it added
-- are in its stats.added_ids.
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
-- (higher = sharper). yaw/pitch/roll: degrees, 0 = facing the camera;
-- pitch below 0 looks down, above 0 up (InsightFace's pose).
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
-- The photos of the rare looks on anyone's face (RARE_LOOKS in
-- src/lib/database.ts), a few hundred faces each, without reading every
-- face. Each predicate is that look's SQL as anyoneLooks writes it: the
-- planner uses the index only while the look implies it (a looser look
-- needs its index rebuilt).
CREATE INDEX IF NOT EXISTS idx_faces_look_rit ON faces (photo_id)
  WHERE expression_scores[5] >= 0.8::real AND mouth_open >= 0.25::real
    AND cluster_eligible;
CREATE INDEX IF NOT EXISTS idx_faces_look_triste ON faces (photo_id)
  WHERE expression_scores[7] >= 0.6::real AND cluster_eligible
    AND person_id IS NOT NULL AND assignment IN ('seed', 'manual', 'auto');
CREATE INDEX IF NOT EXISTS idx_faces_look_yeux_fermes ON faces (photo_id)
  WHERE eye_left_open IS NOT NULL AND eye_right_open IS NOT NULL
    AND greatest(eye_left_open, eye_right_open) < 0.10::real
    AND pitch >= -5::real AND cluster_eligible;

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

-- What colors each photo holds, from the "thumbs" task (worker/), which
-- downloads the original once for its thumbnail and these measures. One row
-- per photo; a new model recomputes and replaces it. Contract for the UI
-- (Couleurs page, color chips, palette strips) and for MCP clients.
--
-- Measured on the photo as the owner sees it (EXIF orientation and
-- metadata.user_rotation applied, displayed colors, no white balance
-- correction), at 128 px, in CIE L*a*b* / LCh (D65). Each pixel weighs
-- exp(-(dx/sx)^2/2 - (dy/sy)^2/2) from the center, sx = center_sigma x width,
-- sy = center_sigma x height: "mostly the center, a large one" (at 0.40 the
-- border still counts about a third of the center).
--
-- hues: the share of the weighted picture in each of 12 families, summing
-- to 1, ALWAYS in this order (1-based for SQL: hues[1] is red):
--    1 red     2 orange   3 yellow   4 green   5 teal    6 blue
--    7 purple  8 pink     9 brown   10 black  11 grey   12 white
-- Pixels with low chroma go to black / grey / white by lightness; the others
-- to a family by hue angle, with soft borders. Warm hues only count as red,
-- orange or yellow when saturated: skin, wood, hair and tungsten-lit walls
-- are brown (a close-up portrait reads mostly brown, not orange); light
-- muted reds are pink.
-- palette_hex / palette_share: up to 5 colors ('#rrggbb', sRGB) found by
-- weighted k-means in Lab, with their shares of the weighted picture, most
-- important first (shares sum to 1; fewer than 5 on a flat picture).
-- colorfulness: Hasler-Suesstrunk M, weighted (0 grey, ~15 slightly, ~33
-- moderately, ~45 average, ~59 quite, 80+ very colorful).
-- chroma: weighted mean C*. luminance: weighted mean L* (0 black - 100 white).
-- monochrome: 95% of the weight has C* < 6 (B&W, and colorless photos such
-- as thick fog: they look the same).
-- model: the algorithm version (rows of two models do not compare).
--
-- Thresholds calibrated on the library (see the worker's calibration):
--   color chip "contains c":   hues[c] >= 0.03, ranked by hues[c] DESC
--   Neutres:                   colorfulness < 15 AND NOT monochrome
--   Noir et blanc:             monochrome
--   Sombre / Lumineuse:        luminance < 30 / luminance > 65
--   Vives / Douces:            colorfulness >= 55 /
--                              colorfulness < 22 AND NOT monochrome
-- A list kept in its own order (timeline, map, search) cannot sink a corner
-- of sky: there blue, brown, black, grey and white need a larger share
-- (NARROWS in src/lib/database.ts).
CREATE TABLE IF NOT EXISTS photo_colors (
  photo_id bigint PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  hues real[12] NOT NULL CHECK (array_length(hues, 1) = 12),
  palette_hex text[] NOT NULL,
  palette_share real[] NOT NULL
    CHECK (cardinality(palette_share) = cardinality(palette_hex)),
  colorfulness real NOT NULL,
  chroma real NOT NULL,
  luminance real NOT NULL,
  monochrome boolean NOT NULL,
  center_sigma real NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The Couleurs page and MCP list the photos holding a color by share, most
-- first (keyset on share, photo_id), and the photos in a tone by
-- colorfulness (black and white by chroma): one partial index per hue over
-- the photos holding it, written with the same expression and predicate as
-- colorRank in src/lib/database.ts (a query only uses a partial expression
-- index when it names both).
CREATE INDEX IF NOT EXISTS idx_photo_colors_red
  ON photo_colors ((hues[1]), photo_id) WHERE hues[1] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_orange
  ON photo_colors ((hues[2]), photo_id) WHERE hues[2] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_yellow
  ON photo_colors ((hues[3]), photo_id) WHERE hues[3] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_green
  ON photo_colors ((hues[4]), photo_id) WHERE hues[4] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_teal
  ON photo_colors ((hues[5]), photo_id) WHERE hues[5] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_blue
  ON photo_colors ((hues[6]), photo_id) WHERE hues[6] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_purple
  ON photo_colors ((hues[7]), photo_id) WHERE hues[7] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_pink
  ON photo_colors ((hues[8]), photo_id) WHERE hues[8] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_brown
  ON photo_colors ((hues[9]), photo_id) WHERE hues[9] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_black
  ON photo_colors ((hues[10]), photo_id) WHERE hues[10] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_grey
  ON photo_colors ((hues[11]), photo_id) WHERE hues[11] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_white
  ON photo_colors ((hues[12]), photo_id) WHERE hues[12] >= 0.03::real;
CREATE INDEX IF NOT EXISTS idx_photo_colors_colorfulness
  ON photo_colors (colorfulness, photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_colors_monochrome
  ON photo_colors (chroma, photo_id) WHERE monochrome;

-- Each folder's palette, the strip under its cover in folder listings: up to
-- 5 colors, swatches = [{"hex": "#rrggbb", "share": 0..1}], heaviest first,
-- shares summing to 1. Folded from its own photos' photo_colors palettes, or
-- when none of them is measured yet from every photo below it by path; a
-- folder with no measured photo has no row. Too slow to compute per listing
-- (seconds over the whole library), so computed offline: written only by
-- `npm run palettes` (scripts/folder-palettes.ts), which replaces the whole
-- content in one transaction. Run on the sync host after each sync and
-- during or after a worker "thumbs" pass.
CREATE TABLE IF NOT EXISTS folder_palettes (
  folder_id bigint PRIMARY KEY REFERENCES folders (id) ON DELETE CASCADE,
  swatches jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- A face the machine proposes as someone the owner named, and what became of
-- it. faces.person_id and faces.assignment stay the truth of who a face is;
-- this table is the review queue and its memory:
--   pending  -> shown to the owner ("À trier")
--   accepted -> the face is person_id's: faces.assignment is auto when the
--               similarity cleared the auto-accept threshold, manual when the
--               owner said yes
--   rejected -> the owner said no: never proposed again for this person
--               (faces.assignment = 'rejected' too when the face had no one,
--               which also keeps a faces re-run from replacing it)
-- similarity: highest cosine between this face and the faces that define the
-- person (seed, manual, and auto faces good enough to be cluster_eligible)
-- taken within 18 months of it; best_seed_face_id is that face and gap_days
-- the days between the two photos (all three NULL for a face the owner
-- decided on in the viewer without a proposal). decided_by: owner, auto (the threshold),
-- or agent (an AI that looked at the crop while calibrating the thresholds:
-- worth a second look). A child's face drifts with age: matching
-- within a window, then letting accepted faces extend it, follows her from
-- one age to the next where a single centroid would not.
CREATE TABLE IF NOT EXISTS face_candidates (
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  face_id bigint NOT NULL REFERENCES faces (id) ON DELETE CASCADE,
  similarity real,
  best_seed_face_id bigint REFERENCES faces (id) ON DELETE SET NULL,
  gap_days integer,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  decided_by text CHECK (decided_by IN ('owner', 'auto', 'agent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  PRIMARY KEY (person_id, face_id)
);

-- The review queue, best first; the PRIMARY KEY serves per-person lookups
CREATE INDEX IF NOT EXISTS idx_face_candidates_queue
  ON face_candidates (person_id, similarity DESC) WHERE status = 'pending';
-- Deleting a face (a faces re-run) finds its candidates without a scan
CREATE INDEX IF NOT EXISTS idx_face_candidates_face_id ON face_candidates (face_id);

-- A photo holds a person once, enforced: the expansion (worker CLI) and the
-- owner's review can decide at the same moment, and only one of them wins
CREATE UNIQUE INDEX IF NOT EXISTS idx_faces_person_once_per_photo
  ON faces (photo_id, person_id) WHERE assignment IN ('seed', 'manual', 'auto');
-- One person per name, whatever the case: "Suzie" typed twice is one person
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_name
  ON people (lower(name)) WHERE name IS NOT NULL;

-- What a photo shows, as a point in the space of a vision-language model
-- (task 'embed', worker/), for search by content: a text query embedded by
-- the same model's text tower lands near the photos it describes, in French
-- as in other languages. Computed on the app's 400 px thumbnail, never on the
-- original. embedding: L2-normalized; compare with <=> (cosine distance).
-- model names the space ("<weights>@<revision>"): vectors of two models never
-- compare, and the app only matches a query against photos of its model.
-- The HNSW index exists from the start: rows arrive a few per second, which
-- costs the index little, and search must work while the backfill runs.
-- With a WHERE clause or past ~40 rows, pgvector >= 0.8 needs
-- SET hnsw.iterative_scan = relaxed_order (and a larger hnsw.ef_search).
CREATE TABLE IF NOT EXISTS photo_embeddings (
  photo_id bigint PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  embedding halfvec(768) NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_embeddings_embedding
  ON photo_embeddings USING hnsw (embedding halfvec_cosine_ops);

-- Search queries already embedded, so a query asked again costs no request
-- to the embedder. The text tower runs on the worker machine behind HTTPS
-- (blaze-embedder), not in the app's serverless functions; the app writes
-- here what it answered. text: NFC, trimmed, single spaces, lower case,
-- accents kept. A new model means new photo vectors: empty this table with
-- them (TRUNCATE), or old rows find no photo of their model.
CREATE TABLE IF NOT EXISTS search_query_embeddings (
  text text PRIMARY KEY,
  embedding halfvec(768) NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

-- What a photo shows, as words (task 'tags', worker/): indoors or outdoors,
-- inside a vehicle, a screenshot, an animal, the beach, a birthday... The
-- vocabulary (tag names, French labels and search words, the threshold of
-- each tag) is db/tags.json, read by the app and the worker. A photo has a
-- tag when score >= its threshold. score: 0..1, from the photo's embedding
-- (photo_embeddings) and the vocabulary's text prompts, comparable within a
-- tag only. Rows under 0.05 are not stored, except intérieur and extérieur,
-- stored for every tagged photo. vocab_version: the db/tags.json version the
-- row was computed with; a new version tags every photo again, replacing its
-- rows.
CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id bigint NOT NULL REFERENCES photos (id) ON DELETE CASCADE,
  tag text NOT NULL,
  score real NOT NULL,
  vocab_version int NOT NULL,
  PRIMARY KEY (photo_id, tag)
);

CREATE INDEX IF NOT EXISTS photo_tags_tag_score ON photo_tags (tag, score DESC);

-- Folders the owner marked « pas une galerie photo »: storage only (books,
-- game sprites, album art). Each row covers the folder and everything below
-- it. Their photos stay browsable in Bibliothèque and findable by folder or
-- file name; everywhere else (timeline, map, colors, content search,
-- people, random picks) and in every worker task but thumbnails, they count
-- as absent. Nothing derived from them is deleted: faces, colors,
-- embeddings and descriptions stay, filtered out, and come back when the
-- row goes.
-- path: a folders.path, no leading or trailing slash, never the root.
-- key_like: the LIKE pattern of the keys below it, path's own wildcards
-- escaped. The one rule, for photos and folders alike: a photo is out when
--   p.s3_key LIKE ANY (ARRAY(SELECT key_like FROM excluded_folders))
-- and a folder when (f.path || '/') does (src/lib/database.ts
-- outOfGallery, worker/src/blaze_worker/gallery.py). "music" covers
-- music/... but not musique/ nor music-old/. A per-row filter, not an index
-- lookup: every list keeps its plan. With books, music and stepmania marked
-- (EXPLAIN ANALYZE, 2026-10-19), a page of the timeline or of Couleurs
-- costs the same, a scan of every photo (the timeline's months) ~13% more.
-- The ids of every folder below them (a range on folders.path) cost ~6 ms
-- per query to gather, and turned the Couleurs page into a 2 s plan.
CREATE TABLE IF NOT EXISTS excluded_folders (
  path text PRIMARY KEY
    CHECK (path <> '' AND left(path, 1) <> '/' AND right(path, 1) <> '/'),
  key_like text GENERATED ALWAYS AS (
    replace(replace(replace(path, '\', '\\'), '%', '\%'), '_', '\_') || '/%'
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Near-duplicates (task 'groups', worker/src/blaze_worker/groups.py): photos
-- of the gallery that hold the same picture (an exact copy, a resized or
-- re-encoded copy, an edit) or the same moment (a burst, a shot taken again
-- within seconds), stacked behind the best of them. Only photos in a stack of
-- two or more have a row. Each stack forms around one centre, and every
-- member is linked to that centre itself, so a slow series cannot chain.
-- group_id: the centre's photo id, an opaque key (the centre may be deleted
-- later; the others keep it). rank: 1 is the photo the stack proposes to keep,
-- by score (measures and the weights in groups.py); a list of photos shows,
-- of each stack, the member of lowest rank it keeps, so a filter that keeps
-- only some members shows the best of those. link: how the member is linked
-- to the centre ('centre' for the centre itself):
--   copy   same size in bytes, same dimensions, cosine >= 0.999;
--   burst  same camera (EXIF make and model), taken within 30 s;
--   raw    a burst of a camera's raw file and its JPEG;
--   bracket a burst at other exposures (EXIF exposure bias);
--   same   the same picture (identical once shrunk, or a resized copy
--          without camera data, of one shape).
-- copy_of: the lowest photo id among this photo's exact copies in the stack
-- (link copy, or the centre they are copies of); NULL when it has none. The
-- faces of exact copies are the same faces: the review queue decides them
-- together.
-- measures: what the score is made of (sharpness, pixels, bytes, clipped
-- share, faces, closed eyes, faces cut by the edge, face sharpness, smile,
-- sideways); score: the weighted sum within the stack, comparable within one
-- stack only. model: the rules and weights that made the row.
CREATE TABLE IF NOT EXISTS photo_groups (
  photo_id bigint PRIMARY KEY REFERENCES photos (id) ON DELETE CASCADE,
  group_id bigint NOT NULL,
  rank integer NOT NULL CHECK (rank >= 1),
  score real NOT NULL,
  link text NOT NULL CHECK (link IN ('centre', 'copy', 'burst', 'same', 'raw', 'bracket')),
  copy_of bigint,
  measures jsonb NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, rank)
);
-- raw (a camera's raw file and its JPEG) and bracket (one view at other
-- exposures) came after the table (2026-10-21): the check is widened once,
-- which no row can fail (the schema runs on every start: not again after)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'photo_groups_link_check'
      AND pg_get_constraintdef(oid) LIKE '%bracket%'
  ) THEN
    ALTER TABLE photo_groups DROP CONSTRAINT IF EXISTS photo_groups_link_check;
    ALTER TABLE photo_groups ADD CONSTRAINT photo_groups_link_check
      CHECK (link IN ('centre', 'copy', 'burst', 'same', 'raw', 'bracket'));
  END IF;
END $$;

-- One holder at a time for a worker that must not run twice: the groups
-- rebuild and the Grouper (task 'groups'). A lease its holder renews while
-- it runs and that lapses if it dies, not an advisory lock: behind the
-- pooler (transaction mode) each statement gets any server connection, so
-- a session lock stays on one of them, held for whoever comes next.
CREATE TABLE IF NOT EXISTS task_leases (
  task text PRIMARY KEY,
  owner text NOT NULL,
  expires_at timestamptz NOT NULL
);
