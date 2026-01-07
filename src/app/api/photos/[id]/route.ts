import { NextRequest, NextResponse } from "next/server";
import { getPhoto, deletePhoto } from "@/lib/database";
import { deleteObject } from "@/lib/s3";
import { thumbnailService } from "@/lib/thumbnails";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const GET = requireAuth(async function GET(
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
});

export const DELETE = requireAuth(async function DELETE(
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

    // Get photo to retrieve S3 key and thumbnail path
    const photo = await getPhoto(photoId);

    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 },
      );
    }

    const config = getConfig();

    // Delete from S3 (original photo)
    await deleteObject(config.backblaze_bucket, photo.s3_key, request);
    logger.info(`Deleted photo from S3: ${photo.s3_key}`);

    // Delete thumbnail if exists
    if (photo.thumbnail_path) {
      try {
        await thumbnailService.deleteThumbnail(photo.thumbnail_path);
        logger.info(`Deleted thumbnail: ${photo.thumbnail_path}`);
      } catch (err) {
        // Log but don't fail if thumbnail deletion fails
        logger.warn(`Failed to delete thumbnail for photo ${photoId}`, undefined, err instanceof Error ? err : undefined);
      }
    }

    // Delete from database
    await deletePhoto(photoId);
    logger.info(`Deleted photo from database: ${photoId}`);

    return NextResponse.json({
      success: true,
      message: `Photo ${photoId} deleted successfully`,
    });
  } catch (error) {
    const photoId = parseInt(params.id);
    logger.apiError("Error in DELETE /api/photos/[id]", error as Error, {
      method: "DELETE",
      path: "/api/photos/[id]",
      photoId: photoId,
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Delete failed",
      },
      { status: 500 },
    );
  }
});
