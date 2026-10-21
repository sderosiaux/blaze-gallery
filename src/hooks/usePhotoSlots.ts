import { useCallback, useMemo, useState } from "react";
import type { Photo } from "@/types";

/**
 * A list's photos as the page shows them after the viewer or a tile
 * changed what stands in a slot: a photo sent to the Corbeille leaves its
 * slot (null), the next photo of its stack takes it, an « Annuler » puts
 * the first one back. Keyed by the slot's photo in the list as loaded, so
 * a slot can change hands several times and still be found.
 */
export function usePhotoSlots<T extends Photo>(photos: readonly T[]) {
  const [slots, setSlots] = useState<ReadonlyMap<string, T | null>>(
    () => new Map(),
  );
  const items = useMemo(
    () =>
      photos.flatMap((photo) => {
        const key = String(photo.id);
        if (!slots.has(key)) return [photo];
        const now = slots.get(key);
        return now ? [now] : [];
      }),
    [photos, slots],
  );
  /** The photo `id` shows in its slot now gives way to `next` (null: the slot empties). */
  const replace = useCallback((id: Photo["id"], next: Photo | null) => {
    setSlots((all) => {
      const wanted = String(id);
      let key = wanted;
      for (const [slot, now] of all)
        if (now && String(now.id) === wanted) key = slot;
      const copy = new Map(all);
      if (next !== null && String(next.id) === key) copy.delete(key);
      else copy.set(key, next as T | null);
      return copy;
    });
  }, []);
  return { items, replace };
}
