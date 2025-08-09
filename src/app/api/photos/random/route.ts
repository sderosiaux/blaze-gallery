import { NextRequest, NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "32");
    const maxLimit = Math.min(limit, 100); // Cap at 100 photos max

    const database = getDatabase();

    const stmt = database.prepare(`
      SELECT 
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      ORDER BY RANDOM()
      LIMIT ?
    `);

    const randomPhotos = stmt.all(maxLimit);

    // Add thumbnail URLs and parse metadata
    const photosWithThumbnails = randomPhotos.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata ? JSON.parse(photo.metadata) : null,
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
}