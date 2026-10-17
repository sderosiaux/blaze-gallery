import type { Photo } from "@/types";
import { photoSources } from "@/components/photos/PhotoTile";
import { albumHref } from "@/components/photos/AlbumCard";
import { isVideo, parseAlbumName } from "@/lib/albums";

const RAW_EXTENSIONS = [".nef", ".cr2", ".cr3", ".arw", ".dng", ".raf", ".orf", ".rw2", ".pef", ".srw", ".x3f"];
// What an <img> can decode everywhere. HEIC, TIFF and RAW would cost a full
// download for nothing.
const BROWSER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"];

export interface ViewerSources {
  /** EXIF preview, a few KB. Absent for videos. */
  preview?: string;
  thumb: string;
  /** What the stage shows at full size: the original, or null when a browser can't display it. */
  full: string | null;
  /** Shared views: the download route needs the permission; the library redirects to storage. */
  download: string;
}

export function isRawFile(photo: Pick<Photo, "filename">): boolean {
  const name = photo.filename.toLowerCase();
  return RAW_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function canShowOriginal(photo: Pick<Photo, "filename" | "mime_type">): boolean {
  return BROWSER_IMAGE_TYPES.includes(photo.mime_type.toLowerCase()) && !isRawFile(photo);
}

export function viewerSources(photo: Photo, shareToken?: string): ViewerSources {
  const id = String(photo.id);
  // Same URLs as the grid tiles, so whatever a tile already loaded is a cache hit here.
  const { preview, thumb } = photoSources(photo, shareToken);
  const original = shareToken ? `/api/shares/${shareToken}/view/${id}` : `/api/photos/${id}/download`;
  return {
    preview: isVideo(photo) ? undefined : preview,
    thumb,
    full: isVideo(photo) || canShowOriginal(photo) ? original : null,
    download: shareToken ? `/api/shares/${shareToken}/download/${id}` : `/api/photos/${id}/download`,
  };
}

/** True when an <img> on the page already holds this URL, decoded. */
export function isOnPage(src: string): boolean {
  if (typeof document === "undefined") return false;
  const img = document.querySelector<HTMLImageElement>(`img[src="${CSS.escape(src)}"]`);
  return Boolean(img?.complete && img.naturalWidth > 0);
}

/**
 * Placeholder layers, cheapest first. The generated thumbnail is only asked for
 * when it already exists or a tile already holds it: otherwise the server would
 * download the whole original to make one while the browser downloads it too.
 */
export function placeholderSources(photo: Photo, sources: ViewerSources): { preview?: string; thumb?: string } {
  if (isVideo(photo)) return {};
  const thumbCheap = photo.thumbnail_status === "generated" || isOnPage(sources.thumb);
  return { preview: sources.preview, thumb: thumbCheap ? sources.thumb : undefined };
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

export function albumOf(photo: Pick<Photo, "s3_key">): { title: string; href: string } | null {
  const crumbs = albumCrumbs(photo);
  const last = crumbs[crumbs.length - 1];
  return last ? { title: parseAlbumName(last.name).title, href: last.href } : null;
}

export function photoRatio(photo: Photo): number | undefined {
  const dims = photo.metadata?.dimensions;
  return dims && dims.width > 0 && dims.height > 0 ? dims.width / dims.height : undefined;
}
