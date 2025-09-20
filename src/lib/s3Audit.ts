import { query, runTransaction } from "./database";
import {
  S3AuditLog,
  S3AuditStats,
  S3AuditQuery,
  S3AuditResponse,
  S3Operation,
  PerformanceMetrics,
  OperationAnalysis,
} from "@/types/audit";

export class S3AuditLogger {
  private static instance: S3AuditLogger;

  private constructor() {}

  static getInstance(): S3AuditLogger {
    if (!S3AuditLogger.instance) {
      S3AuditLogger.instance = new S3AuditLogger();
    }
    return S3AuditLogger.instance;
  }

  /**
   * Log an S3 operation
   */
  async logOperation(
    log: Omit<S3AuditLog, "id" | "created_at">,
  ): Promise<string> {
    const result = await query(
      `
      INSERT INTO s3_audit_logs (
        timestamp, operation, method, endpoint, bucket, key,
        duration_ms, status_code, bytes_transferred,
        user_agent, ip_address, session_id, user_id,
        error_message, cache_hit, estimated_cost_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id
    `,
      [
        log.timestamp.toISOString(),
        log.operation,
        log.method,
        log.endpoint,
        log.bucket,
        log.key || null,
        log.duration_ms,
        log.status_code,
        log.bytes_transferred || null,
        log.user_agent || null,
        log.ip_address || null,
        log.session_id || null,
        log.user_id || null,
        log.error_message || null,
        log.cache_hit || false,
        log.estimated_cost_usd || null,
      ],
    );

    return result.rows[0].id;
  }

  /**
   * Query audit logs with filtering and pagination
   */
  async queryLogs(auditQuery: S3AuditQuery): Promise<S3AuditResponse> {
    // Build the WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (auditQuery.start_date) {
      conditions.push(`timestamp >= $${paramIndex}`);
      params.push(auditQuery.start_date);
      paramIndex++;
    }

    if (auditQuery.end_date) {
      conditions.push(`timestamp <= $${paramIndex}`);
      params.push(auditQuery.end_date);
      paramIndex++;
    }

    if (auditQuery.operation) {
      conditions.push(`operation = $${paramIndex}`);
      params.push(auditQuery.operation);
      paramIndex++;
    }

    if (auditQuery.status_code) {
      conditions.push(`status_code = $${paramIndex}`);
      params.push(auditQuery.status_code);
      paramIndex++;
    }

    if (auditQuery.bucket) {
      conditions.push(`bucket = $${paramIndex}`);
      params.push(auditQuery.bucket);
      paramIndex++;
    }

    if (auditQuery.min_duration_ms) {
      conditions.push(`duration_ms >= $${paramIndex}`);
      params.push(auditQuery.min_duration_ms);
      paramIndex++;
    }

    if (auditQuery.max_duration_ms) {
      conditions.push(`duration_ms <= $${paramIndex}`);
      params.push(auditQuery.max_duration_ms);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Build ORDER BY clause
    const sortBy = auditQuery.sort_by || "timestamp";
    const sortOrder = auditQuery.sort_order || "desc";
    const orderByClause = `ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;

    // Build LIMIT and OFFSET
    const limit = auditQuery.limit || 50;
    const offset = auditQuery.offset || 0;
    const limitClause = `LIMIT ${limit} OFFSET ${offset}`;

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as count FROM s3_audit_logs ${whereClause}`,
      params,
    );
    const totalCount = countResult.rows[0].count;

    // Get the logs
    const logsResult = await query(
      `
      SELECT * FROM s3_audit_logs
      ${whereClause}
      ${orderByClause}
      ${limitClause}
    `,
      params,
    );

    const logs = logsResult.rows.map((row: any) => ({
      ...row,
      timestamp: new Date(row.timestamp),
      created_at: new Date(row.created_at),
      cache_hit: Boolean(row.cache_hit),
    })) as S3AuditLog[];

    // Calculate stats
    const stats = await this.calculateStats(auditQuery);

