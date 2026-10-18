import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPhotosByColor } from "@/lib/database";
import {
  formatRankCursor,
  hasColorFilter,
  parseColorFilter,
  parseRankCursor,
} from "@/lib/colors";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/**
 * Dated photos holding `color` (a hue of lib/colors.ts), most of it first,
 * or in `tone`, most colorful first; both: the color's photos in that tone.
 * In the timeline's shape plus `color_score`. With `after` set to the
 * previous page's `next_after`: the next page.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const get = (key: string) => request.nextUrl.searchParams.get(key);

  const colors = parseColorFilter(get);
  if (!colors.ok) return badRequest(colors.error);
  if (!hasColorFilter(colors.value))
    return badRequest("color or tone is required");

  const limitParam = get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    return badRequest(`limit must be an integer in 1..${MAX_LIMIT}`);

  const afterParam = get("after");
  const after = afterParam ? parseRankCursor(afterParam) : null;
  if (afterParam && !after)
    return badRequest("after must be a next_after cursor");

  try {
    const { photos, next } = await getPhotosByColor(
      colors.value,
      { from: null, to: null },
      after,
      limit,
    );
    return NextResponse.json({
      success: true,
      photos,
      next_after: next ? formatRankCursor(next) : null,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/colors", error as Error, {
      method: "GET",
      path: "/api/colors",
    });
    return NextResponse.json(
      { success: false, error: "colors_failed" },
      { status: 500 },
    );
  }
});

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
