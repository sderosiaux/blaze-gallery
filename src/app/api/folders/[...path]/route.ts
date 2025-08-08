import { NextRequest, NextResponse } from "next/server";
import {
  getFolderByPath,
  getFolders,
  getPhotosInFolder,
  updateFolderLastVisited,
} from "@/lib/database";
import { syncService } from "@/lib/sync";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
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

    const [subfolders, photos] = await Promise.all([
      getFolders(decodedPath),
      getPhotosInFolder(folder.id),
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
}
