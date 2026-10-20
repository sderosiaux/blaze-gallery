import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { TimelineCursor } from "@/lib/database";
import { getTimelinePhotos } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { filterNotes, listFilter } from "@/app/api/_lib/filter";
import { folderScope } from "@/app/api/_lib/scope";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * Photos by date taken, newest first.
 * `before` takes either a plain ISO date (photos strictly older) or the
 * opaque `next_before` of the previous page ("<ISO>|<id>", ties broken by id).
 * The filter parameters of lib/photoFilter.ts keep only the photos passing
 * them (`content`, `untagged`: what became of the words and the tags);
 * `folder` (a path) only those in it and below it.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limitParam = searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json(
      { success: false, error: `limit must be an integer in 1..${MAX_LIMIT}` },
      { status: 400 },
    );
  }

  const beforeParam = searchParams.get("before");
  const before = beforeParam ? parseCursor(beforeParam) : null;
  if (beforeParam && !before) {
    return NextResponse.json(
      {
        success: false,
        error: "before must be an ISO date or a next_before cursor",
      },
      { status: 400 },
    );
  }

  try {
    const list = await listFilter(request, folderScope(searchParams));
    if (!list.ok) return list.response;
    const photos = await getTimelinePhotos(before, limit, list.filter);
    const last = photos[photos.length - 1];
    const next_before =
      photos.length === limit && last?.metadata?.date_taken
        ? `${last.metadata.date_taken}|${last.id}`
        : null;

    return NextResponse.json({
      success: true,
      photos,
      next_before,
      ...filterNotes(list),
    });
  } catch (error) {
    logger.apiError("Error in GET /api/timeline", error as Error, {
      method: "GET",
      path: "/api/timeline",
    });
    return NextResponse.json(
      { success: false, error: "timeline_failed" },
      { status: 500 },
    );
  }
});

function parseCursor(value: string): TimelineCursor | null {
  const [datePart, idPart] = value.split("|");
  if (datePart === undefined) return null;
  const date = new Date(datePart);
  if (Number.isNaN(date.getTime())) return null;
  const dateTaken = date.toISOString();

  if (idPart === undefined) {
    // Strictly older than the date: any id compares below the max bigint
    return { dateTaken, id: Number.MAX_SAFE_INTEGER };
  }
  const id = Number(idPart);
  return Number.isSafeInteger(id) && id > 0 ? { dateTaken, id } : null;
}
