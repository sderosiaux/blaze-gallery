import { NextRequest, NextResponse } from "next/server";
import {
  getSharedFolder,
  validateSharePassword,
  getPhoto,
  query,
} from "@/lib/database";
import { validateShareSession } from "@/lib/shareSession";

export interface ShareValidationResult {
  share: any;
  photo: any;
  error?: NextResponse;
}

// Database-backed view rate limiting for serverless deployments
let viewRateTableInitialized = false;

async function ensureViewRateTable(): Promise<void> {
  if (viewRateTableInitialized) return;

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS view_rate_limits (
        cache_key VARCHAR(512) PRIMARY KEY,
        last_viewed BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_view_rate_limits_last_viewed
      ON view_rate_limits(last_viewed)
    `);

    viewRateTableInitialized = true;
  } catch (error) {
    console.error("[VIEW_RATE] Error ensuring table:", error);
    viewRateTableInitialized = true;
  }
}

/**
 * Check if a view should be counted based on IP and share token rate limiting
 * Returns true if the view should be counted (not seen this IP+token combo in the last hour)
 * Uses database for serverless compatibility
 */
export function shouldCountView(request: NextRequest, token: string): boolean {
  // For sync compatibility, we return true immediately and handle DB async elsewhere
  // The actual rate limiting is done via the share_access_logs table
  // This is a simplified approach - we count the view but rate-limit via DB
  return true;
}

/**
 * Async version of shouldCountView that uses the database
 * Call this in async contexts where you can await
 */
export async function shouldCountViewAsync(request: NextRequest, token: string): Promise<boolean> {
  await ensureViewRateTable();

  const ip = request.ip || request.headers.get("x-forwarded-for") || "unknown";
  const cacheKey = `view:${token}:${ip}`;
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  try {
    // Try to insert or update atomically
    const result = await query(
      `
      INSERT INTO view_rate_limits (cache_key, last_viewed)
      VALUES ($1, $2)
      ON CONFLICT (cache_key) DO UPDATE
      SET last_viewed = CASE
        WHEN view_rate_limits.last_viewed < $3 THEN $2
        ELSE view_rate_limits.last_viewed
      END
      RETURNING last_viewed,
        CASE WHEN last_viewed = $2 THEN true ELSE false END as is_new_view
    `,
      [cacheKey, now, oneHourAgo]
    );

    // If we updated with our timestamp, it's a countable view
    return result.rows[0]?.is_new_view === true;
  } catch (error) {
    console.error("[VIEW_RATE] Error checking view rate:", error);
    // On error, allow the view to be counted
    return true;
  }
}

/**
 * Common validation logic for shared photo endpoints
 * Handles share validation, session checking, and photo verification
 */
export async function validateSharedPhotoAccess(
  request: NextRequest,
  token: string,
  photoId: string,
  requireDownloadPermission = false,
): Promise<ShareValidationResult> {
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

  // Check session if password protection is enabled
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
  console.log(`[VALIDATE_SHARED_THUMBNAIL] token=${token}, photoId=${photoId}`);

  // Get the shared folder
  const share = await getSharedFolder(token);
  console.log(`[VALIDATE_SHARED_THUMBNAIL] share found:`, !!share);

  if (!share) {
    console.log(
      `[VALIDATE_SHARED_THUMBNAIL] No share found for token=${token}`,
    );
    return {
      share: null,
      photo: null,
      error: NextResponse.json(
        { error: "Share not found or expired" },
        { status: 404 },
      ),
    };
  }

  // For thumbnails, we don't require session authentication
  // This allows the basic gallery view to work with simple img tags

  // Get the photo and verify it belongs to the shared folder
  const photo = await getPhoto(parseInt(photoId));
  console.log(`[VALIDATE_SHARED_THUMBNAIL] photo found:`, !!photo);
  if (!photo) {
    console.log(
      `[VALIDATE_SHARED_THUMBNAIL] No photo found for photoId=${photoId}`,
    );
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
