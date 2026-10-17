import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Photo } from "@/types";

export interface PhotoNavigation {
  current: Photo;
  /** -1 when the photo isn't in the list (the parent dropped it while open). */
  index: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  goToPrevious: () => Photo | null;
  goToNext: () => Photo | null;
  goTo: (index: number) => Photo | null;
  /** Photos worth preloading, nearest first. */
  neighbours: Photo[];
}

/**
 * Where the viewer stands in the album. The parent owns the selection: the
 * viewer asks for a change through `onPhotoChange` and follows the `photo` prop,
 * but moves at once so a parent that never answers still navigates.
 */
export function usePhotoNavigation(
  photo: Photo,
  photos: Photo[] | undefined,
  onPhotoChange?: (photo: Photo) => void,
): PhotoNavigation {
  const list = useMemo(() => photos ?? [photo], [photos, photo]);
  const [currentId, setCurrentId] = useState(String(photo.id));
  const lastIndex = useRef(0);

  useEffect(() => setCurrentId(String(photo.id)), [photo.id]);

  const found = list.findIndex((p) => String(p.id) === currentId);
  if (found !== -1) lastIndex.current = found;
  const current =
    found !== -1 ? list[found] : String(photo.id) === currentId ? photo : (list[lastIndex.current] ?? photo);
  const index = found;
  // When the current photo vanished, its old slot is where "next" now lives.
  const base = found !== -1 ? found : lastIndex.current - 0.5;

  const goTo = useCallback(
    (target: number): Photo | null => {
      const next = list[target];
      if (!next || String(next.id) === currentId) return null;
      setCurrentId(String(next.id));
      onPhotoChange?.(next);
      return next;
    },
    [list, currentId, onPhotoChange],
  );

  const previousIndex = Math.ceil(base) - 1;
  const nextIndex = Math.floor(base) + 1;
  const goToPrevious = useCallback(() => goTo(previousIndex), [goTo, previousIndex]);
  const goToNext = useCallback(() => goTo(nextIndex), [goTo, nextIndex]);

  const neighbours = useMemo(
    () => [nextIndex, previousIndex, nextIndex + 1].map((i) => list[i]).filter((p): p is Photo => Boolean(p)),
    [list, nextIndex, previousIndex],
  );

  return {
    current,
    index,
    total: list.length,
    hasPrevious: previousIndex >= 0,
    hasNext: nextIndex < list.length,
    goToPrevious,
    goToNext,
    goTo,
    neighbours,
  };
}
