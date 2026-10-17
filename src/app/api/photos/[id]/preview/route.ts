import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { servePhotoPreview } from "@/lib/photoPreview";

/**
 * Embedded EXIF thumbnail of a photo, read from its first 64 KB.
 * Shown while the real thumbnail is generated; also fills missing metadata.
 * No rate limiter: the shared one costs a DB write per request and would
 * count preview + thumbnail against the same budget.
 */
export const GET = requireAuth(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const photoId = Number(params.id);
  if (!Number.isSafeInteger(photoId) || photoId <= 0 || params.id.length > 10) {
    return NextResponse.json(
      { success: false, error: "invalid_photo_id" },
      { status: 400 },
    );
  }

  try {
    const photo = await getPhoto(photoId);
    if (!photo) {
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }
    return await servePhotoPreview(photo, request, {
      cacheControl: "private, max-age=2592000, immutable",
    });
  } catch (error) {
    logger.apiError("Error in GET /api/photos/[id]/preview", error as Error, {
      method: "GET",
      path: "/api/photos/[id]/preview",
      photoId,
    });
    return NextResponse.json(
      { success: false, error: "preview_failed" },
      { status: 500 },
    );
  }
});
