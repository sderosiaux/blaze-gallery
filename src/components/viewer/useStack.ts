"use client";

import { useCallback, useEffect, useState } from "react";
import type { Photo } from "@/types";
import { asArray, readJsonObject } from "@/hooks/apiJson";

interface State {
  key: string;
  photos: Photo[];
}

/** Kept while the viewer walks back and forth; dropped each time it opens. */
const cache = new Map<string, Photo[]>();

export function forgetStacks(): void {
  cache.clear();
}

async function fetchStack(photoId: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/photos/${encodeURIComponent(photoId)}/stack`,
    { signal },
  );
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new Error(`HTTP ${response.status}`);
  return asArray(data.photos) as Photo[];
}

/**
 * The stack a list's photo fronts (photo_groups), best first, and which of
 * its photos is shown. `front` is the photo of the list; null without a
 * stack, until its photos are in, or when they could not be read (the
 * viewer then shows the front alone). The shown photo starts as the front
 * each time the list moves to another photo.
 */
export function useStack(front: Photo, enabled: boolean) {
  const key = String(front.id);
  const stacked = enabled && front.stack !== undefined;
  const [state, setState] = useState<State | null>(null);
  const [shown, setShown] = useState<{ key: string; id: number } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!stacked) return;
    const hit = cache.get(key);
    if (hit) {
      setState({ key, photos: hit });
      return;
    }
    const controller = new AbortController();
    fetchStack(key, controller.signal)
      .then((photos) => {
        cache.set(key, photos);
        setState({ key, photos });
      })
      .catch(() => {
        // The front alone, as without a stack
      });
    return () => {
      controller.abort();
    };
  }, [key, stacked, version]);

  const photos =
    stacked && state?.key === key && state.photos.length > 1
      ? state.photos
      : null;
  const shownId = shown?.key === key ? shown.id : front.id;
  // Ids come as strings from some routes (int8), numbers from others
  const index = photos
    ? photos.findIndex((p) => String(p.id) === String(shownId))
    : -1;
  // The front as the list has it (a favourite, a turn the list knows of)
  const photo =
    String(shownId) === String(front.id) || !photos || index < 0
      ? front
      : photos[index];

  const show = useCallback(
    (id: number) => {
      setShown({ key, id });
    },
    [key],
  );
  const step = useCallback(
    (by: 1 | -1) => {
      if (!photos) return false;
      const at = Math.max(0, index);
      const next = photos[at + by];
      if (!next) return false;
      setShown({ key, id: next.id });
      return true;
    },
    [photos, index, key],
  );

  /** After a photo of it went to the Corbeille or came back: read the stack again. */
  const forget = useCallback(() => {
    cache.clear();
    setState(null);
    setShown(null);
    setVersion((v) => v + 1);
  }, []);

  return {
    forget,
    /** The stack's photos, best first; null when the front is alone */
    photos,
    /** The photo shown: the front, or the one chosen in its stack */
    photo: photo ?? front,
    index: Math.max(0, index),
    show,
    /** One photo up or down the stack; false at its ends or without one */
    step,
  };
}
