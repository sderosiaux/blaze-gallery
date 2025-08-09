import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getPhoto } from "@/lib/database";
import { getSignedDownloadUrlAuto } from "@/lib/s3";
import { logger } from "@/lib/logger";
import { ValidationPatterns } from "@/lib/validation";

export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Validate photo ID parameter
    if (!params.id || typeof params.id !== "string") {
      return NextResponse.json(
        { success: false, error: "Photo ID is required" },
        { status: 400 },
      );
    }

    const photoId = parseInt(params.id);

    if (isNaN(photoId) || photoId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid photo ID - must be a positive integer",
        },
        { status: 400 },
      );
    }

    // Additional security: prevent extremely large IDs that could cause issues
    if (photoId > Number.MAX_SAFE_INTEGER || params.id.length > 10) {
      return NextResponse.json(
        { success: false, error: "Photo ID is too large" },
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

    // Get signed download URL - S3 client auto-initializes
    const signedUrl = await getSignedDownloadUrlAuto(
      photo.s3_key,
      3600,
      request,
    );

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    const photoId = parseInt(params.id);
    logger.apiError("Error in GET /api/photos/[id]/download", error as Error, {
      method: "GET",
      path: "/api/photos/[id]/download",
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
});
