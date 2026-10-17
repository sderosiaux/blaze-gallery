import { NextResponse } from "next/server";
import { getLibrarySummary } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/** Library totals and the year span of date taken, for the home header */
export const GET = requireAuth(async function GET() {
  try {
    const summary = await getLibrarySummary();
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    logger.apiError("Error in GET /api/library/summary", error as Error, {
      method: "GET",
      path: "/api/library/summary",
    });
    return NextResponse.json(
      { success: false, error: "library_summary_failed" },
      { status: 500 },
    );
  }
});
