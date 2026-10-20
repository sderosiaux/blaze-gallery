import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTimelineSummary } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { filterNotes, listFilter } from "@/app/api/_lib/filter";
import { folderScope } from "@/app/api/_lib/scope";

export const dynamic = "force-dynamic";

/**
 * Photo count per month of date taken (newest first) and the library total;
 * with the filter parameters (and `folder`), the months count only the
 * photos /api/timeline keeps for them.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const list = await listFilter(
      request,
      folderScope(request.nextUrl.searchParams),
    );
    if (!list.ok) return list.response;
    const summary = await getTimelineSummary(list.filter);
    return NextResponse.json({
      success: true,
      ...summary,
      ...filterNotes(list),
    });
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
