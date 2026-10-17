"use client";

import { useEffect, useState } from "react";
import { formatCount } from "@/lib/albums";

/** GET /api/library/summary */
export interface LibraryTotals {
  photos: number;
  videos: number;
  /** Folders holding media directly */
  albums: number;
  years: { from: number; to: number } | null;
}

const STORAGE_KEY = "blaze:library-summary";

/**
 * What the library holds, for the home meta line. The counts scan every
 * photo, so one answer is kept for the session. `undefined` while loading,
 * `null` when it could not be read.
 */
export function useLibraryTotals(): LibraryTotals | null | undefined {
  const [totals, setTotals] = useState<LibraryTotals | null | undefined>(undefined);

  useEffect(() => {
    try {
      const kept = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
      if (kept && typeof kept.photos === "number") {
        setTotals(kept);
        return;
      }
    } catch {
      // No storage, or an unreadable entry: ask the server.
    }
    const controller = new AbortController();
    fetch("/api/library/summary", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error);
        const next: LibraryTotals = {
          photos: body.photos,
          videos: body.videos,
          albums: body.albums,
          years: body.years ?? null,
        };
        setTotals(next);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Not kept: the next visit asks again.
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setTotals(null);
      });
    return () => controller.abort();
  }, []);

  return totals;
}

/** ["210,595 photos", "4,792 videos", "4,154 albums", "2002 – 2024"]; undefined while loading. */
export function totalsLine(totals: LibraryTotals | null | undefined): string[] | undefined {
  if (totals === undefined) return undefined;
  if (totals === null) return ["Every album, with its photos and videos"];
  const parts = [formatCount(totals.photos, "photo")];
  if (totals.videos > 0) parts.push(formatCount(totals.videos, "video"));
  parts.push(formatCount(totals.albums, "album"));
  const { years } = totals;
  if (years) parts.push(years.from === years.to ? String(years.from) : `${years.from} – ${years.to}`);
  return parts;
}
