import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listTrash, TRASH_BATCH, trashPhotos } from "@/lib/trash";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

const PAGE = 120;

/** GET /api/trash?after=<trashed_at>&id=<id>: the Corbeille, last thrown away first. */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const afterAt = params.get("after");
  const afterId = params.get("id");
  let after: { trashedAt: string; id: number } | null = null;
  if (afterAt !== null || afterId !== null) {
    const id = positiveId(afterId);
    if (id === null || afterAt === null || Number.isNaN(Date.parse(afterAt)))
      return badRequest("after and id go together");
    after = { trashedAt: afterAt, id };
  }
  try {
    return NextResponse.json({
      success: true,
      ...(await listTrash(after, PAGE)),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/trash" });
  }
});

/** POST /api/trash { photo_ids }: into the Corbeille; answers the ids just thrown away. */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const ids = idList(body?.photo_ids, TRASH_BATCH);
  if (!ids) return badRequest(`photo_ids must hold 1 to ${TRASH_BATCH} ids`);
  try {
    return NextResponse.json({
      success: true,
      trashed: await trashPhotos(ids),
    });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/trash" });
  }
});
