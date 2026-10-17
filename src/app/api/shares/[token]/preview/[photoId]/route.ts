import { NextRequest, NextResponse } from "next/server";
import { validateSharedThumbnailAccess } from "@/lib/shareHelpers";
import { servePhotoPreview } from "@/lib/photoPreview";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { token: string; photoId: string };
}

/** Embedded EXIF preview for a photo of a shared folder; same access rules as the shared thumbnail */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const validation = await validateSharedThumbnailAccess(
      request,
      params.token,
      params.photoId,
    );
    if (validation.error) {
      return validation.error;
    }

    // Same lifetime as shared thumbnails: a share can be revoked
    return await servePhotoPreview(validation.photo, request, {
      cacheControl: "private, max-age=86400",
    });
  } catch (error) {
    console.error("[API] Error serving shared preview:", error);
    return NextResponse.json(
      { success: false, error: "preview_failed" },
      { status: 500 },
    );
  }
}
