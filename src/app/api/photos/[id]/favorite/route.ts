import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getDatabase } from "@/lib/database";
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

    const database = getDatabase();

    // Toggle favorite status
    const currentPhoto = database
      .prepare("SELECT is_favorite FROM photos WHERE id = ?")
      .get(photoId) as { is_favorite: number } | undefined;

    if (!currentPhoto) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 },
      );
    }

    const newFavoriteStatus = currentPhoto.is_favorite ? 0 : 1;

    const stmt = database.prepare(`
      UPDATE photos 
      SET is_favorite = ? 
      WHERE id = ?
    `);

    stmt.run(newFavoriteStatus, photoId);

    return NextResponse.json({
      success: true,
      is_favorite: Boolean(newFavoriteStatus),
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
