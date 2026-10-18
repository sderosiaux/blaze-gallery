import { asArray, asString, isRecord, readJsonObject } from "@/hooks/apiJson";
import type { Photo } from "@/types";
import { formatDay } from "@/lib/albums";

/** "YYYY-MM" of date taken, as returned by /api/timeline/summary */
export interface MonthCount {
  month: string;
  count: number;
}

export function isMonthCount(value: unknown): value is MonthCount {
  return (
    isRecord(value) &&
    typeof value.month === "string" &&
    typeof value.count === "number"
  );
}

export interface TimelineSummary {
  months: MonthCount[];
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
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return { months: asArray(data.months).filter(isMonthCount) };
}

/** Years holding at least one dated photo, newest first like the months. */
export function yearsOf(months: MonthCount[]): number[] {
  const years = new Set(months.map(({ month }) => Number(month.slice(0, 4))));
  return Array.from(years).sort((a, b) => b - a);
}

export function monthKey(photo: Photo): string | null {
  return photo.metadata?.date_taken?.slice(0, 7) ?? null;
}

export function monthLabel(key: string): string {
  return formatDay(`${key}-01T00:00:00.000Z`, "month");
}

/** Cursor for "everything taken before this month ends" ("YYYY-MM"). */
export function endOfMonthCursor(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 12, 1)).toISOString();
}

/** Photos per year ("2019") and per month ("2019-07"), for the index beside the timeline. */
export function countsOf(months: MonthCount[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { month, count } of months) {
    const year = month.slice(0, 4);
    counts.set(month, count);
    counts.set(year, (counts.get(year) ?? 0) + count);
  }
  return counts;
}

/** Months with photos in one year, newest first like the timeline. */
export function monthsOfYear(months: MonthCount[], year: number): string[] {
  const prefix = `${year}-`;
  return months
    .map(({ month }) => month)
    .filter((month) => month.startsWith(prefix))
    .sort((a, b) => b.localeCompare(a));
}

/** "juil." — short enough for the rail under its year. */
export function shortMonthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00.000Z`).toLocaleDateString("fr-FR", {
    month: "short",
    timeZone: "UTC",
  });
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
