import { NextResponse } from "next/server";
import { getTimelineSummary } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/** Photo count per month of date taken, newest month first */
export const GET = requireAuth(async function GET() {
  try {
    const months = await getTimelineSummary();
    return NextResponse.json({ success: true, months });
  } catch (error) {
    logger.apiError("Error in GET /api/timeline/summary", error as Error, {
      method: "GET",
      path: "/api/timeline/summary",
    });
    return NextResponse.json(
      { success: false, error: "timeline_summary_failed" },
      { status: 500 },
    );
  }
});
