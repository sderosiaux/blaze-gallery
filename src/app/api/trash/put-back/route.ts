import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { putBack, type PutBackRefusal } from "@/lib/trash";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";
import { jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

const REFUSALS: Record<PutBackRefusal, { code: string; error: string }> = {
  expired: {
    code: "UNDO_EXPIRED",
    error: "Trop tard pour annuler : la photo reste dans la galerie.",
  },
  trashed: {
    code: "ALREADY_TRASHED",
    error: "Elle a été jetée à nouveau entre-temps : rien n’a changé.",
  },
  kept_gone: {
    code: "KEPT_GONE",
    error:
      "La photo gardée à sa place n’est plus visible : celle-ci reste dans la galerie.",
  },
  stack_empty: {
    code: "STACK_EMPTY",
    error:
      "Sa pile n’aurait plus de photo visible : elle reste dans la galerie.",
  },
  pass_running: {
    code: "PASS_RUNNING",
    error: "Une passe est en cours, réessayez dans un moment.",
  },
};

/**
 * POST /api/trash/put-back { id }: « Annuler » after « Restaurer celle-ci »,
 * the photo back in the Corbeille with the marks the server kept when it
 * was restored (lib/trash.ts putBack). Nothing else is read from the
 * request; a refusal answers 409 with its reason.
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const id = positiveId(body?.id);
  if (id === null) return badRequest("id (a photo) is needed");
  try {
    const result = await putBack(id);
    if (!result.ok)
      return NextResponse.json(
        { success: false, ...REFUSALS[result.refused] },
        { status: 409 },
      );
    return NextResponse.json({ success: true, back: true });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/trash/put-back" });
  }
});
