import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { getSignedDownloadUrl, initializeS3Client } from "@/lib/s3";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { ValidationPatterns } from "@/lib/validation";

export async function GET(
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

    const config = await getConfig();

    // Initialize S3 client (reuses connection if config unchanged)
    initializeS3Client({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });

    const signedUrl = await getSignedDownloadUrl(
      config.backblaze_bucket,
      photo.s3_key,
      3600,
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
}
