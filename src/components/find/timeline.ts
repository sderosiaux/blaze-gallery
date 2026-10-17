import type { Photo } from "@/types";
import { formatDay } from "@/lib/albums";

/** "YYYY-MM" of date taken, as returned by /api/timeline/summary */
export interface MonthCount {
  month: string;
  count: number;
}

export interface TimelineSummary {
  months: MonthCount[];
  /** Every row of the library, dated or not, when the API provides it */
  total_photos?: number;
}

export interface YearCount {
  year: number;
  count: number;
}

export type TimelinePhoto = Photo & { folder_path: string };

export interface MonthGroup {
  key: string;
  photos: TimelinePhoto[];
}

export async function fetchTimelineSummary(
  signal?: AbortSignal,
): Promise<TimelineSummary> {
  const response = await fetch("/api/timeline/summary", { signal });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(data.error ?? `HTTP ${response.status}`);
  return { months: data.months ?? [], total_photos: data.total_photos };
}

/** Newest year first, like the months. */
export function yearsOf(months: MonthCount[]): YearCount[] {
  const byYear = new Map<number, number>();
  for (const { month, count } of months) {
    const year = Number(month.slice(0, 4));
    byYear.set(year, (byYear.get(year) ?? 0) + count);
  }
  return Array.from(byYear, ([year, count]) => ({ year, count })).sort(
    (a, b) => b.year - a.year,
  );
}

export function monthKey(photo: Photo): string | null {
  return photo.metadata?.date_taken?.slice(0, 7) ?? null;
}

export function monthLabel(key: string): string {
  return formatDay(`${key}-01T00:00:00.000Z`, "month");
}

/** Cursor for "everything taken before this year ends", accepted by `before`. */
export function endOfYearCursor(year: number): string {
  return new Date(Date.UTC(year + 1, 0, 1)).toISOString();
}

/**
 * Consecutive photos of the same month, in API order (newest first). Groups
 * whose photos did not change keep their array, so their grids skip layout.
 */
export function groupByMonth(
  photos: TimelinePhoto[],
  previous: MonthGroup[],
): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const photo of photos) {
    const key = monthKey(photo) ?? "undated";
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.photos.push(photo);
    else groups.push({ key, photos: [photo] });
  }
  const before = new Map(previous.map((g) => [g.key, g]));
  return groups.map((group) => {
    const old = before.get(group.key);
    const same =
      old &&
      old.photos.length === group.photos.length &&
      old.photos.every((p, i) => p === group.photos[i]);
    return same ? old : group;
  });
}
