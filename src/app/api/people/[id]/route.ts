import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getPerson, personPhotos } from "@/lib/people";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/** GET /api/people/:id: the person and every photo of her, oldest first. */
export const GET = requireAuth(async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = positiveId(params.id);
  if (id === null) return badRequest("invalid_person_id");
  try {
    const person = await getPerson(id);
    if (!person) {
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      person,
      photos: await personPhotos(id),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/people/[id]" });
  }
});
