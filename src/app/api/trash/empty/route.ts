import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { purgeTrash, PurgeRefused, storagePurgeStore } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { jsonBody } from "@/app/api/_lib/ids";

export const dynamic = "force-dynamic";
// A few photos, each a listing of versions and a delete per version: far from a function's limit
export const maxDuration = 60;

/** Photos erased per request: the page asks again until none is left. */
const BATCH = 10;

/**
 * POST /api/trash/empty { cutoff, expected }: « Vider la corbeille ».
 * Erases, BATCH at a time, the photos thrown away up to `cutoff` (when the
 * owner confirmed), refusing when they are more than `expected` (the
 * number the confirmation showed). Answers what is left; the page calls
 * again until nothing is. Storage refusing a file stops it there: 403 with
 * the same reason as before the Corbeille, the photo stays in it.
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const body = await jsonBody(request);
  const cutoff =
    typeof body?.cutoff === "string" ? new Date(body.cutoff) : null;
  const expected = body?.expected;
  if (
    !cutoff ||
    Number.isNaN(cutoff.getTime()) ||
    typeof expected !== "number" ||
    !Number.isSafeInteger(expected) ||
    expected < 0
  )
    return badRequest("cutoff (ISO date) and expected (a count) are needed");
  try {
    const report = await purgeTrash(storagePurgeStore(), {
      cutoff,
      expected,
      limit: BATCH,
    });
    if (report.refused)
      return NextResponse.json(
        {
          success: false,
          code:
            report.refused.status === 403
              ? "STORAGE_DELETE_FORBIDDEN"
              : "DELETE_FAILED",
          error:
            report.refused.status === 403
              ? "Le stockage refuse la suppression. La clé d’accès du serveur doit autoriser la liste, l’écriture et la suppression des fichiers."
              : "Une photo n’a pas pu être effacée. Réessayez.",
          purged: report.purged.length,
          remaining: report.remaining,
        },
        { status: report.refused.status === 403 ? 403 : 502 },
      );
    return NextResponse.json({
      success: true,
      purged: report.purged.length,
      remaining: report.remaining,
    });
  } catch (error) {
    if (error instanceof PurgeRefused)
      return NextResponse.json(
        {
          success: false,
          code: "MORE_THAN_EXPECTED",
          error:
            "La corbeille a changé depuis la confirmation. Rien n’a été effacé.",
        },
        { status: 409 },
      );
    return failure(error, { method: "POST", path: "/api/trash/empty" });
  }
});
