"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  filterKey,
  readUrlFilter,
  writeUrlFilter,
  type UrlFilter,
} from "@/lib/photoFilter";

/** Where a list starts (Chronologie, a person's page): a place among the photos of the filter before. */
const POSITION_KEYS = ["year", "month"];

/**
 * The filter of the page, in its URL (lib/photoFilter.ts), so a reload, a
 * link or Back restores it and another view reads the same one. Each change
 * is a new history entry; the view's own parameters stay, but the list
 * starts over from the newest. The filter object and its key only change
 * with its conditions, so effects keyed on them stay put.
 */
export function useUrlFilter(): [UrlFilter, (next: UrlFilter) => void] {
  const params = useSearchParams();
  const read = readUrlFilter(new URLSearchParams(params.toString()));
  const key = filterKey(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key says when it changed
  const filter = useMemo(() => read, [key]);

  const setFilter = useCallback((next: UrlFilter) => {
    const url = new URL(window.location.href);
    writeUrlFilter(url.searchParams, next);
    for (const key of POSITION_KEYS) url.searchParams.delete(key);
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }, []);

  return [filter, setFilter];
}
