import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "32");
    const maxLimit = Math.min(limit, 100); // Cap at 100 photos max

    const result = await query(`
      SELECT
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ORDER BY RANDOM()
      LIMIT $1
    `, [maxLimit]);

    const randomPhotos = result.rows;

    // Add thumbnail URLs and ensure proper data types
    const photosWithThumbnails = randomPhotos.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata, // PostgreSQL JSONB is already parsed
    }));

    return NextResponse.json({
      success: true,
      photos: photosWithThumbnails,
      count: photosWithThumbnails.length,
    });
  } catch (error) {
    logger.apiError("Error fetching random photos", error as Error, {
      method: "GET",
      path: "/api/photos/random",
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