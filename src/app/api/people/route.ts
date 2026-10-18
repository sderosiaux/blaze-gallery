import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createPerson, listPeople } from "@/lib/people";
import { badRequest, failure } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/** GET /api/people: the named people, most photographed first. */
export const GET = requireAuth(async function GET() {
  try {
    return NextResponse.json({ success: true, people: await listPeople() });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/people" });
  }
});

/** POST /api/people { name }: a new person, birth date unknown. */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const name =
    typeof body === "object" && body !== null && "name" in body
      ? body.name
      : undefined;
  if (typeof name !== "string") return badRequest("name must be a string");
  try {
    const person = await createPerson(name);
    return NextResponse.json({ success: true, person }, { status: 201 });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/people" });
  }
});
