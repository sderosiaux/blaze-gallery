import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { s3AuditLogger } from "@/lib/s3Audit";
import type { AuditLogEntry, AuditLogPage } from "@/components/audit/types";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 1000;

// Newest first, only the columns the audit page shows (no IP or user agent),
// count and page fetched in parallel. The shared queryLogs also recomputes the
// summary stats on every call, three more round trips nobody reads here.
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    if (
      (startDate && isNaN(Date.parse(startDate))) ||
      (endDate && isNaN(Date.parse(endDate)))
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)",
        },
        { status: 400 },
      );
    }

    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1),
      MAX_LIMIT,
    );
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

    const conditions: string[] = [];
    const params: string[] = [];
    if (startDate) {
      params.push(startDate);
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      conditions.push(`timestamp <= $${params.length}`);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [countResult, rowsResult] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS count FROM s3_audit_logs ${whereClause}`,
        params,
      ),
      query(
        `
        SELECT id, timestamp, operation, method, endpoint, bucket, key,
               duration_ms, status_code,
               bytes_transferred::float8 AS bytes_transferred, error_message
        FROM s3_audit_logs ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
        params,
      ),
    ]);

    const logs: AuditLogEntry[] = rowsResult.rows.map((row) => ({
      id: String(row.id),
      timestamp: new Date(row.timestamp).toISOString(),
      operation: row.operation,
      method: row.method,
      endpoint: row.endpoint,
      bucket: row.bucket,
      key: row.key,
      duration_ms: row.duration_ms,
      status_code: row.status_code,
      bytes_transferred: row.bytes_transferred,
      error_message: row.error_message,
    }));
    const page: AuditLogPage = { logs, total_count: countResult.rows[0].count };

    return NextResponse.json({ success: true, data: page });
  } catch (error) {
    console.error("[AUDIT API] Error querying logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to query audit logs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});

export const DELETE = requireAuth(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const retentionDays = searchParams.get("retention_days");

    if (!retentionDays || isNaN(parseInt(retentionDays))) {
      return NextResponse.json(
        {
          success: false,
          error: "retention_days parameter is required and must be a number",
        },
        { status: 400 },
      );
    }

    const deletedCount = await s3AuditLogger.cleanupOldLogs(
      parseInt(retentionDays),
    );

    return NextResponse.json({
      success: true,
      data: {
        deleted_records: deletedCount,
        retention_days: parseInt(retentionDays),
      },
    });
  } catch (error) {
    console.error("[AUDIT API] Error cleaning up logs:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to cleanup audit logs",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
