"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TimelinePhoto } from "@/components/find/timeline";
import type { UrlFilter } from "@/lib/photoFilter";
import type { MapBox, MapPeriod } from "@/lib/mapArea";
import { fetchAreaPage } from "./mapData";

export interface AreaFeed {
  items: TimelinePhoto[];
  /** Every photo of the zone and period, loaded or not */
  total: number;
  /** Opaque next_after of the last page; null once the oldest photo is in */
  cursor: string | null;
  phase: "loading" | "ready" | "more" | "error" | "more-error";
}

const START: AreaFeed = { items: [], total: 0, cursor: null, phase: "loading" };

/**
 * Photos of the selected zone and period passing the filter, newest first, a page at
 * a time: starts over whenever one of them or `attempt` changes; `loadMore`
 * appends the next page (one request at a time, again after a failure only
 * with `retry`).
 */
export function useAreaPhotos(
  box: MapBox | null,
  period: MapPeriod,
  filter: UrlFilter,
  attempt: number,
) {
  const [feed, setFeed] = useState<AreaFeed>(START);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);
  const query = useRef({ box, period, filter });
  query.current = { box, period, filter };

  useEffect(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    setFeed(START);
    if (!box) return;
    const controller = new AbortController();
    inFlight.current = controller;
    fetchAreaPage(box, period, filter, null, controller.signal)
      .then(({ photos, next, total }) => {
        setFeed({
          items: photos,
          total: total ?? photos.length,
          cursor: next,
          phase: "ready",
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
  }, [box, period, filter, attempt]);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback((retry = false) => {
    const { cursor, phase } = feedRef.current;
    const {
      box: current,
      period: currentPeriod,
      filter: currentFilter,
    } = query.current;
    if (!current || !cursor || inFlight.current) return;
    if (phase !== "ready" && !(retry && phase === "more-error")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed((f) => ({ ...f, phase: "more" }));
    fetchAreaPage(
      current,
      currentPeriod,
      currentFilter,
      cursor,
      controller.signal,
    )
      .then(({ photos, next }) => {
        setFeed((f) => {
          // Keyset pages don't overlap; this only guards a photo dated
          // between two requests.
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
