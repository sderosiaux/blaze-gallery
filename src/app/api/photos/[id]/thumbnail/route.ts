import { NextRequest, NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { thumbnailService } from "@/lib/thumbnails";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { thumbnailRateLimiter } from "@/lib/rateLimiter";
import { requireAuth } from "@/lib/auth/middleware";

export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // Rate limiting by IP address
    const clientIP =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "127.0.0.1";

    if (!thumbnailRateLimiter.isAllowed(clientIP)) {
      const stats = thumbnailRateLimiter.getStats(clientIP);
      return new NextResponse("Rate limit exceeded", {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(
            (stats.resetTime - Date.now()) / 1000,
          ).toString(),
          "X-RateLimit-Limit": "200",
          "X-RateLimit-Remaining": stats.remaining.toString(),
          "X-RateLimit-Reset": stats.resetTime.toString(),
        },
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
    const ifNoneMatch = request.headers.get("if-none-match");
    const etag = `"thumb-${photo.id}-${photo.modified_at}"`;

    if (ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // Debug logging for large files
    if (photo.size > 10 * 1024 * 1024) {
      // Files over 10MB
      const sizeMB = photo.size / (1024 * 1024);
      const config = getConfig();
      console.log(
        `Thumbnail request for ${photo.filename}: ${sizeMB.toFixed(1)}MB, threshold: ${config.auto_thumbnail_threshold_mb}MB`,
      );
    }

    // Use the common thumbnail serving logic
    const result = await thumbnailService.serveThumbnail(
      photo,
      request,
      forceGenerate,
    );

    if ("error" in result) {
      // Return detailed JSON errors for regular endpoint (like the old behavior)
      if (result.status === 415) {
        return new NextResponse(
          JSON.stringify({
            error: "Unsupported image format",
            message: result.error,
            fileExtension:
              photo.s3_key.toLowerCase().split(".").pop() || "unknown",
          }),
          {
            status: 415,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (result.status === 413) {
        return new NextResponse(
          JSON.stringify({
            error: "Photo too large for automatic thumbnail generation",
            message: result.error,
            sizeMB: photo.size / (1024 * 1024),
            thresholdMB: getConfig().auto_thumbnail_threshold_mb,
          }),
          {
            status: 413,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      return new NextResponse(result.error, { status: result.status });
    }

    // Add ETag and Last-Modified for regular endpoint caching
    const enhancedHeaders = {
      ...result.headers,
      ETag: etag,
      "Last-Modified": new Date(photo.modified_at).toUTCString(),
    };

    return new NextResponse(result.buffer as any, {
      headers: enhancedHeaders,
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
});
