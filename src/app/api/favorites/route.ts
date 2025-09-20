import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";

// Force dynamic rendering for routes using auth
export const dynamic = 'force-dynamic';

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const result = await query(`
      SELECT
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = true
      ORDER BY p.filename
    `);

    const favoritePhotos = result.rows;

    // Add thumbnail URLs
    const photosWithThumbnails = favoritePhotos.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata, // PostgreSQL JSONB is already parsed
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
});
