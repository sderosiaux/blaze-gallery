import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Photo } from "@/types";
import type { SharedFolder } from "@/lib/database";
import { getSharedFolder, getPhoto } from "@/lib/database";
import { isValidShareSession } from "@/lib/shareSession";
import { DatabaseRateLimiter } from "@/lib/rateLimiter";
import { getClientIP } from "@/lib/requestContext";

/** On failure `error` is the response to return; otherwise share and photo are set */
export type ShareValidationResult =
  | {
      error: NextResponse;
      share: SharedFolder | null;
      photo: Photo | null;
    }
  | { error?: undefined; share: SharedFolder; photo: Photo };

// View rate limiter: 1 view per hour per IP+token combo
const viewRateLimiter = new DatabaseRateLimiter(60 * 60 * 1000, 1);

// Password guesses on a shared link: a few per address, and a ceiling per link
// so spreading the guesses over many addresses doesn't help either.
const PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const passwordLimiter = new DatabaseRateLimiter(PASSWORD_WINDOW_MS, 10);
const PASSWORD_ATTEMPTS_PER_LINK = 50;

/** False once a password guess for this link should be refused for a while. */
export async function mayTryPassword(
  request: NextRequest,
  token: string,
): Promise<boolean> {
  const [fromHere, overall] = await Promise.all([
    passwordLimiter.isAllowed(
      `share-password:${token}:${getClientIP(request)}`,
    ),
    passwordLimiter.isAllowed(
      `share-password:${token}`,
      PASSWORD_ATTEMPTS_PER_LINK,
    ),
  ]);
  return fromHere && overall;
}

/** A link opens one folder: its own photos, not those of sub-folders or of folders sharing a name prefix. */
export function inSharedFolder(s3Key: string, folderPath: string): boolean {
  const trim = (p: string) => p.replace(/^\/+|\/+$/g, "");
  const slash = s3Key.lastIndexOf("/");
  return trim(slash === -1 ? "" : s3Key.slice(0, slash)) === trim(folderPath);
}

/**
 * Check if a view should be counted based on IP and share token rate limiting
 * Returns true if the view should be counted (not seen this IP+token combo in the last hour)
 */
export function shouldCountView(
  _request: NextRequest,
  _token: string,
): boolean {
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
  const ip = getClientIP(request);
  const cacheKey = `view:${token}:${ip}`;

  // If rate limiter allows (first request in window), it's a countable view
  return viewRateLimiter.isAllowed(cacheKey);
}

interface ValidationOptions {
  requireDownloadPermission?: boolean;
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
  const { requireDownloadPermission = false } = options;
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

  // Behind a password, every image needs the session, thumbnails included:
  // the link alone must not reveal the photos.
  if (share.password_hash) {
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

    if (!isValidShareSession(sessionToken, share)) {
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
  if (!/^\d{1,10}$/.test(photoId)) {
    return {
      share,
      photo: null,
      error: NextResponse.json({ error: "Invalid photo id" }, { status: 400 }),
    };
  }
  const photo = await getPhoto(Number(photoId));
  if (!photo) {
    return {
      share,
      photo: null,
      error: NextResponse.json({ error: "Photo not found" }, { status: 404 }),
    };
  }

  if (!inSharedFolder(photo.s3_key, share.folder_path)) {
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

/** Same rules as the photo itself: a password-protected link shows nothing without its session. */
export async function validateSharedThumbnailAccess(
  request: NextRequest,
  token: string,
  photoId: string,
): Promise<ShareValidationResult> {
  return validateSharedPhotoAccess(request, token, photoId);
}
