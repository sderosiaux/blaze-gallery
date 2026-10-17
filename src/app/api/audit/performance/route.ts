import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import type { AuditBucket, AuditSeries } from "@/components/audit/types";

export const dynamic = "force-dynamic";

const MIN_BUCKET_SECONDS = 60;
const MAX_BUCKETS = 1000;

// Buckets are epoch-aligned slices of `bucket_seconds`, with a real p95 per
// bucket. The shared getPerformanceMetrics truncated "5min" to the minute and
// then added minutes, which shifted samples by up to 55 minutes, and it
// approximated p95 as 1.5 x the average.
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

    const start = Date.parse(startDate);
    const end = Date.parse(endDate);
    if (isNaN(start) || isNaN(end) || end < start) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid date range. Use ISO 8601 dates (YYYY-MM-DDTHH:mm:ss.sssZ), start before end",
        },
        { status: 400 },
      );
    }

    const requested = Number(searchParams.get("bucket_seconds") ?? 3600);
    const bucketSeconds = Math.max(
      MIN_BUCKET_SECONDS,
      Math.round(requested) || MIN_BUCKET_SECONDS,
      Math.ceil((end - start) / 1000 / MAX_BUCKETS),
    );

    const result = await query(
      `
      SELECT
        to_timestamp(floor(extract(epoch FROM timestamp) / $3) * $3) AS time_period,
        COUNT(*)::int AS request_count,
        (COUNT(*) FILTER (WHERE status_code >= 400))::int AS error_count,
        COALESCE(SUM(bytes_transferred), 0)::float8 AS bytes_transferred,
        AVG(duration_ms)::float8 AS avg_duration_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms
      FROM s3_audit_logs
      WHERE timestamp >= $1 AND timestamp <= $2
      GROUP BY 1
      ORDER BY 1
    `,
      [startDate, endDate, bucketSeconds],
    );

    const byStart = new Map<number, AuditBucket>(
      result.rows.map((row) => [
        new Date(row.time_period).getTime(),
        {
          time_period: new Date(row.time_period).toISOString(),
          request_count: row.request_count,
          error_count: row.error_count,
          bytes_transferred: row.bytes_transferred,
          avg_duration_ms: row.avg_duration_ms,
          p95_duration_ms: row.p95_duration_ms,
        },
      ]),
    );

    // Empty buckets are part of the series: a gap in traffic is information.
    const step = bucketSeconds * 1000;
    const metrics: AuditBucket[] = [];
    for (let t = Math.floor(start / step) * step; t <= end; t += step) {
      metrics.push(
        byStart.get(t) ?? {
          time_period: new Date(t).toISOString(),
          request_count: 0,
          error_count: 0,
          bytes_transferred: 0,
          avg_duration_ms: null,
          p95_duration_ms: null,
        },
      );
    }

    const series: AuditSeries = { bucket_seconds: bucketSeconds, metrics };

    return NextResponse.json({
      success: true,
      data: {
        ...series,
        period: { start_date: startDate, end_date: endDate },
      },
    });
  } catch (error) {
    console.error("[AUDIT API] Error getting performance metrics:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get performance metrics",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
