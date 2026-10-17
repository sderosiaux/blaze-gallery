import { NextResponse } from "next/server";
import sharp from "sharp";
import { userRotation } from "./rotation";
import type { Photo } from "@/types";
import { fillPhotoMetadataIfMissing } from "./database";
import { probeImageHead } from "./imageProbe";
import { logger } from "./logger";

// Previews are ~3-5 KB: 2000 of them is ~8 MB per warm instance. A B2 range
// read costs 0.1-0.8 s to first byte, so repeat views within an instance skip it.
const CACHE_LIMIT = 2000;
const previewCache = new Map<string, Buffer | null>();

function cacheGet(key: string): Buffer | null | undefined {
  const hit = previewCache.get(key);
  if (hit !== undefined) {
    previewCache.delete(key);
    previewCache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, value: Buffer | null): void {
  previewCache.set(key, value);
  if (previewCache.size > CACHE_LIMIT) {
    const oldest = previewCache.keys().next();
    if (oldest.done !== true) previewCache.delete(oldest.value);
  }
}

/**
 * Shared by /api/photos/:id/preview and /api/shares/:token/preview/:photoId.
 * Probes the head of the photo, persists metadata the row lacks, and answers
 * with the embedded thumbnail or a 404 the client treats as "wait for the
 * real thumbnail".
 */
export async function servePhotoPreview(
  photo: Photo,
  request: Request,
  options: { cacheControl: string },
): Promise<NextResponse> {
  if (!photo.mime_type.startsWith("image/")) {
    return noPreview(options.cacheControl);
  }

  const rotation = userRotation(photo.metadata);
  const etag = `"preview-${photo.id}-${new Date(photo.modified_at).getTime()}-r${rotation}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": options.cacheControl },
    });
  }

  const cacheKey = `${photo.id}:${etag}`;
  let preview = cacheGet(cacheKey);

  if (preview === undefined) {
    const probe = await probeImageHead(photo.s3_key, { request });

    // Awaited: a serverless function may be frozen once the response is sent
    if (probe.metadata && !photo.metadata) {
      try {
        await fillPhotoMetadataIfMissing(photo.id, probe.metadata);
      } catch (error) {
        logger.warn("Could not persist probed metadata", {
          photoId: photo.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    preview =
      probe.preview && rotation
        ? await sharp(probe.preview)
            .rotate(rotation)
            .jpeg({ quality: 82 })
            .toBuffer()
        : (probe.preview ?? null);
    cacheSet(cacheKey, preview);
  }

  if (!preview) {
    return noPreview(options.cacheControl);
  }

  return new NextResponse(new Uint8Array(preview), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(preview.length),
      "Cache-Control": options.cacheControl,
      ETag: etag,
    },
  });
}

// The answer only changes if the file does, so it is cached like a preview
function noPreview(cacheControl: string): NextResponse {
  return NextResponse.json(
    { success: false, error: "no_preview" },
    { status: 404, headers: { "Cache-Control": cacheControl } },
  );
}
