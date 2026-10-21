import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { keepFromStacks, TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";

export const dynamic = "force-dynamic";

/**
 * POST /api/stacks/keep { keep, expected }: « Garder celle-ci », for one
 * stack or a page of Doublons. Each photo of `keep` stays, the rest of its
 * stack goes to the Corbeille. When the stacks now hold another number of
 * photos to throw away than `expected` (what the owner was told), nothing
 * moves: 409 with the actual count.
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  const keep = idList(body?.keep, TRASH_BATCH);
  const expected = body?.expected;
  if (
    !keep ||
    typeof expected !== "number" ||
    !Number.isSafeInteger(expected) ||
    expected < 0
  )
    return badRequest(`keep (1 to ${TRASH_BATCH} ids) and expected are needed`);
  try {
    const result = await keepFromStacks(keep, expected);
    if (!result.ok)
      return NextResponse.json(
        {
          success: false,
          code: "STACKS_CHANGED",
          error: "Les piles ont changé : rien n’a été mis à la corbeille.",
          count: result.count,
        },
        { status: 409 },
      );
    return NextResponse.json({ success: true, trashed: result.trashed });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/stacks/keep" });
  }
});
