import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { andInGallery, query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { PhotoWithFolderRow } from "@/app/api/_lib/db";
import { withThumbnailUrl } from "@/app/api/_lib/db";

export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 32;
    const maxLimit = Math.min(limit, 100);

    const result = await query<PhotoWithFolderRow>(
      `
        SELECT
          p.*,
          f.name as folder_name,
          f.path as folder_path
        FROM photos p
        LEFT JOIN folders f ON p.folder_id = f.id
        WHERE true ${andInGallery()}
        ORDER BY RANDOM()
        LIMIT $1
      `,
      [maxLimit],
    );

    const photosWithThumbnails = result.rows.map(withThumbnailUrl);

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
