import { getDatabase } from './database';
import { 
  S3AuditLog, 
  S3AuditStats, 
  S3AuditQuery, 
  S3AuditResponse,
  S3Operation,
  PerformanceMetrics,
  OperationAnalysis
} from '@/types/audit';

export class S3AuditLogger {
  private static instance: S3AuditLogger;
  
  private constructor() {
    this.initializeAuditTables();
  }
  
  static getInstance(): S3AuditLogger {
    if (!S3AuditLogger.instance) {
      S3AuditLogger.instance = new S3AuditLogger();
    }
    return S3AuditLogger.instance;
  }
  
  private initializeAuditTables() {
    const db = getDatabase();
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS s3_audit_logs (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        -- Request details
        operation TEXT NOT NULL CHECK (operation IN (
          'ListBuckets', 'ListObjects', 'GetObject', 'HeadObject', 
          'PutObject', 'DeleteObject', 'GetBucketLocation', 'GetObjectMetadata',
          'GeneratePresignedUrl', 'DownloadFile', 'UploadFile', 'CreateMultipartUpload', 
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
    `);
  }
  
  /**
   * Log an S3 operation
   */
  async logOperation(log: Omit<S3AuditLog, 'id' | 'created_at'>): Promise<string> {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO s3_audit_logs (
        timestamp, operation, method, endpoint, bucket, key,
        duration_ms, status_code, bytes_transferred,
        user_agent, ip_address, session_id, user_id,
        error_message, cache_hit, estimated_cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `);
    
    const result = stmt.get(
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
      log.cache_hit ? 1 : 0,
      log.estimated_cost_usd || null
    ) as { id: string };
    
    return result.id;
  }
  
  /**
   * Query audit logs with filtering and pagination
   */
  async queryLogs(query: S3AuditQuery): Promise<S3AuditResponse> {
    const db = getDatabase();
    
    // Build the WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (query.start_date) {
      conditions.push('timestamp >= ?');
      params.push(query.start_date);
    }
    
    if (query.end_date) {
      conditions.push('timestamp <= ?');
      params.push(query.end_date);
    }
    
    if (query.operation) {
      conditions.push('operation = ?');
      params.push(query.operation);
    }
    
    if (query.status_code) {
      conditions.push('status_code = ?');
      params.push(query.status_code);
    }
    
    if (query.bucket) {
      conditions.push('bucket = ?');
      params.push(query.bucket);
    }
    
    if (query.min_duration_ms) {
      conditions.push('duration_ms >= ?');
      params.push(query.min_duration_ms);
    }
    
    if (query.max_duration_ms) {
      conditions.push('duration_ms <= ?');
      params.push(query.max_duration_ms);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Build ORDER BY clause
    const sortBy = query.sort_by || 'timestamp';
    const sortOrder = query.sort_order || 'desc';
    const orderByClause = `ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    
    // Build LIMIT and OFFSET
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    const limitClause = `LIMIT ${limit} OFFSET ${offset}`;
    
    // Get total count
    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM s3_audit_logs ${whereClause}`);
    const totalCount = (countStmt.get(...params) as { count: number }).count;
    
    // Get the logs
    const logsStmt = db.prepare(`
      SELECT * FROM s3_audit_logs 
      ${whereClause} 
      ${orderByClause} 
      ${limitClause}
    `);
    
    const logs = logsStmt.all(...params).map((row: any) => ({
      ...row,
      timestamp: new Date(row.timestamp),
      created_at: new Date(row.created_at),
      cache_hit: Boolean(row.cache_hit)
    })) as S3AuditLog[];
    
    // Calculate stats
    const stats = await this.calculateStats(query);
    
    return {
      logs,
      total_count: totalCount,
      stats,
      has_more: (offset + limit) < totalCount
    };
  }
  
  /**
   * Calculate statistics for the given query parameters
   */
  async calculateStats(query: S3AuditQuery): Promise<S3AuditStats> {
    const db = getDatabase();
    
    // Build the WHERE clause (same as queryLogs)
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (query.start_date) {
      conditions.push('timestamp >= ?');
      params.push(query.start_date);
    }
    
    if (query.end_date) {
      conditions.push('timestamp <= ?');
      params.push(query.end_date);
    }
    
    if (query.operation) {
      conditions.push('operation = ?');
      params.push(query.operation);
    }
    
    if (query.status_code) {
      conditions.push('status_code = ?');
      params.push(query.status_code);
    }
    
    if (query.bucket) {
      conditions.push('bucket = ?');
      params.push(query.bucket);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Basic stats
    const basicStatsStmt = db.prepare(`
      SELECT 
        COUNT(*) as total_requests,
        AVG(duration_ms) as avg_duration_ms,
        SUM(bytes_transferred) as total_bytes_transferred,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
        SUM(estimated_cost_usd) as estimated_total_cost_usd
      FROM s3_audit_logs ${whereClause}
    `);
    
    const basicStats = basicStatsStmt.get(...params) as any;
    
    // Status code distribution
    const statusStmt = db.prepare(`
      SELECT status_code, COUNT(*) as count 
      FROM s3_audit_logs ${whereClause} 
      GROUP BY status_code
    `);
    
    const statusRows = statusStmt.all(...params) as { status_code: number; count: number }[];
    const requests_by_status: Record<number, number> = {};
    for (const row of statusRows) {
      requests_by_status[row.status_code] = row.count;
    }
    
    // Operation distribution
    const operationStmt = db.prepare(`
      SELECT operation, COUNT(*) as count 
      FROM s3_audit_logs ${whereClause} 
      GROUP BY operation
    `);
    
    const operationRows = operationStmt.all(...params) as { operation: S3Operation; count: number }[];
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
      cache_hit_rate: total_requests > 0 ? cache_hits / total_requests : undefined,
      estimated_total_cost_usd: basicStats.estimated_total_cost_usd || undefined
    };
  }
  
  /**
   * Get performance metrics grouped by time periods
   */
  async getPerformanceMetrics(
    startDate: string,
    endDate: string,
    groupBy: '5min' | 'hour' | 'day' = 'hour'
  ): Promise<PerformanceMetrics[]> {
    const db = getDatabase();
    
    let timeFormat: string;
    if (groupBy === '5min') {
      // Group by 5-minute intervals: floor minutes to nearest 5
      timeFormat = "strftime('%Y-%m-%d %H:', timestamp) || printf('%02d:00', (CAST(strftime('%M', timestamp) AS INTEGER) / 5) * 5)";
    } else if (groupBy === 'hour') {
      timeFormat = "strftime('%Y-%m-%d %H:00:00', timestamp)";
    } else {
      timeFormat = "date(timestamp)";
    }
    
    const stmt = db.prepare(`
      SELECT 
        ${timeFormat} as time_period,
        AVG(duration_ms) as avg_response_time,
        COUNT(*) as request_count,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        SUM(bytes_transferred) as bytes_transferred
      FROM s3_audit_logs 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY ${timeFormat}
      ORDER BY time_period DESC
    `);
    
    const rows = stmt.all(startDate, endDate) as any[];
    
    // Calculate percentiles (simplified - would need more complex query for true percentiles)
    return rows.map(row => ({
      time_period: row.time_period,
      avg_response_time: row.avg_response_time || 0,
      p95_response_time: row.avg_response_time * 1.5 || 0, // Approximation
      p99_response_time: row.avg_response_time * 2 || 0,   // Approximation
      request_count: row.request_count,
      error_count: row.error_count,
      bytes_transferred: row.bytes_transferred || 0
    }));
  }
  
  /**
   * Get operation analysis
   */
  async getOperationAnalysis(
    startDate: string,
    endDate: string
  ): Promise<OperationAnalysis[]> {
    const db = getDatabase();
    
    // First get basic stats for each operation
    const basicStmt = db.prepare(`
      SELECT 
        operation,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration_ms,
        MAX(duration_ms) as max_duration_ms,
        MIN(duration_ms) as min_duration_ms,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
        SUM(bytes_transferred) as total_bytes
      FROM s3_audit_logs 
      WHERE timestamp >= ? AND timestamp <= ?
      GROUP BY operation
      ORDER BY count DESC
    `);
    
    const basicRows = basicStmt.all(startDate, endDate) as any[];
    
    // Calculate P95 for each operation
    const results: OperationAnalysis[] = [];
    
    for (const row of basicRows) {
      // Get P95 using SQLite's built-in percentile functions (if available) or manual calculation
      const p95Stmt = db.prepare(`
        SELECT duration_ms
        FROM s3_audit_logs 
        WHERE timestamp >= ? AND timestamp <= ? AND operation = ?
        ORDER BY duration_ms
        LIMIT 1 OFFSET (
          SELECT CAST(COUNT(*) * 0.95 AS INTEGER) - 1
          FROM s3_audit_logs 
          WHERE timestamp >= ? AND timestamp <= ? AND operation = ?
        )
      `);
      
      const p95Row = p95Stmt.get(startDate, endDate, row.operation, startDate, endDate, row.operation) as { duration_ms: number } | undefined;
      const p95_duration_ms = p95Row?.duration_ms || row.avg_duration_ms || 0;
      
      results.push({
        operation: row.operation,
        count: row.count,
        avg_duration_ms: row.avg_duration_ms || 0,
        max_duration_ms: row.max_duration_ms || 0,
        min_duration_ms: row.min_duration_ms || 0,
        p95_duration_ms,
        success_rate: row.count > 0 ? row.success_count / row.count : 0,
        total_bytes: row.total_bytes || 0
      });
    }
    
    return results;
  }
  
  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs(retentionDays: number): Promise<number> {
    const db = getDatabase();
    const stmt = db.prepare(`
      DELETE FROM s3_audit_logs 
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    
    const result = stmt.run(retentionDays);
    return result.changes;
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
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
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
      const userAgent = data.request?.headers.get('user-agent') || undefined;
      const forwarded = data.request?.headers.get('x-forwarded-for');
      const realIp = data.request?.headers.get('x-real-ip');
      const ip_address = forwarded?.split(',')[0] || realIp || undefined;
      
      // Extract actual request URL if available
      let endpoint = data.endpoint || 'system';
      if (data.request && 'url' in data.request) {
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
        user_id: undefined,    // Could be extracted from auth
        error_message: data.error,
        cache_hit: data.cacheHit || false,
        estimated_cost_usd: undefined // Could be calculated based on operation
      });
    }
  };
}

// Export singleton instance
export const s3AuditLogger = S3AuditLogger.getInstance();