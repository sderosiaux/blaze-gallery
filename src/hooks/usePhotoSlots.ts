import { useCallback, useMemo, useState } from "react";
import type { Photo } from "@/types";
import { applyPhotoPatch, type PhotoPatch } from "@/lib/photoPatch";

/** `photos` as they show with each slot's photo now: usePhotoSlots' items. */
export function slotItems<T extends Photo>(
  photos: readonly T[],
  slots: ReadonlyMap<string, T | null>,
): T[] {
  const seen = new Set<string>();
  return photos.flatMap((photo) => {
    const key = String(photo.id);
    const now = slots.has(key) ? slots.get(key) : photo;
    if (!now || seen.has(String(now.id))) return [];
    seen.add(String(now.id));
    if (now === photo || String(now.id) !== key) return [now];
    const { stack: _, ...base } = photo;
    return [(now.stack ? { ...base, stack: now.stack } : base) as T];
  });
}

/**
 * A list's photos as the page shows them after the viewer or a tile
 * changed a slot: a photo sent to the Corbeille empties its slot (null), a
 * front that stays shows its stack counted again, a kept front stands
 * alone, « Annuler » puts the photo back. Keyed by the slot's photo in the
 * list as loaded. A slot that keeps its photo only takes the new stack
 * from the replacement: the list's own changes to that photo (a
 * favourite) still show. A photo shows once: the next front of a stack may
 * come in a page the list loads later, where the server now puts it.
 */
export function usePhotoSlots<T extends Photo>(photos: readonly T[]) {
  const [slots, setSlots] = useState<ReadonlyMap<string, T | null>>(
    () => new Map(),
  );
  const items = useMemo(() => slotItems(photos, slots), [photos, slots]);
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
