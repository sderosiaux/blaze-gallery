"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelinePhoto } from "@/components/find/timeline";
import { asArray, asString, readJsonObject } from "@/hooks/apiJson";
import { setColorParams, type ColorFilter } from "@/lib/colors";

const PAGE_SIZE = 100;

export interface ColorFeed {
  items: TimelinePhoto[];
  /** Opaque next_after of the last page; null once the least marked photo is in */
  cursor: string | null;
  phase: "loading" | "ready" | "more" | "error" | "more-error";
}

const START: ColorFeed = { items: [], cursor: null, phase: "loading" };

async function fetchPage(
  colors: ColorFilter,
  after: string | null,
  signal: AbortSignal,
) {
  const params = setColorParams(
    new URLSearchParams({ limit: String(PAGE_SIZE) }),
    colors,
  );
  if (after) params.set("after", after);
  const response = await fetch(`/api/colors?${params.toString()}`, { signal });
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return {
    photos: asArray(data.photos) as TimelinePhoto[],
    next: typeof data.next_after === "string" ? data.next_after : null,
  };
}

/**
 * Photos holding a color (or in a tone), most marked first, a page at a
 * time: starts over when the filter or `attempt` changes; `loadMore`
 * appends the next page (one request at a time, again after a failure only
 * with `retry`), `remove` drops a photo deleted from the viewer.
 */
export function useColorPhotos(colors: ColorFilter, attempt: number) {
  const [feed, setFeed] = useState<ColorFeed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed(START);
    fetchPage(colors, null, controller.signal)
      .then(({ photos, next }) => {
        setFeed({ items: photos, cursor: next, phase: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setFeed((f) => ({ ...f, phase: "error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
    return () => {
      controller.abort();
    };
  }, [colors, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback(
    (retry = false) => {
      const { cursor, phase } = feedRef.current;
      if (!cursor || inFlight.current) return;
      if (phase !== "ready" && !(retry && phase === "more-error")) return;
      const controller = new AbortController();
      inFlight.current = controller;
      setFeed((f) => ({ ...f, phase: "more" }));
      fetchPage(colors, cursor, controller.signal)
        .then(({ photos, next }) => {
          setFeed((f) => {
            // Keyset pages don't overlap; this only guards a photo measured
            // again between two requests.
            const known = new Set(f.items.map((p) => String(p.id)));
            return {
              items: [
                ...f.items,
                ...photos.filter((p) => !known.has(String(p.id))),
              ],
              cursor: next,
              phase: "ready",
            };
          });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setFeed((f) => ({ ...f, phase: "more-error" }));
        })
        .finally(() => {
          if (inFlight.current === controller) inFlight.current = null;
        });
    },
    [colors],
  );

  const remove = useCallback((id: TimelinePhoto["id"]) => {
    setFeed((f) => ({
      ...f,
      items: f.items.filter((p) => String(p.id) !== String(id)),
    }));
  }, []);

  return { feed, loadMore, remove };
}
