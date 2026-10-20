"use client";

import {
  NO_NOTES,
  readFilterNotes,
  type FilterNotes,
} from "@/components/find/filterNotes";
import { useCallback, useEffect, useRef, useState } from "react";
import { asString, readJsonObject } from "@/hooks/apiJson";
import { filterQuery, type UrlFilter } from "@/lib/photoFilter";
import type { TimelinePhoto } from "./timeline";

const PAGE_SIZE = 200;

export interface TimelineFeed {
  items: TimelinePhoto[];
  /** Opaque next_before of the last page; null once the oldest photo is in. */
  cursor: string | null;
  phase: "loading" | "ready" | "more" | "error" | "more-error";
  /** What the list answered about its filter */
  notes: FilterNotes;
}

const START: TimelineFeed = {
  items: [],
  cursor: null,
  phase: "loading",
  notes: NO_NOTES,
};

async function fetchPage(
  before: string | null,
  filter: UrlFilter,
  folder: string | null,
  signal: AbortSignal,
): Promise<{
  photos: TimelinePhoto[];
  next: string | null;
  notes: FilterNotes;
}> {
  const params = filterQuery(filter);
  params.set("limit", String(PAGE_SIZE));
  if (before) params.set("before", before);
  if (folder) params.set("folder", folder);
  const response = await fetch(`/api/timeline?${params.toString()}`, {
    signal,
  });
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return {
    photos: (Array.isArray(data.photos) ? data.photos : []) as TimelinePhoto[],
    next: typeof data.next_before === "string" ? data.next_before : null,
    notes: readFilterNotes(data),
  };
}

/** Pages can overlap if the backfill dates a photo between two requests. */
function unseen(seen: Set<string>, photos: TimelinePhoto[]) {
  return photos.filter((p) => {
    const id = String(p.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The dated photos passing `filter` (under `folder` when given), newest
 * first from `start` (a `before` cursor), a page at a time: starts over
 * when any of them or `attempt` changes; `loadMore` appends the next page
 * (one request at a time, again after a failure only with `retry`).
 * `filterKey` keys the filter, so a new object with the same conditions
 * changes nothing.
 */
export function useTimelineFeed(
  filter: UrlFilter,
  filterKey: string,
  folder: string | null,
  start: string | null,
  attempt: number,
) {
  const [feed, setFeed] = useState<TimelineFeed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const query = useRef({ filter, folder });
  query.current = { filter, folder };

  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    seen.current = new Set();
    setFeed(START);
    const { filter: current, folder: under } = query.current;
    fetchPage(start, current, under, controller.signal)
      .then(({ photos, next, notes }) => {
        setFeed({
          items: unseen(seen.current, photos),
          cursor: next,
          phase: "ready",
          notes,
        });
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
  }, [filterKey, folder, start, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback((retry = false) => {
    const { cursor, phase } = feedRef.current;
    if (!cursor || inFlight.current) return;
    if (phase !== "ready" && !(retry && phase === "more-error")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed((f) => ({ ...f, phase: "more" }));
    const { filter: current, folder: under } = query.current;
    fetchPage(cursor, current, under, controller.signal)
      .then(({ photos, next }) => {
        setFeed((f) => ({
          ...f,
          items: [...f.items, ...unseen(seen.current, photos)],
          cursor: next,
          phase: "ready",
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setFeed((f) => ({ ...f, phase: "more-error" }));
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
  }, []);

  return { feed, setFeed, loadMore };
}
