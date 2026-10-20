import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { personPhotoPage, type PersonPhotoCursor } from "@/lib/people";
import { decodeCursor, encodeCursor } from "@/app/api/_lib/cursor";
import { filterNotes, listFilter } from "@/app/api/_lib/filter";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";
import { isRecord } from "@/hooks/apiJson";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * GET /api/people/:id/photos: a page of the person's photos, newest first
 * (undated last), one per set of copies, passing the filter parameters of
 * lib/photoFilter.ts. Without `after`: the first page (from `year` and
 * older when given), `total` and the photos per year (`years`); with
 * `after` set to the previous page's `next`: the next page only.
 */
export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("invalid_person_id");
  const search = request.nextUrl.searchParams;
  const limitParam = search.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    return badRequest(`limit must be an integer in 1..${MAX_LIMIT}`);
  const afterParam = search.get("after");
  const after = afterParam ? decodeCursor(afterParam, toCursor) : null;
  if (afterParam && !after) return badRequest("after must be a next cursor");
  const yearParam = search.get("year");
  if (yearParam !== null && !/^\d{4}$/.test(yearParam))
    return badRequest("year must be YYYY");
  // From that year: after every photo taken from the next one on
  const start: PersonPhotoCursor | null =
    after ??
    (yearParam === null
      ? null
      : {
          taken: `${String(Number(yearParam) + 1)}-01-01T00:00:00.000Z`,
          id: Number.MAX_SAFE_INTEGER,
        });

  try {
    const list = await listFilter(request, { people: [id] });
    if (!list.ok) return list.response;
    const page = await personPhotoPage(id, list.filter, start, limit);
    return NextResponse.json({
      success: true,
      photos: page.photos,
      next: encodeCursor(page.next),
      ...(after ? {} : { total: page.total, years: page.years }),
      ...filterNotes(list),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/people/[id]/photos" });
  }
});

function toCursor(value: unknown): PersonPhotoCursor | null {
  if (!isRecord(value)) return null;
  const { taken, id } = value;
  return (taken === null ||
    (typeof taken === "string" && !Number.isNaN(Date.parse(taken)))) &&
    typeof id === "number" &&
    Number.isSafeInteger(id) &&
    id > 0
    ? { taken, id }
    : null;
}
