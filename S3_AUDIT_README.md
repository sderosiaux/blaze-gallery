# S3 Audit System

This system provides comprehensive auditing and performance monitoring for all S3 API calls in the Blaze Gallery application.

## Features

- **Complete Request Logging**: Tracks all S3 operations with timing, status codes, and data transfer amounts
- **Performance Analytics**: Monitors response times, error rates, and throughput
- **Cost Estimation**: Optional cost tracking for AWS S3 usage
- **Real-time Dashboard**: Web interface for monitoring S3 performance
- **Flexible Querying**: Filter logs by operation, time range, status codes, etc.
- **Automatic Cleanup**: Configurable retention policies for audit logs

## Database Schema

The audit system uses a SQLite table `s3_audit_logs` with the following structure:

```sql
- id (TEXT PRIMARY KEY)
- timestamp (DATETIME) 
- operation (TEXT) - S3 operation type (GetObject, ListObjects, etc.)
- method (TEXT) - HTTP method (GET, POST, PUT, DELETE, HEAD)
- endpoint (TEXT) - API endpoint called
- bucket (TEXT) - S3 bucket name
- key (TEXT) - S3 object key (optional)
- duration_ms (INTEGER) - Request duration in milliseconds
- status_code (INTEGER) - HTTP status code
- bytes_transferred (INTEGER) - Data transferred in bytes
- user_agent (TEXT) - Client user agent
- ip_address (TEXT) - Client IP address
- session_id (TEXT) - Session identifier
- user_id (TEXT) - User identifier
- error_message (TEXT) - Error details if failed
- cache_hit (BOOLEAN) - Whether served from cache
- estimated_cost_usd (REAL) - Estimated AWS cost
- created_at (DATETIME) - Record creation time
```

## API Endpoints

### GET /api/audit/logs
Query audit logs with filtering and pagination.

**Query Parameters:**
- `start_date` - ISO date string for start of time range
- `end_date` - ISO date string for end of time range  
- `operation` - Filter by S3 operation type
- `status_code` - Filter by HTTP status code
- `bucket` - Filter by bucket name
- `min_duration_ms` - Minimum request duration
- `max_duration_ms` - Maximum request duration
- `limit` - Number of records to return (max 1000)
- `offset` - Pagination offset
- `sort_by` - Sort field (timestamp, duration_ms, bytes_transferred)
- `sort_order` - Sort direction (asc, desc)

**Example:**
```bash
curl "/api/audit/logs?start_date=2024-01-01T00:00:00Z&operation=GetObject&limit=50"
```

### GET /api/audit/stats
Get aggregated statistics for the specified time range.

**Example Response:**
```json
{
  "success": true,
  "data": {
    "total_requests": 1250,
    "avg_duration_ms": 145.7,
    "total_bytes_transferred": 52428800,
    "requests_by_status": {
      "200": 1180,
      "404": 45,
      "500": 25
    },
    "requests_by_operation": {
      "GetObject": 800,
      "ListObjects": 350,
      "HeadObject": 100
    },
    "error_rate": 0.056,
    "cache_hit_rate": 0.23,
    "estimated_total_cost_usd": 0.75
  }
}
```

### GET /api/audit/performance
Get performance metrics grouped by time periods.

**Query Parameters:**
- `start_date` - Required ISO date string
- `end_date` - Required ISO date string
- `group_by` - Time grouping (hour, day)

### GET /api/audit/operations
Get operation analysis showing performance per operation type.

### DELETE /api/audit/logs
Clean up old audit logs.

**Query Parameters:**
- `retention_days` - Delete logs older than this many days

## Integration Guide

### 1. Add Audit Logging to Existing API Routes

```typescript
import { auditS3Operation } from '@/lib/s3AuditIntegration';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return await auditS3Operation(
    'GetObject',
    process.env.B2_BUCKET_NAME!,
    `photos/${params.id}`,
    request,
    async () => {
      // Your existing S3 operation here
      const photo = await s3Client.getObject({
        Bucket: bucket,
        Key: key
      });
      return photo;
    }
  );
}
```

### 2. Manual Logging

```typescript
import { createS3AuditMiddleware } from '@/lib/s3Audit';

const auditMiddleware = createS3AuditMiddleware();

export async function GET(request: Request) {
  const startTime = Date.now();
  
  try {
    // Your API logic here
    const result = await processRequest();
    
    // Log successful request
    await auditMiddleware.log({
      operation: 'GetObject',
      method: 'GET',
      endpoint: '/api/photos/123/thumbnail',
      bucket: 'my-bucket',
      key: 'photos/123.jpg',
      startTime,
      statusCode: 200,
      bytesTransferred: result.length,
      request
    });
    
    return new Response(result);
    
  } catch (error) {
    // Log failed request
    await auditMiddleware.log({
      operation: 'GetObject',
      method: 'GET', 
      endpoint: '/api/photos/123/thumbnail',
      bucket: 'my-bucket',
      key: 'photos/123.jpg',
      startTime,
      statusCode: 500,
      error: error.message,
      request
    });
    
    throw error;
  }
}
```

## Dashboard Usage

Access the audit dashboard at `/audit` to view:

- **Real-time Statistics**: Request counts, average response times, error rates
- **Operation Analysis**: Performance breakdown by operation type
- **Recent Activity**: Live feed of recent S3 requests
- **Performance Trends**: Time-series data (requires chart library integration)

**Features:**
- Auto-refresh every 30 seconds
- Configurable time ranges (1h, 6h, 24h, 7d)
- Real-time updates
- Responsive design

## Performance Considerations

1. **Database Size**: Audit logs can grow quickly. Use automatic cleanup:
   ```bash
   curl -X DELETE "/api/audit/logs?retention_days=30"
   ```

2. **Indexing**: The system includes optimized indexes for common queries:
   - `idx_s3_audit_timestamp` - Time-based queries
   - `idx_s3_audit_operation` - Operation filtering
   - `idx_s3_audit_bucket_operation` - Composite queries

3. **Batch Operations**: For high-volume applications, consider batching audit writes

## Cost Estimation

The system includes optional cost estimation for S3 operations:

```typescript
import { estimateS3Cost } from '@/lib/s3AuditIntegration';

const cost = estimateS3Cost('GetObject', bytesTransferred);
```

Cost factors include:
- Request charges ($0.0004-$0.005 per 1,000 requests)
- Data transfer costs ($0.09 per GB after first 1GB free)
- Regional pricing variations

## Environment Variables

```bash
DATABASE_PATH=/path/to/audit.db  # Optional, defaults to data/audit.db
```

## Dependencies

- `better-sqlite3` - Database operations
- `@types/better-sqlite3` - TypeScript definitions

Install with:
```bash
npm install better-sqlite3 @types/better-sqlite3
```

## Monitoring and Alerts

Consider setting up alerts for:
- Error rates > 5%
- Average response times > 2 seconds
- Unusual request patterns
- Cost thresholds

The audit data can be easily exported for external monitoring systems.