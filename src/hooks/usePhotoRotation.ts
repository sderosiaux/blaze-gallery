import { useCallback, useMemo, useRef, useState } from "react";
import type { Photo } from "@/types";
import { type QuarterTurn, turn, userRotation } from "@/lib/rotation";
import { asString, readJsonObject } from "./apiJson";

interface Options {
  /** Shared views can't turn photos. */
  enabled: boolean;
  /** Called with the photo as the server now has it. */
  onChange?: (photo: Photo) => void;
  onError?: () => void;
}

function withRotation(photo: Photo, rotation: QuarterTurn): Photo {
  return { ...photo, metadata: { ...photo.metadata, user_rotation: rotation } };
}

/**
 * Turning a photo by hand, a quarter per press. The photo only turns on
 * screen once the server has stored it: its thumbnail URL then names a
 * rotation the thumbnail route agrees with, so no browser caches a stale one
 * under it. Presses during a request add up and go as one target.
 */
export function usePhotoRotation(
  photo: Photo,
  { enabled, onChange, onError }: Options,
) {
  const [overrides, setOverrides] = useState<Record<string, QuarterTurn>>({});
  const desired = useRef(new Map<string, QuarterTurn>());
  const inFlight = useRef(new Set<string>());

  const id = String(photo.id);
  const stored = userRotation(photo.metadata);
  const rotation = overrides[id] ?? stored;
  const shown = useMemo(
    () => (rotation === stored ? photo : withRotation(photo, rotation)),
    [photo, rotation, stored],
  );

  const sync = useCallback(
    async (target: Photo, before: QuarterTurn) => {
      const key = String(target.id);
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      let server = before;
      try {
        for (let round = 0; desired.current.get(key) !== server; round++) {
          if (round === 4) throw new Error("rotation_out_of_sync");
          const response = await fetch(`/api/photos/${key}/rotate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rotation: desired.current.get(key) }),
          });
          const data = await readJsonObject(response);
          if (!response.ok || !data.success)
            throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
          server = userRotation({ user_rotation: data.user_rotation });
        }
      } catch {
        desired.current.set(key, server);
        onError?.();
      } finally {
        inFlight.current.delete(key);
        setOverrides((all) => ({ ...all, [key]: server }));
        if (server !== before) onChange?.(withRotation(target, server));
      }
    },
    [onChange, onError],
  );

  const rotate = useCallback(
    (direction: "cw" | "ccw") => {
      if (!enabled) return;
      const from = desired.current.get(id) ?? rotation;
      desired.current.set(id, turn(from, direction));
      void sync(photo, rotation);
    },
    [enabled, id, rotation, photo, sync],
  );

  return { photo: shown, rotation, rotate };
}
