import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  andPhotoFilter,
  BETTER,
  betterPassFilter,
  hasPhotoFilter,
  notTrashed,
  query,
  stackColumns,
  stackFront,
} from "@/lib/database";
import { logger } from "@/lib/logger";
import type { PhotoWithFolderRow } from "@/app/api/_lib/db";
import { withThumbnailUrl } from "@/app/api/_lib/db";
import { filterNotes, listFilter } from "@/app/api/_lib/filter";

// Force dynamic rendering for routes using auth
export const dynamic = "force-dynamic";

/**
 * Every favorite, by filename; with the filter parameters of
 * lib/photoFilter.ts, only those of the gallery passing them (a favorite in
 * a folder out of the gallery shows unfiltered only, like in Bibliothèque).
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const list = await listFilter(request, { favorites: true });
    if (!list.ok) return list.response;
    const params: unknown[] = [];
    const filtering = hasPhotoFilter({ ...list.filter, favorites: false });
    const filtered = filtering && andPhotoFilter(params, list.filter);
    // A stack shows once: its best favorite the filter keeps
    const front = stackFront([
      `${BETTER}.is_favorite`,
      ...(filtering ? betterPassFilter(params, list.filter) : []),
    ]);
    const result = await query<PhotoWithFolderRow>(
      `
      SELECT
        p.*,
        f.name as folder_name,
        f.path as folder_path,
        ${stackColumns()}
      FROM photos p
      LEFT JOIN folders f ON p.folder_id = f.id
      WHERE p.is_favorite = true AND ${notTrashed()}
        ${filtered || ""}
        AND ${front}
      ORDER BY p.filename
    `,
      params,
    );

    // Add thumbnail URLs
    const photosWithThumbnails = result.rows.map(withThumbnailUrl);

    return NextResponse.json({
      success: true,
      photos: photosWithThumbnails,
      ...filterNotes(list),
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
