import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMapDates } from "@/lib/database";
import { parseBox } from "@/lib/mapArea";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/**
 * Photos with a GPS fix per date taken, oldest first: per day (`unit`
 * "day", `date` YYYY-MM-DD) when they span at most DAY_SPAN days, else per
 * month ("month", YYYY-MM). With a box (`south`, `west`, `north`, `east`),
 * only the photos taken inside it: the period brush then shows when that
 * place was photographed, a single trip day by day.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const get = (key: string) => request.nextUrl.searchParams.get(key);
  const box = parseBox(get, {
    south: "south",
    west: "west",
    north: "north",
    east: "east",
  });
  if (!box.ok)
    return NextResponse.json(
      { success: false, error: box.error },
      { status: 400 },
    );
  try {
    const { unit, dates } = await getMapDates(box.value);
    return NextResponse.json(
      { success: true, unit, dates },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/map/dates", error as Error, {
      method: "GET",
      path: "/api/map/dates",
    });
    return NextResponse.json(
      { success: false, error: "map_dates_failed" },
      { status: 500 },
    );
  }
});
