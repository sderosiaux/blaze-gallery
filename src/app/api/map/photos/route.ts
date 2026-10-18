import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { TimelineCursor } from "@/lib/database";
import { countMapPhotos, getMapPhotos } from "@/lib/database";
import { parseBox, parsePeriod } from "@/lib/mapArea";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { parseColorFilter } from "@/lib/colors";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/**
 * Photos taken inside the box (`south`, `west`, `north`, `east`, degrees)
 * and the period (`from`, `to`: YYYY-MM or YYYY-MM-DD, optional), newest
 * first, in the timeline's shape; with `color` / `tone`, only the photos
 * holding that color, in that tone. Without `after`: the first page and
 * `total`. With `after` set to the previous page's `next_after`: the next
 * page only.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const get = (key: string) => searchParams.get(key);

  const box = parseBox(get, {
    south: "south",
    west: "west",
    north: "north",
    east: "east",
  });
  if (!box.ok) return badRequest(box.error);
  if (!box.value) return badRequest("south, west, north, east are required");

  const period = parsePeriod(get);
  if (!period.ok) return badRequest(period.error);

  const colors = parseColorFilter(get);
  if (!colors.ok) return badRequest(colors.error);

  const afterParam = get("after");
  const after = afterParam ? parseCursor(afterParam) : null;
  if (afterParam && !after)
    return badRequest("after must be a next_after cursor");

  try {
    const [photos, total] = await Promise.all([
      getMapPhotos(box.value, period.value, after, PAGE_SIZE, colors.value),
      after ? null : countMapPhotos(box.value, period.value, colors.value),
    ]);
    const last = photos[photos.length - 1];
    const next_after =
      photos.length === PAGE_SIZE && last?.metadata?.date_taken
        ? `${last.metadata.date_taken}|${last.id}`
        : null;

    return NextResponse.json({
      success: true,
      photos,
      next_after,
      ...(total === null ? {} : { total }),
    });
  } catch (error) {
    logger.apiError("Error in GET /api/map/photos", error as Error, {
      method: "GET",
      path: "/api/map/photos",
    });
    return NextResponse.json(
      { success: false, error: "map_photos_failed" },
      { status: 500 },
    );
  }
});

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

/** "<ISO date taken>|<id>", as written in next_after */
function parseCursor(value: string): TimelineCursor | null {
  const [datePart, idPart, ...rest] = value.split("|");
  if (datePart === undefined || idPart === undefined || rest.length > 0)
    return null;
  const date = new Date(datePart);
  if (Number.isNaN(date.getTime())) return null;
  const id = Number(idPart);
  return Number.isSafeInteger(id) && id > 0
    ? { dateTaken: date.toISOString(), id }
    : null;
}
