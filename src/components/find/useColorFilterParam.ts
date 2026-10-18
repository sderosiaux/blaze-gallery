"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { readUrlColorFilter, type ColorFilter } from "@/lib/colors";

/**
 * The color filter lives in `?color=` and `?tone=`, so a reload, a link or
 * Back restores it. Each choice is a new history entry; the other
 * parameters stay. The filter object only changes with its values, so
 * effects keyed on it stay put.
 */
export function useColorFilterParam(): [
  ColorFilter,
  (next: ColorFilter) => void,
] {
  const params = useSearchParams();
  const color = params.get("color");
  const tone = params.get("tone");
  const filter = useMemo(
    () =>
      readUrlColorFilter((key) =>
        key === "color" ? color : key === "tone" ? tone : null,
      ),
    [color, tone],
  );

  const setFilter = useCallback((next: ColorFilter) => {
    const url = new URL(window.location.href);
    for (const [key, value] of [
      ["color", next.color],
      ["tone", next.tone],
    ] as const) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }, []);

  return [filter, setFilter];
}
