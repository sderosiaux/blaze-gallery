import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getStackPhotos } from "@/lib/database";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/photos/:id/stack: the photos of its stack of near-duplicates the
 * gallery shows, best first (the viewer's strip); [] when it is in none.
 */
export const GET = requireAuth(async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const photoId = Number.parseInt(params.id, 10);
  if (!Number.isSafeInteger(photoId) || photoId <= 0)
    return NextResponse.json(
      { success: false, error: "Invalid photo ID" },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      success: true,
      photos: await getStackPhotos(photoId),
    });
  } catch (error) {
    logger.apiError("Error reading a photo's stack", error as Error, {
      method: "GET",
      path: "/api/photos/[id]/stack",
      photoId,
    });
    return NextResponse.json(
      { success: false, error: "La pile n’a pas pu être lue" },
      { status: 500 },
    );
  }
});
