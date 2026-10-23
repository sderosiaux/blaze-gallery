import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { listExactDuplicates } from "@/lib/exactDuplicates";
import type { DuplicateKind } from "@/lib/exactDuplicateTypes";
import { badRequest, failure } from "@/app/api/_lib/people";

export async function duplicateReport(
  request: NextRequest,
  kind: DuplicateKind,
) {
  const params = request.nextUrl.searchParams;
  const bytes = params.get("bytes");
  const key = params.get("key");
  if (
    (bytes !== null || key !== null) &&
    (bytes === null ||
      bytes.trim() === "" ||
      !Number.isFinite(Number(bytes)) ||
      Number(bytes) < 0 ||
      key === null ||
      !/^[0-9a-f]{32}$/.test(key))
  )
    return badRequest("Invalid duplicate cursor");
  try {
    const data = await listExactDuplicates(
      kind,
      bytes !== null && key !== null ? { bytes: Number(bytes), key } : null,
    );
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return failure(error, {
      method: "GET",
      path: `/api/stats/${kind === "files" ? "duplicates" : "duplicate-folders"}`,
    });
  }
}
