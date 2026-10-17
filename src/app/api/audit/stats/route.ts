import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import type { AuditSummary } from "@/components/audit/types";
import { firstRow } from "@/app/api/_lib/db";
import { isInvalidDateParam } from "@/app/api/_lib/request";

interface SummaryRow {
  total_requests: number;
  error_count: number;
  avg_duration_ms: number | null;
  p95_duration_ms: number | null;
  total_bytes: number;
  estimated_cost_usd: number | null;
}

export const dynamic = "force-dynamic";

// One round trip for the headline numbers, p95 included (the shared
// calculateStats runs three queries and has no percentile).
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    if (isInvalidDateParam(startDate) || isInvalidDateParam(endDate)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid date format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)",
        },
        { status: 400 },
      );
    }

    const conditions: string[] = [];
    const params: string[] = [];
    const where = (clause: string, value: string | null) => {
      if (!value) return;
      params.push(value);
      conditions.push(`${clause} $${params.length}`);
    };
    where("timestamp >=", startDate);
    where("timestamp <=", endDate);
    where("operation =", searchParams.get("operation"));
    where("bucket =", searchParams.get("bucket"));
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await query<SummaryRow>(
      `
      SELECT
        COUNT(*)::int AS total_requests,
        (COUNT(*) FILTER (WHERE status_code >= 400))::int AS error_count,
        AVG(duration_ms)::float8 AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
        COALESCE(SUM(bytes_transferred), 0)::float8 AS total_bytes,
        SUM(estimated_cost_usd)::float8 AS estimated_cost_usd
      FROM s3_audit_logs ${whereClause}
    `,
      params,
    );

    const row = firstRow(result, "Audit summary");
    const summary: AuditSummary = {
      total_requests: row.total_requests,
      error_count: row.error_count,
      error_rate:
        row.total_requests > 0 ? row.error_count / row.total_requests : 0,
      avg_duration_ms: row.avg_duration_ms,
      p95_duration_ms: row.p95_duration_ms,
      total_bytes: row.total_bytes,
      estimated_cost_usd: row.estimated_cost_usd,
    };

    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    console.error("[AUDIT API] Error calculating stats:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to calculate audit stats",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
