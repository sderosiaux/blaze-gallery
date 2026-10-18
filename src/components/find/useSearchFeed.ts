"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asString, isRecord, readJsonObject } from "@/hooks/apiJson";
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

/** The semantic page of a /api/search response: `semantic.photos`, `semantic.next`. */
export function readSemanticPage<T>(
  data: Record<string, unknown>,
): SearchFeedPage<T> {
  const semantic = isRecord(data.semantic) ? data.semantic : {};
  const items = (Array.isArray(semantic.photos) ? semantic.photos : []) as T[];
  const next = semantic.next;
  return { items, next: typeof next === "string" ? next : null };
}

/** The `filtered` page of a /api/search response: the photos the understood filters keep. */
export function readFilteredPage<T>(
  data: Record<string, unknown>,
): SearchFeedPage<T> {
  const filtered = isRecord(data.filtered) ? data.filtered : {};
  const items = (Array.isArray(filtered.photos) ? filtered.photos : []) as T[];
  const next = filtered.next;
  return { items, next: typeof next === "string" ? next : null };
}

/** Where the pages of one list come from. */
export interface FeedSource<T> {
  /** Parameters every page repeats: `q`, or `person` */
  params: Record<string, string>;
  /** Parameter carrying the cursor, e.g. `photos_after` */
  after: string;
  read: (data: Record<string, unknown>) => SearchFeedPage<T>;
}

/** `q` and the color filter, as every page of a search repeats them. */
export function searchParamsOf(
  q: string,
  colors: ColorFilter = NO_COLOR_FILTER,
): Record<string, string> {
  return Object.fromEntries(setColorParams(new URLSearchParams({ q }), colors));
}

/** One text-match list of the search for `q`, narrowed by `colors`. */
export function searchListSource<T>(
  q: string,
  list: SearchList,
  colors: ColorFilter = NO_COLOR_FILTER,
): FeedSource<T> {
  return {
    params: searchParamsOf(q, colors),
    after: `${list}_after`,
    read: (data) => readSearchPage<T>(data, list),
  };
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
 * The source is read when a page is asked for: it may be a new object on
 * every render.
 */
export function useSearchFeed<T extends { id: number | string }>(
  source: FeedSource<T>,
  first: SearchFeedPage<T>,
  total: number,
) {
  const [feed, setFeed] = useState<SearchFeed<T>>(() => ({
    ...first,
    total,
    phase: "ready",
  }));
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const loadMore = useCallback((retry = false) => {
    const { next, phase } = feedRef.current;
    if (!next || inFlight.current) return;
    if (phase !== "ready" && !(retry && phase === "more-error")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setFeed((f) => ({ ...f, phase: "more" }));
    const { params: base, after, read } = sourceRef.current;
    const params = new URLSearchParams({ ...base, [after]: next });
    fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await readJsonObject(response);
        if (!response.ok || !data.success)
          throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
        const page = read(data);
        setFeed((f) => {
          // Keyset pages only overlap when a rename lands between two
          // requests; ranked (semantic) pages may repeat a photo at a
          // page boundary.
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
  }, []);

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
