import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { MAX_NAME_LENGTH, nameFace, unnameFace } from "@/lib/people";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/**
 * POST /api/faces/:id
 *   { action: "name", person_id }   this face is that person
 *   { action: "name", name }        this face is the person of that name (created if new)
 *   { action: "unname" }            "Pas cette personne": not who it was said to be
 * Naming answers `proposed`: look-alikes that joined the person's « À trier ».
 */
export const POST = requireAuth(async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const faceId = positiveId(params.id);
  if (faceId === null) return badRequest("invalid_face_id");
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null)
    return badRequest("body must be a JSON object");
  const {
    action,
    person_id: rawPerson,
    name,
  } = body as Record<string, unknown>;
  try {
    if (action === "unname") {
      await unnameFace(faceId);
      return NextResponse.json({ success: true });
    }
    if (action !== "name") return badRequest("action must be name or unname");
    if (rawPerson !== undefined) {
      const personId = positiveId(rawPerson);
      if (personId === null) return badRequest("invalid person_id");
      const named = await nameFace(faceId, { personId });
      return NextResponse.json({ success: true, ...named });
    }
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > MAX_NAME_LENGTH
    )
      return badRequest("give person_id or a name");
    const named = await nameFace(faceId, { name });
    return NextResponse.json({ success: true, ...named });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/faces/[id]" });
  }
});