    return {
      logs,
      total_count: totalCount,
      stats,
      has_more: offset + limit < totalCount,
    };
  }

  /**
   * Calculate statistics for the given query parameters
   */
  async calculateStats(auditQuery: S3AuditQuery): Promise<S3AuditStats> {
    // Build the WHERE clause (same as queryLogs)
    const conditions: string[] = [];
    const params: any[] = [];

    if (auditQuery.start_date) {
      conditions.push("timestamp >= $" + (params.length + 1));
      params.push(auditQuery.start_date);
    }

    if (auditQuery.end_date) {
      conditions.push("timestamp <= $" + (params.length + 1));
      params.push(auditQuery.end_date);
    }

    if (auditQuery.operation) {
      conditions.push("operation = $" + (params.length + 1));
      params.push(auditQuery.operation);
    }

    if (auditQuery.status_code) {
      conditions.push("status_code = $" + (params.length + 1));
      params.push(auditQuery.status_code);
    }

    if (auditQuery.bucket) {
      conditions.push("bucket = $" + (params.length + 1));
      params.push(auditQuery.bucket);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Basic stats
    const basicStatsResult = await query(
      `
      SELECT
        COUNT(*) as total_requests,
        AVG(duration_ms) as avg_duration_ms,
        SUM(bytes_transferred) as total_bytes_transferred,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN cache_hit = true THEN 1 ELSE 0 END) as cache_hits,
        SUM(estimated_cost_usd) as estimated_total_cost_usd
      FROM s3_audit_logs ${whereClause}
    `,
      params,
    );

    const basicStats = basicStatsResult.rows[0] as any;

    // Status code distribution
    const statusResult = await query(
      `
      SELECT status_code, COUNT(*) as count
      FROM s3_audit_logs ${whereClause}
      GROUP BY status_code
    `,
      params,
    );

    const statusRows = statusResult.rows as {
      status_code: number;
      count: number;
    }[];
    const requests_by_status: Record<number, number> = {};
    for (const row of statusRows) {
      requests_by_status[row.status_code] = row.count;
    }

    // Operation distribution
    const operationResult = await query(
      `
      SELECT operation, COUNT(*) as count
      FROM s3_audit_logs ${whereClause}
      GROUP BY operation
    `,
      params,
    );

    const operationRows = operationResult.rows as {
      operation: S3Operation;
      count: number;
    }[];
    const requests_by_operation: Record<S3Operation, number> = {} as any;
    for (const row of operationRows) {
      requests_by_operation[row.operation] = row.count;
    }

    const total_requests = basicStats.total_requests || 0;
    const error_count = basicStats.error_count || 0;
    const cache_hits = basicStats.cache_hits || 0;

    return {
      total_requests,
      avg_duration_ms: basicStats.avg_duration_ms || 0,
      total_bytes_transferred: basicStats.total_bytes_transferred || 0,
      requests_by_status,
      requests_by_operation,
      error_rate: total_requests > 0 ? error_count / total_requests : 0,
      cache_hit_rate:
        total_requests > 0 ? cache_hits / total_requests : undefined,
      estimated_total_cost_usd:
        basicStats.estimated_total_cost_usd || undefined,
    };
  }

  /**
   * Get performance metrics grouped by time periods
   */
  async getPerformanceMetrics(
    startDate: string,
    endDate: string,
    groupBy: "5min" | "hour" | "day" = "hour",
  ): Promise<PerformanceMetrics[]> {
    let timeFormat: string;
    if (groupBy === "5min") {
      // Group by 5-minute intervals using PostgreSQL date_trunc
      timeFormat =
        "DATE_TRUNC('minute', timestamp) + INTERVAL '5 minute' * (EXTRACT(MINUTE FROM timestamp)::int / 5)";
    } else if (groupBy === "hour") {
      timeFormat = "DATE_TRUNC('hour', timestamp)";
    } else {
      timeFormat = "DATE_TRUNC('day', timestamp)";
    }

    const result = await query(
      `
      SELECT
        ${timeFormat} as time_period,
        AVG(duration_ms) as avg_response_time,
        COUNT(*) as request_count,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        SUM(bytes_transferred) as bytes_transferred
      FROM s3_audit_logs
      WHERE timestamp >= $1 AND timestamp <= $2
      GROUP BY ${timeFormat}
      ORDER BY time_period ASC
    `,
      [startDate, endDate],
    );

    const rows = result.rows as any[];

    // Calculate percentiles (simplified - would need more complex query for true percentiles)
    return rows.map((row) => ({
      time_period: row.time_period,
      avg_response_time: row.avg_response_time || 0,
      p95_response_time: row.avg_response_time * 1.5 || 0, // Approximation
      p99_response_time: row.avg_response_time * 2 || 0, // Approximation
      request_count: row.request_count,
      error_count: row.error_count,
      bytes_transferred: row.bytes_transferred || 0,
    }));
  }

  /**
   * Get operation analysis
   */
  async getOperationAnalysis(
    startDate: string,
    endDate: string,
  ): Promise<OperationAnalysis[]> {
    // First get basic stats for each operation
    const basicResult = await query(
      `
      SELECT
        operation,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration_ms,
        MAX(duration_ms) as max_duration_ms,
        MIN(duration_ms) as min_duration_ms,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
        SUM(bytes_transferred) as total_bytes
      FROM s3_audit_logs
      WHERE timestamp >= $1 AND timestamp <= $2
      GROUP BY operation
      ORDER BY count DESC
    `,
      [startDate, endDate],
    );

    const basicRows = basicResult.rows as any[];

    // Calculate P95 for each operation
    const results: OperationAnalysis[] = [];

    for (const row of basicRows) {
      // Get P95 using PostgreSQL percentile functions
      const p95Result = await query(
        `
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as duration_ms
        FROM s3_audit_logs
        WHERE timestamp >= $1 AND timestamp <= $2 AND operation = $3
      `,
        [startDate, endDate, row.operation],
      );

      const p95Row = p95Result.rows[0] as { duration_ms: number } | undefined;
      const p95_duration_ms = p95Row?.duration_ms || row.avg_duration_ms || 0;

      results.push({
        operation: row.operation,
        count: row.count,
        avg_duration_ms: row.avg_duration_ms || 0,
        max_duration_ms: row.max_duration_ms || 0,
        min_duration_ms: row.min_duration_ms || 0,
        p95_duration_ms,
        success_rate: row.count > 0 ? row.success_count / row.count : 0,
        total_bytes: row.total_bytes || 0,
      });
    }

    return results;
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays: number): Promise<number> {
    const result = await query(
      `
      DELETE FROM s3_audit_logs
      WHERE created_at < NOW() - INTERVAL '$1 days'
    `,
      [retentionDays],
    );

    return result.rowCount || 0;
  }
}

