import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import { normalizeTextForSearch } from "@/lib/textUtils";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const searchQuery = searchParams.get("q");

    if (!searchQuery || searchQuery.trim() === "") {
      return NextResponse.json({
        success: true,
        photos: [],
        folders: [],
      });
    }

    const normalizedQuery = normalizeTextForSearch(searchQuery);
    const searchTerm = `%${normalizedQuery}%`;

    // Search photos by filename using ILIKE for case-insensitive search
    // PostgreSQL uses unaccent extension or we can use ILIKE for basic search
    const photoResult = await query(
      `
      SELECT
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.filename ILIKE $1
         OR f.name ILIKE $1
         OR f.path ILIKE $1
      ORDER BY p.filename
      LIMIT 50
    `,
      [searchTerm],
    );

    const photoResults = photoResult.rows;

    // Search folders by name or path
    const folderResult = await query(
      `
      SELECT
        *,
        CASE
          WHEN photo_count = 0 THEN false
          WHEN (SELECT COUNT(*) FROM photos WHERE folder_id = folders.id AND thumbnail_status = 'generated') = photo_count THEN true
          ELSE false
        END as thumbnails_generated
      FROM folders
      WHERE name ILIKE $1
         OR path ILIKE $1
      ORDER BY name
      LIMIT 20
    `,
      [searchTerm],
    );

    const folderResults = folderResult.rows;

    // Process photos with thumbnails and proper types
    const photosWithThumbnails = photoResults.map((photo: any) => ({
      ...photo,
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: `/api/photos/${photo.id}/thumbnail`,
      metadata: photo.metadata, // PostgreSQL JSONB is already parsed
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
      query: searchQuery,
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
});
