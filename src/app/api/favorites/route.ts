import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const database = getDatabase();

    const stmt = database.prepare(`
      SELECT 
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = 1
      ORDER BY p.filename COLLATE NOCASE
    `);

    const favoritePhotos = stmt.all();

    // Add thumbnail URLs
    const photosWithThumbnails = favoritePhotos.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata ? JSON.parse(photo.metadata) : null,
    }));

    return NextResponse.json({
      success: true,
      photos: photosWithThumbnails,
    });
  } catch (error) {
    logger.apiError("Error fetching favorite photos", error as Error, {
      method: "GET",
      path: "/api/favorites",
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
