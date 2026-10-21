import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { previewKeep } from "@/lib/keep";
import { TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";

export const dynamic = "force-dynamic";

/**
 * POST /api/stacks/keep/preview { keep }: what « Garder » would throw
 * away, per photo kept: { going: { "<kept id>": [ids] } }. The photos of a
 * stack not linked to the one kept stay (lib/keep.ts). Writes nothing; the
 * keep call then sends these exact ids.
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  const keep = idList(body?.keep, TRASH_BATCH);
  if (!keep) return badRequest(`keep (1 to ${TRASH_BATCH} ids) is needed`);
  try {
    return NextResponse.json({ success: true, going: await previewKeep(keep) });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/stacks/keep/preview" });
  }
});