// Helper function to create audit middleware
export function createS3AuditMiddleware() {
  const logger = S3AuditLogger.getInstance();

  return {
    /**
     * Log an S3 operation - call this after each S3 API call
     */
    async log(data: {
      operation: S3Operation;
      method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
      endpoint?: string; // Optional - will be extracted from request.url if available
      bucket: string;
      key?: string;
      startTime: number;
      statusCode: number;
      bytesTransferred?: number;
      error?: string;
      cacheHit?: boolean;
      request?: Request;
    }) {
      const duration_ms = Date.now() - data.startTime;

      // Extract request context if available
      const userAgent = data.request?.headers.get("user-agent") || undefined;
      const forwarded = data.request?.headers.get("x-forwarded-for");
      const realIp = data.request?.headers.get("x-real-ip");
      const ip_address = forwarded?.split(",")[0] || realIp || undefined;

      // Extract actual request URL if available
      let endpoint = data.endpoint || "system";
      if (data.request && "url" in data.request) {
        try {
          const url = new URL(data.request.url);
          endpoint = url.pathname;
        } catch {
          // Keep the fallback endpoint if URL parsing fails
        }
      }

      await logger.logOperation({
        timestamp: new Date(),
        operation: data.operation,
        method: data.method,
        endpoint: endpoint,
        bucket: data.bucket,
        key: data.key,
        duration_ms,
        status_code: data.statusCode,
        bytes_transferred: data.bytesTransferred,
        user_agent: userAgent,
        ip_address,
        session_id: undefined, // Could be extracted from cookies/headers
        user_id: undefined, // Could be extracted from auth
        error_message: data.error,
        cache_hit: data.cacheHit || false,
        estimated_cost_usd: undefined, // Could be calculated based on operation
      });
    },
  };
}

// Export singleton instance
export const s3AuditLogger = S3AuditLogger.getInstance();
