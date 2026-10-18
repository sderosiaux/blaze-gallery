import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import {
  putObject,
  getMimeType,
  getObjectMetadata,
  isMediaFile,
} from "@/lib/s3";
import {
  createOrUpdatePhoto,
  getFolderByPath,
  createOrUpdateFolder,
} from "@/lib/database";
import { thumbnailService } from "@/lib/thumbnails";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export const POST = requireAuth(async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get("file");
    const file = fileEntry instanceof File ? fileEntry : null;
    const folderEntry = formData.get("folder");
    const folderPath = typeof folderEntry === "string" ? folderEntry : "";

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 },
      );
    }

    if (!isMediaFile(file.name)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid file type. Only images and videos are allowed.",
        },
        { status: 400 },
      );
    }

    const config = getConfig();
    const bucket = config.backblaze_bucket;

    // Build S3 key: folder/filename
    const s3Key = folderPath ? `${folderPath}/${file.name}` : file.name;

    // Get or create folder in DB
    let folder = await getFolderByPath(folderPath || "/");
    if (!folder) {
      // Create folder if it doesn't exist
      const folderName = (folderPath.split("/").pop() ?? "") || "Root";
      folder = await createOrUpdateFolder({
        path: folderPath || "/",
        name: folderName,
        parent_id: undefined,
      });
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3
    const mimeType = getMimeType(file.name);
    await putObject(bucket, s3Key, buffer, {
      contentType: mimeType,
      request,
    });

    logger.info(`Uploaded photo to S3: ${s3Key}`);

    // The bucket's own date and size, as the sync will list them: a server
    // clock here would make the next sync see the file as replaced and reset
    // what was extracted from it.
    const stored = await getObjectMetadata(bucket, s3Key, request);

    // Create photo record in DB
    const photo = await createOrUpdatePhoto({
      folder_id: folder.id,
      filename: file.name,
      s3_key: s3Key,
      size: stored.ContentLength ?? buffer.length,
      mime_type: mimeType,
      modified_at: (stored.LastModified ?? new Date()).toISOString(),
      metadata_status: "none",
      thumbnail_status: "pending",
    });

    // Generate thumbnail in background (don't await)
    thumbnailService
      .generateThumbnail({
        bucket,
        s3Key,
        photoId: photo.id,
        request,
      })
      .catch((err: unknown) => {
        logger.error(
          `Failed to generate thumbnail for photo ${photo.id}:`,
          undefined,
          err instanceof Error ? err : undefined,
        );
      });

    return NextResponse.json({
      success: true,
      photo: {
        id: photo.id,
        filename: photo.filename,
        s3_key: photo.s3_key,
        size: photo.size,
        mime_type: photo.mime_type,
      },
    });
  } catch (error) {
    logger.apiError("Error in POST /api/photos/upload", error as Error, {
      method: "POST",
      path: "/api/photos/upload",
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Upload failed",
      },
      { status: 500 },
    );
  }
});
