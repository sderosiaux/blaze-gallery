"use client";

import {
  NO_NOTES,
  readFilterNotes,
  type FilterNotes,
} from "@/components/find/filterNotes";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelinePhoto } from "@/components/find/timeline";
import { asArray, asString, readJsonObject } from "@/hooks/apiJson";
import { filterKey, filterQuery, type UrlFilter } from "@/lib/photoFilter";

const PAGE_SIZE = 100;

export interface ColorFeed {
  items: TimelinePhoto[];
  /** Opaque next_after of the last page; null once the least marked photo is in */
  cursor: string | null;
  phase: "loading" | "ready" | "more" | "error" | "more-error";
  /** What the list answered about its filter */
  notes: FilterNotes;
}

const START: ColorFeed = {
  items: [],
  cursor: null,
  phase: "loading",
  notes: NO_NOTES,
};

async function fetchPage(
  filter: UrlFilter,
  after: string | null,
  signal: AbortSignal,
): Promise<{
  photos: TimelinePhoto[];
  next: string | null;
  notes: FilterNotes;
}> {
  const params = filterQuery(filter);
  params.set("limit", String(PAGE_SIZE));
  if (after) params.set("after", after);
  const response = await fetch(`/api/colors?${params.toString()}`, { signal });
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return {
    photos: asArray(data.photos) as TimelinePhoto[],
    next: typeof data.next_after === "string" ? data.next_after : null,
    notes: readFilterNotes(data),
  };
}

/**
 * Photos holding the filter's color (or in its tone), most marked first,
 * passing the rest of it, a page at a time: starts over when the filter or
 * `attempt` changes; `loadMore` appends the next page (one request at a
 * time, again after a failure only with `retry`).
 */
export function useColorPhotos(filter: UrlFilter, attempt: number) {
  const [feed, setFeed] = useState<ColorFeed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const key = filterKey(filter);

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed(START);
    fetchPage(filterRef.current, null, controller.signal)
      .then(({ photos, next, notes }) => {
        setFeed({ items: photos, cursor: next, phase: "ready", notes });
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
  }, [key, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback((retry = false) => {
    const { cursor, phase } = feedRef.current;
    if (!cursor || inFlight.current) return;
    if (phase !== "ready" && !(retry && phase === "more-error")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed((f) => ({ ...f, phase: "more" }));
    fetchPage(filterRef.current, cursor, controller.signal)
      .then(({ photos, next }) => {
        setFeed((f) => {
          // Keyset pages don't overlap; this only guards a photo measured
          // again between two requests.
          const known = new Set(f.items.map((p) => String(p.id)));
          return {
            ...f,
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
  }, []);

  return { feed, loadMore };
}
