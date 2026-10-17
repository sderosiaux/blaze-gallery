import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { warmFolderThumbnails } from "@/lib/folderWarmup";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
// Downloads an original (tens of MB for a panorama) and resizes it: well past
// a serverless platform's default timeout on a slow first render.
export const maxDuration = 60;

/**
 * POST /api/thumbnails/warm?folder=<path>[&after=<cursor>]
 * Builds the next batch of missing thumbnails of a folder (see folderWarmup).
 */
export const POST = requireAuth(async function POST(request: NextRequest) {
  const folder = request.nextUrl.searchParams.get("folder");
  if (folder === null) {
    return NextResponse.json(
      { success: false, error: "folder is required" },
      { status: 400 },
    );
  }
  try {
    const result = await warmFolderThumbnails(
      folder,
      request.nextUrl.searchParams.get("after"),
    );
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.apiError("Folder thumbnail warm-up failed", error as Error, {
      folderPath: folder,
    });
    return NextResponse.json(
      { success: false, error: "Warm-up failed" },
      { status: 500 },
    );
  }
});
