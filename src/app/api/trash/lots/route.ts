import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listLots } from "@/lib/trash";
import { failure } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/** GET /api/trash/lots: the lots of the Corbeille worth putting back whole, last first. */
export const GET = requireAuth(async function GET() {
  try {
    return NextResponse.json({ success: true, lots: await listLots() });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/trash/lots" });
  }
});
