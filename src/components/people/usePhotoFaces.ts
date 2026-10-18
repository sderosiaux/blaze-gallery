"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoFace } from "@/lib/people";
import { asArray, readJsonObject } from "@/hooks/apiJson";

export interface PhotoFaces {
  faces: PhotoFace[];
  /** False while the faces pass has not looked at the photo yet */
  analyzed: boolean;
}

type State =
  | { key: string; status: "loading" }
  | { key: string; status: "error" }
  | ({ key: string; status: "ready" } & PhotoFaces);

/** Kept while the viewer walks back and forth; dropped on any change. */
const cache = new Map<string, PhotoFaces>();

async function fetchFaces(
  photoId: string,
  signal?: AbortSignal,
): Promise<PhotoFaces> {
  const response = await fetch(
    `/api/photos/${encodeURIComponent(photoId)}/faces`,
    { signal },
  );
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new Error(`HTTP ${response.status}`);
  return {
    faces: asArray(data.faces) as PhotoFace[],
    analyzed: data.analyzed === true,
  };
}

/**
 * The faces of a photo, fetched only while `enabled`. The boxes come turned
 * by the photo's hand rotation: a new rotation is a new fetch.
 */
export function usePhotoFaces(
  photoId: string,
  rotation: number,
  enabled: boolean,
) {
  const key = `${photoId}:${String(rotation)}`;
  const [state, setState] = useState<State | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const hit = cache.get(key);
    if (hit) {
      setState({ key, status: "ready", ...hit });
      return;
    }
    const controller = new AbortController();
    setState({ key, status: "loading" });
    fetchFaces(photoId, controller.signal)
      .then((result) => {
        cache.set(key, result);
        setState({ key, status: "ready", ...result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, status: "error" });
      });
    return () => {
      controller.abort();
    };
  }, [key, photoId, enabled, version]);

  const reload = useCallback(() => {
    cache.delete(key);
    setVersion((v) => v + 1);
  }, [key]);

  const current = state?.key === key ? state : null;
  return { state: current, reload };
}
