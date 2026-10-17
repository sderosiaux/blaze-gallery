// Response shapes of /api/audit/*, shared by the routes and the audit page.
// Every number is a JS number: the routes cast Postgres bigint/numeric.

export interface AuditSummary {
  total_requests: number;
  error_count: number;
  /** Share of requests answered with a status >= 400, 0..1. */
  error_rate: number;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  total_bytes: number;
  /** Null when no request in the range carries a cost estimate. */
  estimated_cost_usd: number | null;
  /** Oldest logged request in the range: later than the range start when the log does not reach that far back. */
  first_request_at: string | null;
}

export interface AuditBucket {
  /** ISO start of the bucket. */
  time_period: string;
  request_count: number;
  error_count: number;
  bytes_transferred: number;
  /** Null when the bucket holds no request. */
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
}

export interface AuditSeries {
  bucket_seconds: number;
  /** One entry per bucket from start to end, empty buckets included. */
  metrics: AuditBucket[];
}

export interface AuditOperation {
  operation: string;
  count: number;
  error_count: number;
  /** Share of requests answered with a status < 400, 0..1. */
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  max_duration_ms: number;
  total_bytes: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation: string;
  method: string;
  endpoint: string;
  bucket: string;
  key: string | null;
  duration_ms: number;
  status_code: number;
  bytes_transferred: number | null;
  error_message: string | null;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  total_count: number;
}

export interface ThumbnailCoverage {
  total_photos: number;
  with_thumbnail: number;
  without_thumbnail: number;
  storage: { mode: "local" | "s3"; location: string };
}

export interface ThumbnailStorageScan {
  scanned_at: string;
  /** How long listing the storage took, in ms. */
  scan_ms: number;
  mode: "local" | "s3";
  location: string;
  directory_exists: boolean;
  file_count: number;
  total_bytes: number;
  oldest: string | null;
  newest: string | null;
  /** Photo records whose thumbnail file is not in storage. */
  missing: { count: number; sample: string[] };
  /** Files in storage that no photo record points to. */
  orphaned: { count: number; sample: string[] };
}
