import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  CopiesRefused,
  previewAllCopies,
  trashAllCopies,
} from "@/lib/allCopies";
import { TRASH_BATCH } from "@/lib/trash";
import { badRequest, failure } from "@/app/api/_lib/people";
import { idList, jsonBody } from "@/app/api/_lib/ids";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

/** Only the choices made on screen are bounded; the server finds ALL copies. */
const choices = (value: unknown) =>
  Array.isArray(value) && value.length === 0 ? [] : idList(value, TRASH_BATCH);

export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const keep = choices(body?.keep);
  const skip = choices(body?.skip);
  if (
    !keep ||
    !skip ||
    (body?.action !== "preview" && body?.action !== "trash")
  )
    return badRequest("action (preview or trash), keep and skip are needed");
  const signature = body.signature;
  if (
    body.action === "trash" &&
    (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature))
  )
    return badRequest("The preview signature is needed");
  try {
    const result =
      body.action === "preview"
        ? await previewAllCopies({ keep, skip })
        : await trashAllCopies({ keep, skip }, signature as string);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof CopiesRefused)
      return NextResponse.json(
        { success: false, code: error.code, error: error.message },
        { status: 409 },
      );
    return failure(error, { method: "POST", path: "/api/stacks/copies" });
  }
});
