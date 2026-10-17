/**
 * Bump when existing thumbnails are regenerated (they are served immutable,
 * so only a new URL makes browsers fetch the new image).
 * v2: EXIF orientation applied, RAW thumbnails from the embedded JPEG.
 */
export const THUMBNAIL_VERSION = 2;

export function thumbnailUrl(
  photoId: number | string,
  shareToken?: string,
): string {
  const id = String(photoId);
  return shareToken
    ? `/api/shares/${shareToken}/thumbnail/${id}?v=${THUMBNAIL_VERSION}`
    : `/api/photos/${id}/thumbnail?v=${THUMBNAIL_VERSION}`;
}

export function previewUrl(
  photoId: number | string,
  shareToken?: string,
): string {
  const id = String(photoId);
  return shareToken
    ? `/api/shares/${shareToken}/preview/${id}`
    : `/api/photos/${id}/preview`;
}
