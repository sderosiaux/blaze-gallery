import type { Photo } from "@/types";
import { photoSources } from "@/components/photos/PhotoTile";
import { albumHref } from "@/components/photos/AlbumCard";
import { isVideo, parseAlbumName } from "@/lib/albums";
import { displayUrl } from "@/lib/photoUrls";
import { rotatedSize, userRotation } from "@/lib/rotation";

const RAW_EXTENSIONS = [
  ".nef",
  ".cr2",
  ".cr3",
  ".arw",
  ".dng",
  ".raf",
  ".orf",
  ".rw2",
  ".pef",
  ".srw",
  ".x3f",
];
// What an <img> can decode everywhere. HEIC, TIFF and RAW would cost a full
// download for nothing.
const BROWSER_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
];

export interface ViewerSources {
  /** EXIF preview, a few KB. Absent for videos. */
  preview?: string;
  thumb: string;
  /**
   * What the stage shows: the 2048 px rendition made by the server, RAW
   * included, turned by hand if the photo was. Null for videos, and for GIFs
   * that would lose their animation (unless turned: the turn wins).
   */
  display: string | null;
  /** The original, or null when a browser can't display it: zoom past the rendition, or stand in when it fails. */
  full: string | null;
  /** Shared views: the download route needs the permission; the library redirects to storage. */
  download: string;
}

export function isRawFile(photo: Pick<Photo, "filename">): boolean {
  const name = photo.filename.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function canShowOriginal(
  photo: Pick<Photo, "filename" | "mime_type">,
): boolean {
  return (
    BROWSER_IMAGE_TYPES.includes(photo.mime_type.toLowerCase()) &&
    !isRawFile(photo)
  );
}

export function viewerSources(
  photo: Photo,
  shareToken?: string,
  allowDownload = true,
): ViewerSources {
  const id = String(photo.id);
  // Same URLs as the grid tiles, so whatever a tile already loaded is a cache hit here.
  const { preview, thumb } = photoSources(photo, shareToken);
  const original = shareToken
    ? `/api/shares/${shareToken}/view/${id}`
    : `/api/photos/${id}/download`;
  const rotation = userRotation(photo.metadata);
  const animated = photo.mime_type.toLowerCase() === "image/gif";
  return {
    preview: isVideo(photo) ? undefined : preview,
    thumb,
    display:
      isVideo(photo) || (animated && !rotation)
        ? null
        : displayUrl(id, shareToken, rotation),
    // A shared link without downloads serves no original for images (see the
    // view route): zoom stops at the rendition.
    full:
      isVideo(photo) ||
      (canShowOriginal(photo) && (allowDownload || !shareToken || animated))
        ? original
        : null,
    download: shareToken
      ? `/api/shares/${shareToken}/download/${id}`
      : `/api/photos/${id}/download`,
  };
}

/**
 * What an <img> already on the page uses for this URL, once decoded. Grid
 * tiles load through the image scheduler: their src is a blob URL and the URL
 * they stand for is on `data-src`. Reusing that src paints at once, where the
 * URL itself would go back to the network.
 */
export function decodedOnPage(url: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const escaped = CSS.escape(url);
  const img = document.querySelector<HTMLImageElement>(
    `img[data-src="${escaped}"], img[src="${escaped}"]`,
  );
  return img?.complete && img.naturalWidth > 0
    ? img.currentSrc || img.src
    : undefined;
}

/**
 * Placeholder layers, cheapest first. The generated thumbnail is only asked for
 * when it already exists or a tile already holds it: otherwise the server would
 * download the whole original to make one while the browser downloads it too.
 */
export function placeholderSources(
  photo: Photo,
  sources: ViewerSources,
): { preview?: string; thumb?: string } {
  if (isVideo(photo)) return {};
  const preview = sources.preview
    ? (decodedOnPage(sources.preview) ?? sources.preview)
    : undefined;
  const thumb =
    decodedOnPage(sources.thumb) ??
    (photo.thumbnail_status === "generated" ? sources.thumb : undefined);
  return { preview, thumb };
}

export interface AlbumCrumb {
  name: string;
  path: string;
  href: string;
}

/** The folders a photo lives in, outermost first, from its storage key. */
export function albumCrumbs(photo: Pick<Photo, "s3_key">): AlbumCrumb[] {
  const parts = photo.s3_key.split("/").slice(0, -1);
  return parts.map((name, i) => {
    const path = parts.slice(0, i + 1).join("/");
    return { name, path, href: albumHref(path) };
  });
}

export function albumOf(
  photo: Pick<Photo, "s3_key">,
): { title: string; href: string } | null {
  const crumbs = albumCrumbs(photo);
  const last = crumbs[crumbs.length - 1];
  return last
    ? { title: parseAlbumName(last.name).title, href: last.href }
    : null;
}

/** Width / height as shown, hand rotation included. */
export function photoRatio(photo: Photo): number | undefined {
  const stored = photo.metadata?.dimensions;
  if (!stored || stored.width <= 0 || stored.height <= 0) return undefined;
  const dims = rotatedSize(stored, userRotation(photo.metadata));
  return dims.width / dims.height;
}
