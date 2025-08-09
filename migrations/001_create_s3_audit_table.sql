-- S3 Audit Log Table Migration
-- This table stores all S3 API calls for performance monitoring and cost analysis

CREATE TABLE IF NOT EXISTS s3_audit_logs (
    id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Request details
    operation TEXT NOT NULL CHECK (operation IN (
        'ListBuckets', 'ListObjects', 'GetObject', 'HeadObject', 
        'PutObject', 'DeleteObject', 'GetBucketLocation', 'GetObjectMetadata',
        'DownloadFile', 'UploadFile', 'CreateMultipartUpload', 
        'UploadPart', 'CompleteMultipartUpload', 'AbortMultipartUpload'
    )),
    method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'HEAD')),
    endpoint TEXT NOT NULL,
    bucket TEXT NOT NULL,
    key TEXT, -- Object key (NULL for bucket-level operations)
    
    -- Performance metrics
    duration_ms INTEGER NOT NULL,
    status_code INTEGER NOT NULL,
    bytes_transferred INTEGER,
    
    -- Context information
    user_agent TEXT,
    ip_address TEXT,
    session_id TEXT,
    user_id TEXT,
    
    -- Response details
    error_message TEXT,
    cache_hit BOOLEAN DEFAULT FALSE,
    
    -- Cost estimation (optional)
    estimated_cost_usd REAL,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_s3_audit_timestamp ON s3_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_s3_audit_operation ON s3_audit_logs(operation);
CREATE INDEX IF NOT EXISTS idx_s3_audit_status_code ON s3_audit_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_s3_audit_bucket ON s3_audit_logs(bucket);
CREATE INDEX IF NOT EXISTS idx_s3_audit_duration ON s3_audit_logs(duration_ms);
CREATE INDEX IF NOT EXISTS idx_s3_audit_created_at ON s3_audit_logs(created_at);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_s3_audit_bucket_operation ON s3_audit_logs(bucket, operation);
CREATE INDEX IF NOT EXISTS idx_s3_audit_timestamp_operation ON s3_audit_logs(timestamp, operation);
CREATE INDEX IF NOT EXISTS idx_s3_audit_session_timestamp ON s3_audit_logs(session_id, timestamp);

-- Create a view for quick stats
CREATE VIEW IF NOT EXISTS s3_audit_stats_hourly AS
SELECT 
    datetime(timestamp, 'start of hour') as hour,
    operation,
    bucket,
    COUNT(*) as request_count,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    SUM(bytes_transferred) as total_bytes,
    SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
    SUM(CASE WHEN cache_hit = TRUE THEN 1 ELSE 0 END) as cache_hits,
    SUM(estimated_cost_usd) as total_cost_usd
FROM s3_audit_logs 
GROUP BY hour, operation, bucket
ORDER BY hour DESC;

-- Create a view for daily aggregation
CREATE VIEW IF NOT EXISTS s3_audit_stats_daily AS
SELECT 
    date(timestamp) as day,
    operation,
    bucket,
    COUNT(*) as request_count,
    AVG(duration_ms) as avg_duration_ms,
    MIN(duration_ms) as min_duration_ms,
    MAX(duration_ms) as max_duration_ms,
    SUM(bytes_transferred) as total_bytes,
    SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
    SUM(CASE WHEN cache_hit = TRUE THEN 1 ELSE 0 END) as cache_hits,
    SUM(estimated_cost_usd) as total_cost_usd
FROM s3_audit_logs 
GROUP BY day, operation, bucket
ORDER BY day DESC;