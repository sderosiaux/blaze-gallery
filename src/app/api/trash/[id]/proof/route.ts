import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { trashProof } from "@/lib/trash";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/**
 * GET /api/trash/:id/proof: a photo in the Corbeille beside the photo kept
 * in its place, and whether the bucket says they are the same file
 * (lib/trash.ts TrashProof). 404 when the photo is not in the Corbeille.
 */
export const GET = requireAuth(async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("Invalid photo ID");
  try {
    const proof = await trashProof(id);
    if (!proof)
      return NextResponse.json(
        { success: false, error: "Cette photo n’est pas dans la corbeille" },
        { status: 404 },
      );
    return NextResponse.json({ success: true, ...proof });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/trash/[id]/proof" });
  }
});
