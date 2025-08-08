import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { logger } from "@/lib/logger";

export async function GET(
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

    const photo = await getPhoto(photoId);

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      photo,
    });
  } catch (error) {
    const photoId = parseInt(params.id);
    logger.apiError("Error in GET /api/photos/[id]", error as Error, {
      method: "GET",
      path: "/api/photos/[id]",
      photoId: photoId,
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
