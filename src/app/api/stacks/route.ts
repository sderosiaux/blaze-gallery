import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { listStacks, STACK_KINDS, type StackKind } from "@/lib/stacks";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

const PAGE = 24;

/**
 * GET /api/stacks?kind=all|copies|bursts&taken=&id=: the Doublons page, a
 * page of stacks newest first, each with its photos best first.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind = (params.get("kind") ?? "all") as StackKind;
  if (!STACK_KINDS.includes(kind))
    return badRequest("kind: all, copies or bursts");
  const taken = params.get("taken");
  const rawId = params.get("id");
  let after: { taken: string; id: number } | null = null;
  if (taken !== null || rawId !== null) {
    const id = positiveId(rawId);
    if (id === null || taken === null)
      return badRequest("taken and id go together");
    after = { taken, id };
  }
  try {
    return NextResponse.json({
      success: true,
      ...(await listStacks(kind, after, PAGE)),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/stacks" });
  }
});
