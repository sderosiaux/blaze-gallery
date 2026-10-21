import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  emptyCutoff,
  purgeTrash,
  PurgeRefused,
  storagePurgeStore,
  TRASH_DAYS,
} from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";
// A few photos, each a listing of versions and a delete per version: far from a function's limit
export const maxDuration = 60;

/** Photos erased per request: the page asks again until none is left. */
const BATCH = 10;

/**
 * POST /api/trash/empty { expected, cutoff?, all? }: « Vider la corbeille ».
 * Erases, BATCH at a time, what has waited TRASH_DAYS, up to `cutoff` when
 * given (never later); everything up to `cutoff` (the listing's time) only
 * with `all: true`. Refuses, 409, unless exactly `expected` are due (the
 * number the confirmation showed, then each answer's `remaining`). Answers
 * what is left; the page calls again until nothing is. Storage refusing a file stops it there: 403 with
 * the same reason as before the Corbeille, the photo stays in it. A purge
 * that stopped on a doubt (purgeTrash's `stopped`) answers 502 with it;
 * photos it left (`left`: written again, or without a file) are counted.
 */
const STOPPED = {
  listing:
    "Le stockage sert un fichier sans en lister les versions : rien n’a été effacé pour cette photo. Vérifiez la clé d’accès du serveur.",
  remains:
    "Le stockage garde des versions d’un fichier effacé : la photo reste dans la corbeille.",
  missing:
    "Plusieurs photos d’affilée n’ont aucun fichier dans le stockage : mauvais bucket ou mauvaise clé ? Rien n’a été effacé pour elles.",
} as const;

export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const given = typeof body?.cutoff === "string" ? new Date(body.cutoff) : null;
  const all = body?.all === true;
  const expected = body?.expected;
  if (
    (given !== null && Number.isNaN(given.getTime())) ||
    typeof expected !== "number" ||
    !Number.isSafeInteger(expected) ||
    expected < 0
  )
    return badRequest("expected (a count) is needed; cutoff is an ISO date");
  try {
    const cutoff = await emptyCutoff(given, all);
    if (cutoff === null)
      return badRequest(
        all
          ? "all needs the cutoff the listing showed, not later than now"
          : `without all, the cutoff is ${TRASH_DAYS} days ago or earlier`,
      );
    const report = await purgeTrash(storagePurgeStore(), {
      cutoff,
      expected,
      exact: true,
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
    if (report.stopped)
      return NextResponse.json(
        {
          success: false,
          code: "PURGE_STOPPED",
          error: STOPPED[report.stopped.reason],
          purged: report.purged.length,
          remaining: report.remaining,
        },
        { status: 502 },
      );
    return NextResponse.json({
      success: true,
      purged: report.purged.length,
      left: report.left.length,
      remaining: report.remaining,
    });
  } catch (error) {
    if (error instanceof PurgeRefused)
      return NextResponse.json(
        {
          success: false,
          code: "TRASH_CHANGED",
          error:
            "La corbeille a changé depuis la confirmation. Rien n’a été effacé.",
        },
        { status: 409 },
      );
    return failure(error, { method: "POST", path: "/api/trash/empty" });
  }
});
