import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { s3AuditLogger } from "@/lib/s3Audit";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    const groupBy =
      (searchParams.get("group_by") as "5min" | "hour" | "day") || "hour";

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          success: false,
          error: "start_date and end_date parameters are required",
        },
        { status: 400 },
      );
    }

    // Validate date format (basic check)
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

    const metrics = await s3AuditLogger.getPerformanceMetrics(
      startDate,
      endDate,
      groupBy,
    );

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        period: {
          start_date: startDate,
          end_date: endDate,
          group_by: groupBy,
        },
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
