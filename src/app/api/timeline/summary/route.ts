import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getTimelineSummary } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { parseColorFilter } from "@/lib/colors";
import { positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/**
 * Photo count per month of date taken (newest first) and the library total;
 * with `color` / `tone` (and `person`), the months count only the photos
 * /api/timeline keeps for them.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const colors = parseColorFilter((key) =>
    request.nextUrl.searchParams.get(key),
  );
  if (!colors.ok) {
    return NextResponse.json(
      { success: false, error: colors.error },
      { status: 400 },
    );
  }
  const personParam = request.nextUrl.searchParams.get("person");
  const personId = personParam === null ? null : positiveId(personParam);
  if (personParam !== null && personId === null) {
    return NextResponse.json(
      { success: false, error: "person must be a person id" },
      { status: 400 },
    );
  }
  try {
    const summary = await getTimelineSummary(colors.value, personId);
    return NextResponse.json({ success: true, ...summary });
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
