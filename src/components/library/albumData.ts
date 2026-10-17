import type { Folder, Photo } from "@/types";
import { photoDateRange } from "@/lib/albums";
import { readJsonObject } from "@/hooks/apiJson";

export interface AlbumData {
  folder: Folder;
  subfolders: Folder[];
  photos: Photo[];
}

export type LoadResult<T> =
  | { status: "ready"; data: T }
  | { status: "missing" }
  | { status: "error" };

// Going back to a folder of 487 sub-folders should not refetch for seconds and
// lose the scroll position: the last few folders render from memory at once,
// then refresh quietly.
const CACHE_LIMIT = 24;
const cache = new Map<string, unknown>();

export function cached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

export function forget(key: string) {
  cache.delete(key);
}

async function getJson<T>(
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<LoadResult<T>> {
  try {
    const response = await fetch(url, { signal });
    if (response.status === 404) {
      forget(key);
      return { status: "missing" };
    }
    if (!response.ok) return { status: "error" };
    const body = await readJsonObject(response);
    if (!body.success) return { status: "error" };
    remember(key, body);
    return { status: "ready", data: body as T };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: "error" };
  }
}

export const albumKey = (path: string) => `album:${path}`;
export const ROOT_KEY = "library:root";

export function loadAlbum(path: string, signal?: AbortSignal) {
  return getJson<AlbumData>(
    `/api/folders/${encodeURIComponent(path)}`,
    albumKey(path),
    signal,
  );
}

export function loadRootAlbums(signal?: AbortSignal) {
  return getJson<{ folders: Folder[]; photos: Photo[] }>(
    "/api/folders",
    ROOT_KEY,
    signal,
  );
}

/** Folder segments as the route receives them, decoded once, tolerant of stray `%`. */
export function pathFromSegments(segments: string[] | undefined): string {
  return (segments ?? [])
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join("/");
}

/** The last segment of a path: a folder's name exactly as it is in the bucket. */
export function folderName(path: string) {
  const last = path.split("/").pop();
  return last !== undefined && last !== "" ? last : path;
}

// Cameras with an unset clock write 1970 or a far-future year; one such file would stretch a range to decades.
const plausible = (d: string | null | undefined): d is string =>
  !!d &&
  /^\d{4}-\d{2}-\d{2}/.test(d) &&
  +d.slice(0, 4) >= 1990 &&
  +d.slice(0, 4) <= new Date().getUTCFullYear() + 1;

/** When a folder's own photos were taken. Sub-folders don't count: their cards carry their own dates. */
export function photosSpan(photos: Photo[]): { from?: string; to?: string } {
  return photoDateRange(
    photos.filter((p) => plausible(p.metadata?.date_taken)),
  );
}

let bucket: string | null | undefined;
const BUCKET_KEY = "blaze:bucket";

export function cachedBucketName(): string | null | undefined {
  if (bucket !== undefined) return bucket;
  try {
    return sessionStorage.getItem(BUCKET_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The B2 bucket the top-level folders come from; null when it can't be read. */
export async function loadBucketName(signal?: AbortSignal) {
  try {
    const response = await fetch("/api/bucket", { signal });
    const body = await readJsonObject(response);
    bucket = response.ok && body.success ? String(body.bucket) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    bucket = null;
  }
  if (bucket) {
    try {
      sessionStorage.setItem(BUCKET_KEY, bucket);
    } catch {
      // Not kept: the next visit asks again.
    }
  }
  return bucket;
}
