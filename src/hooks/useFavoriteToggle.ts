import { useCallback, useRef, useState } from "react";
import type { Photo } from "@/types";

interface Options {
  /** Shared views can't favourite. */
  enabled: boolean;
  /** Called with the photo as the server now has it. */
  onChange?: (photo: Photo) => void;
  onError?: () => void;
}

/**
 * Optimistic favourite toggle, keyed by photo so moving to the next photo
 * mid-request never paints the wrong heart. The route flips the flag rather
 * than setting it, so requests for one photo go one at a time until the
 * server agrees with the last press.
 */
export function useFavoriteToggle(photo: Photo, { enabled, onChange, onError }: Options) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const desired = useRef(new Map<string, boolean>());
  // What the server last said, for parents that don't pass the update back down.
  const known = useRef(new Map<string, boolean>());
  const inFlight = useRef(new Set<string>());

  const id = String(photo.id);
  const isFavorite = overrides[id] ?? photo.is_favorite;

  const sync = useCallback(
    async (target: Photo) => {
      const key = String(target.id);
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      const before = known.current.get(key) ?? target.is_favorite;
      let server = before;
      try {
        for (let round = 0; desired.current.get(key) !== server; round++) {
          if (round === 4) throw new Error("favorite_out_of_sync");
          const response = await fetch(`/api/photos/${key}/favorite`, { method: "POST" });
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
          server = Boolean(data.is_favorite);
        }
      } catch {
        desired.current.set(key, server);
        onError?.();
      } finally {
        inFlight.current.delete(key);
        known.current.set(key, server);
        setOverrides((all) => ({ ...all, [key]: server }));
        if (server !== before) onChange?.({ ...target, is_favorite: server });
      }
    },
    [onChange, onError],
  );

  const toggle = useCallback(() => {
    if (!enabled) return;
    const next = !isFavorite;
    desired.current.set(id, next);
    setOverrides((all) => ({ ...all, [id]: next }));
    void sync(photo);
  }, [enabled, id, isFavorite, photo, sync]);

  return { isFavorite, toggle };
}
