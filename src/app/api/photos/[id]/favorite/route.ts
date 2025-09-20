import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";

export const POST = requireAuth(async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const photoId = parseInt(params.id);
    if (isNaN(photoId)) {
      return NextResponse.json(
        { success: false, error: "Invalid photo ID" },
        { status: 400 },
      );
    }

    // Toggle favorite status
    const currentResult = await query(
      "SELECT is_favorite FROM photos WHERE id = $1",
      [photoId]
    );
    const currentPhoto = currentResult.rows[0] as { is_favorite: boolean } | undefined;

    if (!currentPhoto) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 },
      );
    }

    const newFavoriteStatus = !currentPhoto.is_favorite;

    await query(`
      UPDATE photos
      SET is_favorite = $1
      WHERE id = $2
    `, [newFavoriteStatus, photoId]);

    return NextResponse.json({
      success: true,
      is_favorite: newFavoriteStatus,
    });
  } catch (error) {
    logger.apiError("Error toggling photo favorite", error as Error, {
      method: "POST",
      path: "/api/photos/[id]/favorite",
      photoId: parseInt(params.id),
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
