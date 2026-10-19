import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getFolderByPath,
  getFolderExclusion,
  getFolders,
  getPhotosInFolder,
  updateFolderLastVisited,
} from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const GET = requireAuth(async function GET(
  _request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  try {
    const folderPath = params.path.join("/");
    const decodedPath = decodeURIComponent(folderPath);

    const folder = await getFolderByPath(decodedPath);

    if (!folder) {
      return NextResponse.json(
        { success: false, error: "Folder not found" },
        { status: 404 },
      );
    }

    // exclusion: the marked folder that puts this one out of the gallery
    // (itself or a parent), null when it is in the gallery
    const [subfolders, photos, exclusion] = await Promise.all([
      getFolders(decodedPath),
      getPhotosInFolder(folder.id),
      getFolderExclusion(decodedPath),
    ]);

    // No on-demand sync - rely on background full sync for up-to-date data

    // Update last_visited for this folder
    try {
      await updateFolderLastVisited(decodedPath);
    } catch (error) {
      // Don't fail the request if updating last_visited fails
      logger.apiError("Failed to update last_visited", error as Error, {
        folderPath: decodedPath,
      });
    }

    return NextResponse.json({
      success: true,
      folder,
      subfolders,
      photos,
      exclusion,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/folders/[...path]", error as Error, {
      method: "GET",
      path: "/api/folders/[...path]",
      folderPath: params.path.join("/"),
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
