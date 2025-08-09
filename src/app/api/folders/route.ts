import { NextRequest, NextResponse } from "next/server";
import {
  getFolders,
  getPhotosInFolder,
  updateFolderLastVisited,
} from "@/lib/database";
import { syncService } from "@/lib/sync";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const parentPath = searchParams.get("parent");

    const folders = await getFolders(parentPath || undefined);

    let photos: any[] = [];
    if (!parentPath) {
      const rootFolders = folders.filter((f) => !f.parent_id);
      if (rootFolders.length === 0) {
        const rootPhotos = await getPhotosInFolder(0);
        photos = rootPhotos;
      }
    }

    // No on-demand sync - rely on background full sync for up-to-date data

    // Update last_visited for root folder browsing
    if (!parentPath) {
      try {
        await updateFolderLastVisited("");
      } catch (error) {
        // Don't fail the request if updating last_visited fails
        logger.apiError(
          "Failed to update last_visited for root",
          error as Error,
        );
      }
    }

    return NextResponse.json({
      success: true,
      folders,
      photos,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/folders", error as Error, {
      method: "GET",
      path: "/api/folders",
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
