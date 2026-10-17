/**
 * Bump when existing thumbnails are regenerated (they are served immutable,
 * so only a new URL makes browsers fetch the new image).
 * v2: EXIF orientation applied, RAW thumbnails from the embedded JPEG.
 */
export const THUMBNAIL_VERSION = 2;

export function thumbnailUrl(
  photoId: number | string,
  shareToken?: string,
  rotation = 0,
): string {
  const id = String(photoId);
  // The hand rotation is part of the URL: a rotated photo is a new image.
  const r = rotation ? `&r=${rotation}` : "";
  return shareToken
    ? `/api/shares/${shareToken}/thumbnail/${id}?v=${THUMBNAIL_VERSION}${r}`
    : `/api/photos/${id}/thumbnail?v=${THUMBNAIL_VERSION}${r}`;
}

export function previewUrl(
  photoId: number | string,
  shareToken?: string,
  rotation = 0,
): string {
  const id = String(photoId);
  const r = rotation ? `?r=${rotation}` : "";
  return shareToken
    ? `/api/shares/${shareToken}/preview/${id}${r}`
    : `/api/photos/${id}/preview${r}`;
}

/**
 * Screen-sized rendition (2048 px, ~400 KB) shown by the viewer instead of the
 * original; built once on first view and stored next to the thumbnails.
 */
export function displayUrl(
  photoId: number | string,
  shareToken?: string,
  rotation = 0,
): string {
  const id = String(photoId);
  const r = rotation ? `?r=${rotation}` : "";
  return shareToken
    ? `/api/shares/${shareToken}/display/${id}${r}`
    : `/api/photos/${id}/display${r}`;
}
