import { asArray, asString, isRecord, readJsonObject } from "@/hooks/apiJson";
import { formatDay, LOCALE } from "@/lib/albums";
import { setColorParams, type ColorFilter } from "@/lib/colors";
import {
  addDays,
  addMonths,
  firstDay,
  isDay,
  isMonth,
  lastDay,
  parseBox,
  parsePeriod,
  type MapBox,
  type MapPeriod,
} from "@/lib/mapArea";
import { monthLabel, type TimelinePhoto } from "@/components/find/timeline";

/** [latitude, longitude, photos] of one map cell, where its photos average. */
export type MapPoint = [number, number, number];

export interface MapPoints {
  /** Side of a cell, in degrees */
  cell: number;
  points: MapPoint[];
}

function isPoint(value: unknown): value is MapPoint {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

async function readSuccess(response: Response) {
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return data;
}

function periodQuery(period: MapPeriod, colors: ColorFilter): URLSearchParams {
  const params = setColorParams(new URLSearchParams(), colors);
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  return params;
}

export async function fetchMapPoints(
  period: MapPeriod,
  colors: ColorFilter,
  signal: AbortSignal,
): Promise<MapPoints> {
  const response = await fetch(
    `/api/map/points?${periodQuery(period, colors).toString()}`,
    { signal },
  );
  const data = await readSuccess(response);
  if (typeof data.cell !== "number") throw new Error("invalid_points");
  return { cell: data.cell, points: asArray(data.points).filter(isPoint) };
}

/** Photos per day ("YYYY-MM-DD") over a short span, else per month ("YYYY-MM"). */
export type DateUnit = "day" | "month";

export interface DateCount {
  date: string;
  count: number;
}

export interface MapDates {
  unit: DateUnit;
  /** Oldest first, only dates holding photos */
  dates: DateCount[];
}

export async function fetchMapDates(
  box: MapBox | null,
  colors: ColorFilter,
  signal: AbortSignal,
): Promise<MapDates> {
  const params = setColorParams(new URLSearchParams(), colors);
  if (box) {
    params.set("south", String(box.south));
    params.set("west", String(box.west));
    params.set("north", String(box.north));
    params.set("east", String(box.east));
  }
  const query = params.toString();
  const data = await readSuccess(
    await fetch(`/api/map/dates${query ? `?${query}` : ""}`, { signal }),
  );
  const unit: DateUnit = data.unit === "day" ? "day" : "month";
  const valid = unit === "day" ? isDay : isMonth;
  const dates = asArray(data.dates).filter(
    (value): value is DateCount =>
      isRecord(value) &&
      typeof value.date === "string" &&
      valid(value.date) &&
      typeof value.count === "number",
  );
  return { unit, dates };
}

/** Whether a photo of `dates` may fall in the period, to their precision. */
export function holdsPhotos(dates: DateCount[], period: MapPeriod): boolean {
  const from = period.from ? firstDay(period.from) : "";
  const to = period.to ? lastDay(period.to) : "9999";
  return dates.some(
    ({ date, count }) =>
      count > 0 && lastDay(date) >= from && firstDay(date) <= to,
  );
}

export interface AreaPage {
  photos: TimelinePhoto[];
  /** Opaque cursor of the next page; null on the last one */
  next: string | null;
  /** Only on the first page */
  total: number | null;
}

export async function fetchAreaPage(
  box: MapBox,
  period: MapPeriod,
  colors: ColorFilter,
  after: string | null,
  signal: AbortSignal,
): Promise<AreaPage> {
  const params = periodQuery(period, colors);
  params.set("south", String(box.south));
  params.set("west", String(box.west));
  params.set("north", String(box.north));
  params.set("east", String(box.east));
  if (after) params.set("after", after);
  const data = await readSuccess(
    await fetch(`/api/map/photos?${params.toString()}`, { signal }),
  );
  return {
    photos: asArray(data.photos) as TimelinePhoto[],
    next: typeof data.next_after === "string" ? data.next_after : null,
    total: typeof data.total === "number" ? data.total : null,
  };
}

/** Selection and period as they sit in the page URL (`s w n e from to`). */
export const URL_BOX = { south: "s", west: "w", north: "n", east: "e" };

export function readUrlBox(get: (key: string) => string | null) {
  const box = parseBox(get, URL_BOX);
  return box.ok ? box.value : null;
}

export function readUrlPeriod(get: (key: string) => string | null): MapPeriod {
  const period = parsePeriod(get);
  return period.ok ? period.value : { from: null, to: null };
}

/** Five decimals: about a metre, and a short URL. */
export function roundDegrees(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** Every day or month from `first` to `last`, both included. */
export function datesBetween(
  first: string,
  last: string,
  unit: DateUnit,
): string[] {
  const next = unit === "day" ? addDays : addMonths;
  const dates: string[] = [];
  for (let d = first; d <= last; d = next(d, 1)) dates.push(d);
  return dates;
}

const formatUtc = (day: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString(LOCALE, {
    ...options,
    timeZone: "UTC",
  });

/** "12 avril 2014" or "avril 2014" */
export function dateLabel(date: string): string {
  return isDay(date) ? formatDay(`${date}T00:00:00.000Z`) : monthLabel(date);
}

/** "mai 2019", "mai – août 2021", "mai 2019 – août 2021" */
function monthsLabel(from: string, to: string): string {
  if (from === to) return monthLabel(from);
  if (from.slice(0, 4) !== to.slice(0, 4))
    return `${monthLabel(from)} – ${monthLabel(to)}`;
  return `${formatUtc(`${from}-01`, { month: "long" })} – ${monthLabel(to)}`;
}

/**
 * Months as monthsLabel; days as "12 – 19 avril 2014", "28 mars – 3 avril
 * 2014", or as months when they cover whole ones. A month next to a day
 * counts as its days.
 */
export function periodLabel(from: string, to: string): string {
  if (isMonth(from) && isMonth(to)) return monthsLabel(from, to);
  const first = firstDay(from);
  const last = lastDay(to);
  if (first.endsWith("-01") && last === lastDay(last.slice(0, 7)))
    return monthsLabel(first.slice(0, 7), last.slice(0, 7));
  if (first === last) return dateLabel(last);
  if (first.slice(0, 7) === last.slice(0, 7))
    return `${formatUtc(first, { day: "numeric" })} – ${dateLabel(last)}`;
  if (first.slice(0, 4) === last.slice(0, 4))
    return `${formatUtc(first, { day: "numeric", month: "long" })} – ${dateLabel(last)}`;
  return `${dateLabel(first)} – ${dateLabel(last)}`;
}
