import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { thumbnailService } from "@/lib/thumbnails";
import { getConfig } from "@/lib/config";
import { initializeS3Client } from "@/lib/s3";
import { logger } from "@/lib/logger";
import { thumbnailRateLimiter } from "@/lib/rateLimiter";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Rate limiting by IP address
    const clientIP = request.headers.get("x-forwarded-for") || 
                    request.headers.get("x-real-ip") || 
                    "127.0.0.1";
    
    if (!thumbnailRateLimiter.isAllowed(clientIP)) {
      const stats = thumbnailRateLimiter.getStats(clientIP);
      return new NextResponse("Rate limit exceeded", { 
        status: 429,
        headers: {
          'Retry-After': Math.ceil((stats.resetTime - Date.now()) / 1000).toString(),
          'X-RateLimit-Limit': '200',
          'X-RateLimit-Remaining': stats.remaining.toString(),
          'X-RateLimit-Reset': stats.resetTime.toString(),
        }
      });
    }

    // Validate photo ID parameter
    if (!params.id || typeof params.id !== "string") {
      return new NextResponse("Photo ID is required", { status: 400 });
    }

    const photoId = parseInt(params.id);

    if (isNaN(photoId) || photoId <= 0) {
      return new NextResponse("Invalid photo ID - must be a positive integer", {
        status: 400,
      });
    }

    // Additional security: prevent extremely large IDs
    if (photoId > Number.MAX_SAFE_INTEGER || params.id.length > 10) {
      return new NextResponse("Photo ID is too large", { status: 400 });
    }

    // Check if user wants to bypass size limits (explicit request)
    const searchParams = request.nextUrl.searchParams;
    const forceGenerate = searchParams.get("force") === "true";

    const photo = await getPhoto(photoId);

    if (!photo) {
      return new NextResponse("Photo not found", { status: 404 });
    }

    // Check conditional requests for cached thumbnails
    const ifNoneMatch = request.headers.get('if-none-match');
    const etag = `"thumb-${photo.id}-${photo.modified_at}"`;

    if (ifNoneMatch === etag) {
      return new NextResponse(null, { 
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'public, max-age=31536000, immutable',
        }
      });
    }

    if (photo.thumbnail_path) {
      const thumbnailBuffer = await thumbnailService.getThumbnailBuffer(
        photo.thumbnail_path,
      );

      if (thumbnailBuffer) {
        return new NextResponse(thumbnailBuffer as any, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": thumbnailBuffer.length.toString(),
            "ETag": etag,
            "Last-Modified": new Date(photo.modified_at).toUTCString(),
          },
        });
      }
    }

    const config = await getConfig();

    // Debug logging for large files
    if (photo.size > 10 * 1024 * 1024) { // Files over 10MB
      const sizeMB = photo.size / (1024 * 1024);
      console.log(`Thumbnail request for ${photo.filename}: ${sizeMB.toFixed(1)}MB, threshold: ${config.auto_thumbnail_threshold_mb}MB`);
    }

    // Initialize S3 client (reuses connection if config unchanged)
    initializeS3Client({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });

    let thumbnailPath;
    try {
      thumbnailPath = await thumbnailService.generateThumbnail(
        config.backblaze_bucket,
        photo.s3_key,
        photo.id,
        {},
        forceGenerate,
        request,
      );
    } catch (error) {
      // Handle unsupported format as expected behavior, not an error
      if (error instanceof Error && error.message.includes("Unsupported image format")) {
        logger.thumbnailOperation(
          `Thumbnail request for unsupported format`,
          {
            photoId: photo.id,
            s3Key: photo.s3_key,
            fileExtension: photo.s3_key.toLowerCase().split('.').pop() || 'unknown',
          },
        );
        return new NextResponse(
          JSON.stringify({
            error: "Unsupported image format",
            message: error.message,
            fileExtension: photo.s3_key.toLowerCase().split('.').pop() || 'unknown'
          }),
          { 
            status: 415, // Unsupported Media Type
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }

      // Handle size limit as expected behavior, not an error
      if (error instanceof Error && error.message.includes("Photo too large for automatic thumbnail generation")) {
        const sizeMB = photo.size / (1024 * 1024);
        logger.thumbnailOperation(
          `Thumbnail request for large photo (${sizeMB.toFixed(1)}MB > ${config.auto_thumbnail_threshold_mb}MB) - user can force generation`,
          {
            photoId: photo.id,
            sizeMB,
            thresholdMB: config.auto_thumbnail_threshold_mb,
            s3Key: photo.s3_key,
          },
        );
        return new NextResponse(
          JSON.stringify({
            error: "Photo too large for automatic thumbnail generation",
            message: `This photo is ${sizeMB.toFixed(1)}MB, which exceeds the ${config.auto_thumbnail_threshold_mb}MB threshold. Add ?force=true to generate anyway.`,
            sizeMB: sizeMB,
            thresholdMB: config.auto_thumbnail_threshold_mb
          }),
          { 
            status: 413,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
      }
      // Re-throw other errors to be handled by the outer catch block
      throw error;
    }

    const thumbnailBuffer =
      await thumbnailService.getThumbnailBuffer(thumbnailPath);

    if (!thumbnailBuffer) {
      return new NextResponse("Failed to generate thumbnail", { status: 500 });
    }

    return new NextResponse(thumbnailBuffer as any, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": thumbnailBuffer.length.toString(),
      },
    });
  } catch (error) {
    const photoId = parseInt(params.id);
    logger.apiError("Error in GET /api/photos/[id]/thumbnail", error as Error, {
      method: "GET",
      path: "/api/photos/[id]/thumbnail",
      photoId: photoId,
    });
    return new NextResponse("Internal server error", { status: 500 });
  }
}
