import { NextResponse } from "next/server";
import { getColorOverview } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

/** Photos per band of the Couleurs page: as many as its widest row shows. */
const PER_BAND = 12;

/**
 * The Couleurs page's bands: each color, then each tone, with its most
 * marked dated photos (`id`, `hex` its main palette color), and `coverage`
 * while the worker is still measuring.
 */
export const GET = requireAuth(async function GET() {
  try {
    const overview = await getColorOverview(PER_BAND);
    return NextResponse.json(
      { success: true, ...overview },
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
