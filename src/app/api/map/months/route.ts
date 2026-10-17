import { NextResponse } from "next/server";
import { getMapMonths } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/** Photos with a GPS fix per month of date taken, oldest first */
export const GET = requireAuth(async function GET() {
  try {
    const months = await getMapMonths();
    return NextResponse.json(
      { success: true, months },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/map/months", error as Error, {
      method: "GET",
      path: "/api/map/months",
    });
    return NextResponse.json(
      { success: false, error: "map_months_failed" },
      { status: 500 },
    );
  }
});
