import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { restoreLot, restorePhotos, TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

/** POST /api/trash/restore { photo_ids }, { lot } or { all: true }: back in the gallery. */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const lot =
    typeof body?.lot === "string" && body.lot !== "" ? body.lot : null;
  const ids =
    lot !== null
      ? null
      : body?.all === true
        ? "all"
        : idList(body?.photo_ids, TRASH_BATCH);
  if (lot === null && !ids)
    return badRequest(
      `photo_ids must hold 1 to ${TRASH_BATCH} ids, or lot, or all: true`,
    );
  try {
    return NextResponse.json({
      success: true,
      restored:
        lot !== null ? await restoreLot(lot) : await restorePhotos(ids ?? []),
    });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/trash/restore" });
  }
});
