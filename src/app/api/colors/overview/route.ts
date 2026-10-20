import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getColorOverview } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { filterNotes, listFilter } from "@/app/api/_lib/filter";

export const dynamic = "force-dynamic";

/** Photos per band of the Couleurs page: as many as its widest row shows. */
const PER_BAND = 12;

/**
 * The Couleurs page's bands: each color, then each tone, with its most
 * marked dated photos (`id`, `hex` its main palette color) among those
 * passing the filter parameters (lib/photoFilter.ts; its own color and
 * tone aside), and `coverage` while the worker is still measuring.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const list = await listFilter(request);
    if (!list.ok) return list.response;
    const overview = await getColorOverview(PER_BAND, list.filter);
    return NextResponse.json(
      { success: true, ...overview, ...filterNotes(list) },
      // The worker adds colors as it goes: a minute old is fine.
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/colors/overview", error as Error, {
      method: "GET",
      path: "/api/colors/overview",
    });
    return NextResponse.json(
      { success: false, error: "colors_overview_failed" },
      { status: 500 },
    );
  }
});
