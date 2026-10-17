"use client";

import { useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The open photo lives in `?photo=` so a link reopens it and Back closes the
 * viewer. Opening pushes one history entry, moving between photos replaces
 * it, closing pops it when this page pushed it (a deep link is replaced
 * instead, so closing never leaves the site).
 *
 * Native history calls, which Next keeps in sync with useSearchParams: a
 * router.push would refetch the page payload on every photo change and
 * compete with the thumbnails for connections.
 */
export function usePhotoParam(): [
  string | null,
  (photoId: string | null) => void,
] {
  const selected = useSearchParams()?.get("photo") ?? null;
  const pushed = useRef(false);

  const setPhoto = useCallback((photoId: string | null) => {
    const url = new URL(window.location.href);
    const wasOpen = url.searchParams.has("photo");
    if (photoId) url.searchParams.set("photo", photoId);
    else url.searchParams.delete("photo");
    const href = url.pathname + url.search + url.hash;

    if (photoId && !wasOpen) {
      pushed.current = true;
      window.history.pushState(null, "", href);
    } else if (!photoId && wasOpen && pushed.current) {
      pushed.current = false;
      window.history.back();
    } else if (photoId || wasOpen) {
      window.history.replaceState(null, "", href);
    }
  }, []);

  return [selected, setPhoto];
}
