import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { thumbnailService } from "@/lib/thumbnails";
import { validateSharedThumbnailAccess } from "@/lib/shareHelpers";
import { logger } from "@/lib/logger";

// Force dynamic rendering
export const dynamic = "force-dynamic";

interface RouteParams {
  params: { token: string; photoId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, photoId } = params;

    logger.debug(
      `[SHARED_THUMBNAIL] Request for token=${token}, photoId=${photoId}`,
    );

    // Validate shared thumbnail access (allows password-protected shares)
    const validation = await validateSharedThumbnailAccess(
      request,
      token,
      photoId,
    );
    if (validation.error) {
      logger.debug(`[SHARED_THUMBNAIL] Validation failed`, {
        status: validation.error.status,
      });
      return validation.error;
    }

    const { photo } = validation;

    logger.debug(
      `[SHARED_THUMBNAIL] Using common serveThumbnail for photo ${photo.id}`,
    );

    // Use the common thumbnail serving logic
    const result = await thumbnailService.serveThumbnail(photo, request, false);

    if ("error" in result) {
      logger.debug(
        `[SHARED_THUMBNAIL] serveThumbnail returned error: ${result.error}`,
      );
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }

    logger.debug(
      `[SHARED_THUMBNAIL] serveThumbnail success, buffer size: ${result.buffer.length}`,
    );

    // Override cache control for shared content (shorter than regular thumbnails)
    const sharedHeaders = {
      ...result.headers,
      "Cache-Control": "private, max-age=86400", // 24 hours for shared content
    };

    return new NextResponse(new Uint8Array(result.buffer), {
      headers: sharedHeaders,
    });
  } catch (error) {
    console.error("[API] Error serving shared thumbnail:", error);
    return NextResponse.json(
      { error: "Failed to serve thumbnail" },
      { status: 500 },
    );
  }
}
