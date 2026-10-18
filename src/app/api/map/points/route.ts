import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMapPoints } from "@/lib/database";
import { CELLS_PER_DEGREE, parsePeriod } from "@/lib/mapArea";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/**
 * Where the photos taken in the period (`from`, `to`: YYYY-MM or
 * YYYY-MM-DD, both optional and included) were taken: `points` holds
 * [latitude, longitude, count] per cell of `cell` degrees, at the mean
 * position of its photos.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const period = parsePeriod((key) => request.nextUrl.searchParams.get(key));
  if (!period.ok) {
    return NextResponse.json(
      { success: false, error: period.error },
      { status: 400 },
    );
  }

  try {
    const points = await getMapPoints(period.value);
    return NextResponse.json(
      { success: true, cell: 1 / CELLS_PER_DEGREE, points },
      // A sync adds photos now and then: a minute old is fine.
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/map/points", error as Error, {
      method: "GET",
      path: "/api/map/points",
    });
    return NextResponse.json(
      { success: false, error: "map_points_failed" },
      { status: 500 },
    );
  }
});
