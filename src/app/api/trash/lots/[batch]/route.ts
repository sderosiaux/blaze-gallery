import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listLotStacks } from "@/lib/trash";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

const PAGE = 24;

/**
 * GET /api/trash/lots/<lot>?after=<photo id>: the lot's photos still in the
 * Corbeille, each stack beside the photo kept in its place.
 */
export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { batch: string } },
) {
  const { batch } = params;
  const afterParam = request.nextUrl.searchParams.get("after");
  const after = afterParam === null ? null : positiveId(afterParam);
  if (afterParam !== null && after === null)
    return badRequest("after is a photo id");
  try {
    return NextResponse.json({
      success: true,
      ...(await listLotStacks(decodeURIComponent(batch), after, PAGE)),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/trash/lots/[batch]" });
  }
});
