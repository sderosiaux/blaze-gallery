import { useCallback, useMemo, useState } from "react";
import type { Photo } from "@/types";
import { applyPhotoPatch, type PhotoPatch } from "@/lib/photoPatch";

/**
 * A list's photos as the page shows them after the viewer or a tile
 * changed what stands in a slot: a photo sent to the Corbeille leaves its
 * slot (null), the next photo of its stack takes it, a kept photo stands
 * alone, « Annuler » puts the first one back. Keyed by the slot's photo in
 * the list as loaded, so a slot can change hands several times and still
 * be found. A slot that keeps its photo only takes the new stack from the
 * replacement: the list's own changes to that photo (a favourite) still show.
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
        if (!now) return [];
        if (String(now.id) !== key) return [now];
        const { stack: _, ...base } = photo;
        return [(now.stack ? { ...base, stack: now.stack } : base) as T];
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
      return new Map(all).set(key, next as T | null);
    });
  }, []);
  /** A change to a photo standing in another's slot (the list only knows the first one). */
  const patch = useCallback((id: Photo["id"], change: PhotoPatch) => {
    setSlots((all) => {
      let changed = false;
      const copy = new Map(all);
      for (const [slot, now] of all)
        if (now && String(now.id) === String(id) && String(now.id) !== slot) {
          copy.set(slot, applyPhotoPatch(now, change));
          changed = true;
        }
      return changed ? copy : all;
    });
  }, []);
  return { items, replace, patch };
}
