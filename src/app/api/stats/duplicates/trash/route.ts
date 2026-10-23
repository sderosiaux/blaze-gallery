import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  DuplicatesRefused,
  previewDuplicates,
  trashDuplicates,
} from "@/lib/exactDuplicates";
import type { DuplicateSelection } from "@/lib/exactDuplicateTypes";
import { idList, jsonBody } from "@/app/api/_lib/ids";
import { badRequest, failure } from "@/app/api/_lib/people";
import { refusedOrigin } from "@/app/api/_lib/request";

export const dynamic = "force-dynamic";

export const POST = requireAuth(async function POST(request: NextRequest) {
  const foreign = refusedOrigin(request);
  if (foreign) return foreign;
  const body = await jsonBody(request);
  const keep =
    Array.isArray(body?.keep) && body.keep.length === 0
      ? []
      : idList(body?.keep, 5000);
  if (
    !body ||
    (body.kind !== "files" && body.kind !== "folders") ||
    (body.action !== "preview" && body.action !== "trash") ||
    !keep ||
    typeof body.group !== "string" ||
    (body.group !== "all" && !/^[0-9a-f]{32}$/.test(body.group)) ||
    !Array.isArray(body.skip) ||
    body.skip.length > 5000 ||
    body.skip.some(
      (key: unknown) => typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key),
    )
  )
    return badRequest("Invalid duplicate selection");
  const selection: DuplicateSelection = {
    kind: body.kind,
    group: body.group,
    keep,
    skip: body.skip as string[],
  };
  const signature = body.signature;
  if (
    body.action === "trash" &&
    (typeof signature !== "string" || !/^[0-9a-f]{64}$/.test(signature))
  )
    return badRequest("The preview signature is needed");
  try {
    const result =
      body.action === "preview"
        ? await previewDuplicates(selection)
        : await trashDuplicates(selection, signature as string);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof DuplicatesRefused)
      return NextResponse.json(
        { success: false, code: error.code, error: error.message },
        { status: 409 },
      );
    return failure(error, {
      method: "POST",
      path: "/api/stats/duplicates/trash",
    });
  }
});
