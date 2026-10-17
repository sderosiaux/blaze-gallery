import type { Folder, Photo } from "@/types";
import { formatDateRange, parseAlbumName, photoDateRange } from "@/lib/albums";

export interface AlbumData {
  folder: Folder;
  subfolders: Folder[];
  photos: Photo[];
}

export type LoadResult<T> =
  | { status: "ready"; data: T }
  | { status: "missing" }
  | { status: "error" };

// Going back to an album of 487 sub-albums should not refetch for seconds and
// lose the scroll position: the last few albums render from memory at once,
// then refresh quietly.
const CACHE_LIMIT = 24;
const cache = new Map<string, unknown>();

export function cached<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}

function remember(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
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
    const body = await response.json();
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

export function albumTitle(path: string) {
  const name = path.split("/").pop() ?? path;
  return parseAlbumName(name).title || name;
}

// Cameras with an unset clock write 1970 or a far-future year; one such file would stretch a span to decades.
const plausible = (d: string | null | undefined): d is string =>
  !!d &&
  /^\d{4}-\d{2}-\d{2}/.test(d) &&
  +d.slice(0, 4) >= 1990 &&
  +d.slice(0, 4) <= new Date().getUTCFullYear() + 1;

/** Earliest and latest date across an album: its photos, else its sub-albums. */
export function albumSpan(
  photos: Photo[],
  subfolders: Folder[],
): { from?: string; to?: string } {
  const own = photoDateRange(photos);
  if (own.from) return own;
  let from: string | undefined;
  let to: string | undefined;
  for (const f of subfolders) {
    const parsed = parseAlbumName(f.name).date;
    for (const d of [f.date_from, f.date_to, parsed]) {
      if (!plausible(d)) continue;
      if (!from || d < from) from = d;
      if (!to || d > to) to = d;
    }
  }
  return { from, to };
}

export function spanLabel(span: { from?: string; to?: string }) {
  return formatDateRange(span.from, span.to);
}
