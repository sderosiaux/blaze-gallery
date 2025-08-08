import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q");

    if (!query || query.trim() === "") {
      return NextResponse.json({
        success: true,
        photos: [],
        folders: [],
      });
    }

    const database = getDatabase();

    // Search photos by filename
    const photoQuery = `
      SELECT 
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.filename LIKE ? OR f.name LIKE ? OR f.path LIKE ?
      ORDER BY p.created_at DESC
      LIMIT 50
    `;

    const searchTerm = `%${query}%`;
    const photoResults = database
      .prepare(photoQuery)
      .all(searchTerm, searchTerm, searchTerm);

    // Search folders by name or path
    const folderQuery = `
      SELECT 
        *,
        CASE 
          WHEN photo_count = 0 THEN 0
          WHEN (SELECT COUNT(*) FROM photos WHERE folder_id = folders.id AND thumbnail_status = 'generated') = photo_count THEN 1
          ELSE 0
        END as thumbnails_generated
      FROM folders
      WHERE name LIKE ? OR path LIKE ?
      ORDER BY name COLLATE NOCASE
      LIMIT 20
    `;

    const folderResults = database
      .prepare(folderQuery)
      .all(searchTerm, searchTerm);

    // Process photos with thumbnails and proper types
    const photosWithThumbnails = photoResults.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata ? JSON.parse(photo.metadata) : null,
    }));

    // Process folders with proper types
    const foldersProcessed = folderResults.map((folder: any) => ({
      ...folder,
      thumbnails_generated: Boolean(folder.thumbnails_generated),
    }));

    return NextResponse.json({
      success: true,
      photos: photosWithThumbnails,
      folders: foldersProcessed,
      query: query,
    });
  } catch (error) {
    logger.apiError("Error performing search", error as Error, {
      method: "GET",
      path: "/api/search",
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
