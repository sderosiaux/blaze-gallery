import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query, searchFolders } from "@/lib/database";
import { logger } from "@/lib/logger";
import { normalizeTextForSearch } from "@/lib/textUtils";
import type { PhotoWithFolderRow } from "@/app/api/_lib/db";
import { withThumbnailUrl } from "@/app/api/_lib/db";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const searchQuery = searchParams.get("q");

    if (!searchQuery || searchQuery.trim() === "") {
      return NextResponse.json({
        success: true,
        photos: [],
        photo_total: 0,
        folders: [],
      });
    }

    const normalizedQuery = normalizeTextForSearch(searchQuery);
    const searchTerm = `%${normalizedQuery}%`;

    // Photos match on their filename or on their folder; photo_total counts
    // every match so the UI can say how many the 50 shown are taken from
    const photoWhere = `
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.filename ILIKE $1
         OR f.name ILIKE $1
         OR f.path ILIKE $1`;

    const [photoResult, photoCount, folders] = await Promise.all([
      query<PhotoWithFolderRow>(
        `SELECT p.*, f.name as folder_name, f.path as folder_path
         ${photoWhere}
         ORDER BY p.filename
         LIMIT 50`,
        [searchTerm],
      ),
      query<{ total: number }>(`SELECT COUNT(*)::int AS total ${photoWhere}`, [
        searchTerm,
      ]),
      searchFolders(searchTerm),
    ]);

    // Process photos with thumbnails and proper types
    const photosWithThumbnails = photoResult.rows.map(withThumbnailUrl);

    return NextResponse.json({
      success: true,
      photos: photosWithThumbnails,
      photo_total: photoCount.rows[0]?.total,
      folders,
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
