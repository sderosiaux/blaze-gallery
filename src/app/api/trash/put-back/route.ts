import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { putBack } from "@/lib/trash";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";
import { jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

const LOT = /^(owner|auto)-[A-Za-z0-9._]+-\d{8}T\d{6}Z-[0-9a-f]{4}$/;

/**
 * POST /api/trash/put-back { id, trashed_at, trashed_by, trash_batch,
 * trashed_for }: « Annuler » after « Restaurer celle-ci », the photo back in
 * the Corbeille with the marks the proof gave (lib/trash.ts putBack).
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const id = positiveId(body?.id);
  const at = typeof body?.trashed_at === "string" ? body.trashed_at : null;
  const by = body?.trashed_by ?? null;
  const batch = body?.trash_batch ?? null;
  const kept = body?.trashed_for ?? null;
  const keptId = kept === null ? null : positiveId(kept);
  if (
    id === null ||
    at === null ||
    Number.isNaN(Date.parse(at)) ||
    Date.parse(at) > Date.now() ||
    (by !== null && by !== "owner" && by !== "auto") ||
    (batch !== null && (typeof batch !== "string" || !LOT.test(batch))) ||
    (kept !== null && keptId === null)
  )
    return badRequest(
      "id, trashed_at (past ISO date), trashed_by, trash_batch and trashed_for as the proof gave them",
    );
  try {
    const back = await putBack({
      id,
      trashed_at: at,
      trashed_by: by,
      trash_batch: batch,
      trashed_for: keptId,
    });
    return NextResponse.json({ success: true, back });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/trash/put-back" });
  }
});
