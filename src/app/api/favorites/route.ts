import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { PhotoWithFolderRow } from "@/app/api/_lib/db";
import { withThumbnailUrl } from "@/app/api/_lib/db";

// Force dynamic rendering for routes using auth
export const dynamic = "force-dynamic";

export const GET = requireAuth(async function GET() {
  try {
    const result = await query<PhotoWithFolderRow>(`
      SELECT
        p.*,
        f.name as folder_name,
        f.path as folder_path
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = true
      ORDER BY p.filename
    `);

    // Add thumbnail URLs
    const photosWithThumbnails = result.rows.map(withThumbnailUrl);

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
