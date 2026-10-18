"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asString, readJsonObject } from "@/hooks/apiJson";
import {
  NO_COLOR_FILTER,
  setColorParams,
  type ColorFilter,
} from "@/lib/colors";

export type SearchList = "photos" | "folders";

export interface SearchFeed<T> {
  items: T[];
  /** Every match, loaded or not. */
  total: number;
  /** Opaque cursor of the next page; null once every match is in. */
  next: string | null;
  phase: "ready" | "more" | "more-error";
}

export interface SearchFeedPage<T> {
  items: T[];
  next: string | null;
}

/** One page of one list, read from a /api/search response. */
export function readSearchPage<T>(
  data: Record<string, unknown>,
  list: SearchList,
): SearchFeedPage<T> {
  const items = (Array.isArray(data[list]) ? data[list] : []) as T[];
  const next = data[`next_${list}`];
  return { items, next: typeof next === "string" ? next : null };
}

/** The total the first /api/search response gives for one list. */
export function readSearchTotal(
  data: Record<string, unknown>,
  list: SearchList,
  loaded: number,
): number {
  const total = data[list === "photos" ? "photo_total" : "folder_total"];
  return typeof total === "number" ? total : loaded;
}

/**
 * One result list of /api/search past its first page: `loadMore` appends
 * the next page (one request at a time, ignored once everything is in or
 * after a failure unless `retry`), `remove` drops an item the user deleted.
 * `colors` is the filter the first page came with: the cursor goes with it.
 */
export function useSearchFeed<T extends { id: number | string }>(
  q: string,
  list: SearchList,
  first: SearchFeedPage<T>,
  total: number,
  colors: ColorFilter = NO_COLOR_FILTER,
) {
  const [feed, setFeed] = useState<SearchFeed<T>>(() => ({
    ...first,
    total,
    phase: "ready",
  }));
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback(
    (retry = false) => {
      const { next, phase } = feedRef.current;
      if (!next || inFlight.current) return;
      if (phase !== "ready" && !(retry && phase === "more-error")) return;
      const controller = new AbortController();
      inFlight.current = controller;
      setFeed((f) => ({ ...f, phase: "more" }));
      const params = setColorParams(
        new URLSearchParams({ q, [`${list}_after`]: next }),
        colors,
      );
      fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await readJsonObject(response);
          if (!response.ok || !data.success)
            throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
          const page = readSearchPage<T>(data, list);
          setFeed((f) => {
            // Pages are keyset-paginated; this only guards against a
            // rename landing between two requests.
            const known = new Set(f.items.map((item) => String(item.id)));
            return {
              ...f,
              items: [
                ...f.items,
                ...page.items.filter((item) => !known.has(String(item.id))),
              ],
              next: page.next,
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
    [q, list, colors],
  );

  const remove = useCallback((id: number | string) => {
    setFeed((f) => {
      const items = f.items.filter((item) => String(item.id) !== String(id));
      return {
        ...f,
        items,
        total: f.total - (f.items.length - items.length),
      };
    });
  }, []);

  return { feed, loadMore, remove };
}
