import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import type { AuditOperation } from "@/components/audit/types";

export const dynamic = "force-dynamic";

// One grouped query with the percentile computed per group (the shared
// getOperationAnalysis runs one extra query per operation). Success means
// status < 400, the same line the error rate draws.
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          success: false,
          error: "start_date and end_date parameters are required",
        },
        { status: 400 },
      );
    }

    if (isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)",
        },
        { status: 400 },
      );
    }

    const result = await query(
      `
      SELECT
        operation,
        COUNT(*)::int AS count,
        (COUNT(*) FILTER (WHERE status_code >= 400))::int AS error_count,
        AVG(duration_ms)::float8 AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
        MAX(duration_ms) AS max_duration_ms,
        COALESCE(SUM(bytes_transferred), 0)::float8 AS total_bytes
      FROM s3_audit_logs
      WHERE timestamp >= $1 AND timestamp <= $2
      GROUP BY operation
      ORDER BY count DESC
    `,
      [startDate, endDate],
    );

    const operations: AuditOperation[] = result.rows.map((row) => ({
      operation: row.operation,
      count: row.count,
      error_count: row.error_count,
      success_rate: row.count > 0 ? 1 - row.error_count / row.count : 1,
      avg_duration_ms: row.avg_duration_ms,
      p95_duration_ms: row.p95_duration_ms,
      max_duration_ms: row.max_duration_ms,
      total_bytes: row.total_bytes,
    }));

    return NextResponse.json({
      success: true,
      data: {
        operations,
        period: {
          start_date: startDate,
          end_date: endDate,
        },
      },
    });
  } catch (error) {
    console.error("[AUDIT API] Error getting operation analysis:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get operation analysis",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
