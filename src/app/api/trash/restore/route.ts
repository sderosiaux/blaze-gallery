import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { restorePhotos, TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";

export const dynamic = "force-dynamic";

/** POST /api/trash/restore { photo_ids } or { all: true }: back in the gallery. */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  const ids = body?.all === true ? "all" : idList(body?.photo_ids, TRASH_BATCH);
  if (!ids)
    return badRequest(
      `photo_ids must hold 1 to ${TRASH_BATCH} ids, or all: true`,
    );
  try {
    return NextResponse.json({
      success: true,
      restored: await restorePhotos(ids),
    });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/trash/restore" });
  }
});
