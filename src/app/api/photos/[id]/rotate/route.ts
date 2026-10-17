import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getPhoto, query } from "@/lib/database";
import { logger } from "@/lib/logger";
import { thumbnailService } from "@/lib/thumbnails";
import { turn, userRotation } from "@/lib/rotation";

function readDirection(body: unknown): "cw" | "ccw" | null {
  if (typeof body !== "object" || body === null) return null;
  const { direction } = body as Record<string, unknown>;
  return direction === "cw" || direction === "ccw" ? direction : null;
}

/**
 * POST /api/photos/:id/rotate  { "direction": "cw" | "ccw" }
 * Turns a photo a quarter by hand. The original in the bucket is untouched:
 * the turn is stored in metadata and the stored thumbnail is dropped so the
 * next one is built turned.
 */
export const POST = requireAuth(async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const photoId = Number(params.id);
  if (!Number.isSafeInteger(photoId) || photoId <= 0) {
    return NextResponse.json(
      { success: false, error: "Invalid photo id" },
      { status: 400 },
    );
  }
  const direction = readDirection(await request.json().catch(() => null));
  if (!direction) {
    return NextResponse.json(
      { success: false, error: 'direction must be "cw" or "ccw"' },
      { status: 400 },
    );
  }

  try {
    const photo = await getPhoto(photoId);
    if (!photo) {
      return NextResponse.json(
        { success: false, error: "Photo not found" },
        { status: 404 },
      );
    }
    const rotation = turn(userRotation(photo.metadata), direction);

    await query(
      `UPDATE photos
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{user_rotation}', to_jsonb($1::int)),
           thumbnail_path = NULL,
           thumbnail_status = 'none'
       WHERE id = $2`,
      [rotation, photoId],
    );
    if (photo.thumbnail_path) {
      await thumbnailService.deleteThumbnail(photo.thumbnail_path);
    }

    return NextResponse.json({
      success: true,
      user_rotation: rotation,
      metadata: { ...photo.metadata, user_rotation: rotation },
    });
  } catch (error) {
    logger.apiError("Photo rotation failed", error as Error, { photoId });
    return NextResponse.json(
      { success: false, error: "Rotation failed" },
      { status: 500 },
    );
  }
});
