import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { decideFaces, pendingCandidates, type Decision } from "@/lib/people";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const MAX_BATCH = 200;
const DECISIONS: readonly Decision[] = ["accept", "reject", "undo"];

/** GET /api/people/:id/candidates?limit=: faces waiting for the owner, closest first. */
export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("invalid_person_id");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : positiveId(rawLimit);
  if (limit === null) return badRequest("invalid_limit");
  try {
    const page = await pendingCandidates(id, Math.min(limit, MAX_LIMIT));
    return NextResponse.json({ success: true, ...page });
  } catch (error) {
    return failure(error, {
      method: "GET",
      path: "/api/people/[id]/candidates",
    });
  }
});

/**
 * POST /api/people/:id/candidates { decision: accept | reject | undo, face_ids }
 * "C'est elle", "pas elle", or back to the queue; written at once. A yes
 * answers `proposed`: look-alikes that joined the queue.
 */
export const POST = requireAuth(async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("invalid_person_id");
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return badRequest("body must be a JSON object");
  const { decision, face_ids: rawIds } = body as Record<string, unknown>;
  const chosen = DECISIONS.find((d) => d === decision);
  if (!chosen) return badRequest("decision must be accept, reject or undo");
  if (
    !Array.isArray(rawIds) ||
    rawIds.length === 0 ||
    rawIds.length > MAX_BATCH
  )
    return badRequest(`face_ids must hold 1 to ${MAX_BATCH} ids`);
  const faceIds = rawIds.map(positiveId);
  if (faceIds.some((f) => f === null)) return badRequest("invalid face id");
  try {
    const ids = [...new Set(faceIds as number[])];
    const proposed = await decideFaces(id, ids, chosen);
    return NextResponse.json({
      success: true,
      decision: chosen,
      face_ids: ids,
      proposed,
    });
  } catch (error) {
    return failure(error, {
      method: "POST",
      path: "/api/people/[id]/candidates",
    });
  }
});
