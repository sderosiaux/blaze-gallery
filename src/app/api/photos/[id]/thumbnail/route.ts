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

    // Initialize S3 client (reuses connection if config unchanged)
    initializeS3Client({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });

    const thumbnailPath = await thumbnailService.generateThumbnail(
      config.backblaze_bucket,
      photo.s3_key,
      photo.id,
      {},
      forceGenerate,
    );

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
