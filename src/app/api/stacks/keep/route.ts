import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { keepFromStacks, TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

/**
 * POST /api/stacks/keep { keep, trash }: « Garder celle-ci », for one
 * stack or the pages of Doublons shown. Each photo of `keep` stays, the
 * photos of its stack linked to it go to the Corbeille (preview: POST
 * /api/stacks/keep/preview). When those are no longer exactly `trash`
 * (what the owner saw), nothing moves: 409 with the number going now.
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const keep = idList(body?.keep, TRASH_BATCH);
  const trash = idList(body?.trash, TRASH_BATCH);
  if (!keep || !trash)
    return badRequest(
      `keep and trash (1 to ${TRASH_BATCH} ids each) are needed`,
    );
  try {
    const result = await keepFromStacks(keep, trash);
    if (result.passRunning)
      return NextResponse.json(
        {
          success: false,
          code: "PASS_RUNNING",
          error: "Une passe est en cours, réessayez dans un moment.",
        },
        { status: 409 },
      );
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
