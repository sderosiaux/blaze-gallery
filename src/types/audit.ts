// S3 Audit Types and Models

export interface S3AuditLog {
  id: string;
  timestamp: Date;

  // Request details
  operation: S3Operation;
  method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  endpoint: string;
  bucket: string;
  key?: string; // Object key (optional for bucket-level operations)

  // Performance metrics
  duration_ms: number;
  status_code: number;
  bytes_transferred?: number;

  // Context information
  user_agent?: string;
  ip_address?: string;
  session_id?: string;
  user_id?: string;

  // Response details
  error_message?: string;
  cache_hit?: boolean;

  // Cost estimation (optional)
  estimated_cost_usd?: number;

  created_at: Date;
}

export type S3Operation =
  | "ListBuckets"
  | "ListObjects"
  | "GetObject"
  | "HeadObject"
  | "PutObject"
  | "DeleteObject"
  | "GetBucketLocation"
  | "GetObjectMetadata"
  | "GeneratePresignedUrl"
  | "DownloadFile"
  | "UploadFile"
  | "CreateMultipartUpload"
  | "UploadPart"
  | "CompleteMultipartUpload"
  | "AbortMultipartUpload";

export interface S3AuditStats {
  total_requests: number;
  avg_duration_ms: number;
  total_bytes_transferred: number;
  requests_by_status: Record<number, number>;
  requests_by_operation: Record<S3Operation, number>;
  error_rate: number;
  cache_hit_rate?: number;
  estimated_total_cost_usd?: number;
}

export interface S3AuditQuery {
  start_date?: string;
  end_date?: string;
  operation?: S3Operation;
  status_code?: number;
  bucket?: string;
  min_duration_ms?: number;
  max_duration_ms?: number;
  limit?: number;
  offset?: number;
  sort_by?: "timestamp" | "duration_ms" | "bytes_transferred";
  sort_order?: "asc" | "desc";
}

export interface S3AuditResponse {
  logs: S3AuditLog[];
  total_count: number;
  stats: S3AuditStats;
  has_more: boolean;
}

// Performance analysis types
export interface PerformanceMetrics {
  time_period: string;
  avg_response_time: number;
  p95_response_time: number;
  p99_response_time: number;
  request_count: number;
  error_count: number;
  bytes_transferred: number;
}

export interface OperationAnalysis {
  operation: S3Operation;
  count: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  min_duration_ms: number;
  p95_duration_ms: number;
  success_rate: number;
  total_bytes: number;
}
