"use client";

import { useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The open photo lives in `?photo=`, so a link reopens it and Back closes the
 * viewer. Opening pushes one history entry, moving between photos replaces
 * it, and closing pops it again when this page pushed it.
 *
 * Native history calls (synced with useSearchParams since Next 14.1) instead
 * of router.push: the URL changes at once, without a server round trip that
 * could land after the viewer has already moved on to another photo.
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
    } else if (!photoId && pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      window.history.replaceState(null, "", href);
    }
  }, []);

  return [selected, setPhoto];
}
