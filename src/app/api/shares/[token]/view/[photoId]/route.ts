import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logShareAccess } from "@/lib/database";
import { getObjectStreamAuto } from "@/lib/s3";
import { validateSharedPhotoAccess } from "@/lib/shareHelpers";
import { getRequestContext } from "@/lib/requestContext";

// Force dynamic rendering
export const dynamic = "force-dynamic";

interface RouteParams {
  params: { token: string; photoId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { token, photoId } = params;

    const validation = await validateSharedPhotoAccess(request, token, photoId);
    if (validation.error) {
      return validation.error;
    }

    const { share, photo } = validation;

    // The original file is a download in all but name. Without download
    // rights, guests see photos through their 2048 px rendition; videos and
    // GIFs have none, so they still play from the original.
    const type = photo.mime_type.toLowerCase();
    if (
      !share.allow_download &&
      !type.startsWith("video/") &&
      type !== "image/gif"
    ) {
      return NextResponse.json(
        { error: "Downloads not allowed for this share" },
        { status: 403 },
      );
    }

    // Log view access (not download)
    const ctx = getRequestContext(request);
    await logShareAccess(share.id, {
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      access_type: "view",
      success: true,
    });

    // S3 client auto-initializes
    try {
      const stream = await getObjectStreamAuto(photo.s3_key, request);

      // Convert the stream to buffer
      if (!stream) {
        throw new Error("Empty S3 response body");
      }
      const buffer = Buffer.from(await stream.transformToByteArray());
      const response = new NextResponse(buffer);

      // Set headers for viewing (not downloading)
      response.headers.set("Content-Type", photo.mime_type);
      response.headers.set("Cache-Control", "private, max-age=3600");
      response.headers.set("Content-Length", buffer.length.toString());

      return response;
    } catch (s3Error) {
      console.error("[API] S3 error viewing shared photo:", s3Error);
      return NextResponse.json(
        { error: "Failed to load photo from storage" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("[API] Error viewing shared photo:", error);
    return NextResponse.json(
      { error: "Failed to view photo" },
      { status: 500 },
    );
  }
}
