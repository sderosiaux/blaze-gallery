import { NextRequest, NextResponse } from "next/server";
import { getSharedFolder, getPhoto } from "@/lib/database";
import { validateShareSession } from "@/lib/shareSession";
import { DatabaseRateLimiter } from "@/lib/rateLimiter";

export interface ShareValidationResult {
  share: any;
  photo: any;
  error?: NextResponse;
}

// View rate limiter: 1 view per hour per IP+token combo
const viewRateLimiter = new DatabaseRateLimiter(60 * 60 * 1000, 1);

/**
 * Check if a view should be counted based on IP and share token rate limiting
 * Returns true if the view should be counted (not seen this IP+token combo in the last hour)
 */
export function shouldCountView(request: NextRequest, token: string): boolean {
  // Sync version always returns true - use shouldCountViewAsync for accurate rate limiting
  return true;
}

/**
 * Async version of shouldCountView that uses the database
 * Call this in async contexts where you can await
 */
export async function shouldCountViewAsync(
  request: NextRequest,
  token: string,
): Promise<boolean> {
  const ip = request.ip || request.headers.get("x-forwarded-for") || "unknown";
  const cacheKey = `view:${token}:${ip}`;

  // If rate limiter allows (first request in window), it's a countable view
  return viewRateLimiter.isAllowed(cacheKey);
}

interface ValidationOptions {
  requireDownloadPermission?: boolean;
  skipSessionCheck?: boolean;
}

/**
 * Common validation logic for shared photo endpoints
 * Handles share validation, session checking, and photo verification
 */
export async function validateSharedPhotoAccess(
  request: NextRequest,
  token: string,
  photoId: string,
  options: ValidationOptions = {},
): Promise<ShareValidationResult> {
  const { requireDownloadPermission = false, skipSessionCheck = false } =
    options;
  const sessionToken = request.headers.get("x-share-session");

  // Get the shared folder
  const share = await getSharedFolder(token);

  if (!share) {
    return {
      share: null,
      photo: null,
      error: NextResponse.json(
        { error: "Share not found or expired" },
        { status: 404 },
      ),
    };
  }

  // Check download permission if required
  if (requireDownloadPermission && !share.allow_download) {
    return {
      share,
      photo: null,
      error: NextResponse.json(
        { error: "Downloads not allowed for this share" },
        { status: 403 },
      ),
    };
  }

  // Check session if password protection is enabled (unless skipped for thumbnails)
  if (!skipSessionCheck && share.password_hash) {
    if (!sessionToken) {
      return {
        share,
        photo: null,
        error: NextResponse.json(
          { error: "Session token required" },
          { status: 401 },
        ),
      };
    }

    const validatedToken = validateShareSession(sessionToken);
    if (!validatedToken || validatedToken !== token) {
      return {
        share,
        photo: null,
        error: NextResponse.json(
          { error: "Invalid or expired session" },
          { status: 401 },
        ),
      };
    }
  }

  // Get the photo and verify it belongs to the shared folder
  const photo = await getPhoto(parseInt(photoId));
  if (!photo) {
    return {
      share,
      photo: null,
      error: NextResponse.json({ error: "Photo not found" }, { status: 404 }),
    };
  }

  // Verify the photo is in the shared folder
  if (!photo.s3_key.startsWith(share.folder_path)) {
    return {
      share,
      photo,
      error: NextResponse.json(
        { error: "Photo not accessible through this share" },
        { status: 403 },
      ),
    };
  }

  return { share, photo };
}

/**
 * Thumbnail-specific validation - allows thumbnails even for password-protected shares
 * since thumbnails are lower resolution and needed for the gallery view
 */
export async function validateSharedThumbnailAccess(
  request: NextRequest,
  token: string,
  photoId: string,
): Promise<ShareValidationResult> {
  // Thumbnails skip session check to allow gallery view with simple img tags
  return validateSharedPhotoAccess(request, token, photoId, {
    skipSessionCheck: true,
  });
}
