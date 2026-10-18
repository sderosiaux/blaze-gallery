import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAuthOrApiKey } from "@/lib/auth/middleware";
import { getPhoto } from "@/lib/database";
import { displayHeaders, getDisplayRendition } from "@/lib/displayRendition";
import { asFaceBox, turnBox, uprightTurn } from "@/lib/faces";
import { cropSource } from "@/lib/people";
import { userRotation } from "@/lib/rotation";
import { badRequest, failure, positiveId } from "@/app/api/_lib/people";

/** Output side, px: sharp on a 2x screen at the review grid's tile size. */
const SIZE = 256;
/** Room around the face on each side, as a share of its larger side. */
const MARGIN = 0.3;

/**
 * GET /api/faces/:id/crop: a square JPEG of the face with some room around
 * it, stood upright, cut from the screen-sized rendition (made on first
 * request like the viewer's). The machine clients of the MCP tools fetch it
 * with the API key.
 */
export const GET = requireAuthOrApiKey(async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const faceId = positiveId(params.id);
  if (faceId === null) return badRequest("invalid_face_id");
  try {
    const source = await cropSource(faceId);
    const photo = source ? await getPhoto(source.photo_id) : null;
    const box = source ? asFaceBox(source.box) : null;
    if (!source || !photo || !box) {
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }
    const rotation = userRotation(photo.metadata);
    const cacheControl = "private, max-age=2592000, immutable";
    const etag = `"face-${String(faceId)}-${new Date(photo.modified_at).getTime()}-r${rotation}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": cacheControl },
      });
    }

    const rendition = await getDisplayRendition(photo, rotation, request);
    if ("error" in rendition) {
      return NextResponse.json(
        { success: false, error: rendition.error },
        { status: rendition.status },
      );
    }
    const { width = 0, height = 0 } = await sharp(rendition.buffer).metadata();
    const [x, y, w, h] = turnBox(box, rotation);
    const side = Math.min(
      Math.round(Math.max(w * width, h * height) * (1 + 2 * MARGIN)),
      width,
      height,
    );
    const centerX = (x + w / 2) * width;
    const centerY = (y + h / 2) * height;
    const clamp = (v: number, max: number) =>
      Math.round(Math.min(Math.max(v, 0), max));
    const left = clamp(centerX - side / 2, width - side);
    const top = clamp(centerY - side / 2, height - side);
    if (side < 1) {
      return NextResponse.json(
        { success: false, error: "empty_face" },
        { status: 422 },
      );
    }

    // Two passes: in one pipeline sharp turns before it extracts, and the
    // square measured on the unturned rendition falls outside the turned one
    const square = await sharp(rendition.buffer)
      .extract({ left, top, width: side, height: side })
      .resize(SIZE, SIZE, { fit: "cover" })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const buffer = await sharp(square)
      .rotate(uprightTurn(source.detect_rotation, rotation))
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: { ...displayHeaders(buffer, cacheControl), ETag: etag },
    });
  } catch (error) {
    return failure(error, { method: "GET", path: "/api/faces/[id]/crop" });
  }
});
