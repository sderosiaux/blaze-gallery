import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getMapMonths } from "@/lib/database";
import { parseBox } from "@/lib/mapArea";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/**
 * Photos with a GPS fix per month of date taken, oldest first. With a box
 * (`south`, `west`, `north`, `east`), only the photos taken inside it: the
 * period brush then shows when that place was photographed.
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
    const months = await getMapMonths(box.value);
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
