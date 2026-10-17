import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";
import { displayHeaders, getDisplayRendition } from "@/lib/displayRendition";
import { asQuarterTurn } from "@/lib/rotation";

/**
 * Screen-sized rendition the viewer shows instead of the original (see
 * displayRendition). No rate limiter, like the preview: the shared one costs a
 * DB write per request, and the viewer asks for neighbours ahead of time.
 */
// Downloads an original (tens of MB for a panorama) and resizes it: well past
// a serverless platform's default timeout on a slow first render.
export const maxDuration = 60;

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

    // The URL carries no version: 30 days bounds how long a re-made rendition stays unseen
    const cacheControl = "private, max-age=2592000, immutable";
    // The hand rotation the viewer asked for (?r=, see displayUrl)
    const rotation = asQuarterTurn(
      Number(request.nextUrl.searchParams.get("r")),
    );
    const etag = `"display-${photo.id}-${new Date(photo.modified_at).getTime()}-r${rotation}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": cacheControl },
      });
    }

    const result = await getDisplayRendition(photo, rotation, request);
    if ("error" in result) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status },
      );
    }
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: { ...displayHeaders(result.buffer, cacheControl), ETag: etag },
    });
  } catch (error) {
    logger.apiError("Error in GET /api/photos/[id]/display", error as Error, {
      method: "GET",
      path: "/api/photos/[id]/display",
      photoId,
    });
    return NextResponse.json(
      { success: false, error: "display_failed" },
      { status: 500 },
    );
  }
});
