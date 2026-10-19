import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  excludeFolder,
  includeFolder,
  listExcludedFolders,
} from "@/lib/database";
import { normalizeFolderPath } from "@/lib/excludedFolders";
import { badRequest, failure } from "@/app/api/_lib/people";

export const dynamic = "force-dynamic";

/** GET /api/excluded-folders: the folders marked « pas une galerie photo », by path. */
export const GET = requireAuth(async function GET() {
  try {
    return NextResponse.json({
      success: true,
      folders: await listExcludedFolders(),
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/excluded-folders" });
  }
});

async function pathOf(request: NextRequest): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  const path =
    typeof body === "object" && body !== null && "path" in body
      ? body.path
      : undefined;
  return typeof path === "string" ? normalizeFolderPath(path) : null;
}

/** POST /api/excluded-folders { path }: marks the folder and everything below it; again, nothing changes. */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const path = await pathOf(request);
  if (path === null) return badRequest("path must name a folder");
  try {
    if (!(await excludeFolder(path))) {
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, path });
  } catch (error) {
    return failure(error, { method: "POST", path: "/api/excluded-folders" });
  }
});

/**
 * DELETE /api/excluded-folders { path }: puts a marked folder back in the
 * gallery; `removed` is false when it was not marked itself.
 */
export const DELETE = requireAuth(async function DELETE(request: NextRequest) {
  const path = await pathOf(request);
  if (path === null) return badRequest("path must name a folder");
  try {
    return NextResponse.json({
      success: true,
      path,
      removed: await includeFolder(path),
    });
  } catch (error) {
    return failure(error, {
      method: "DELETE",
      path: "/api/excluded-folders",
    });
  }
});
