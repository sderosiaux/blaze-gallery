import { asArray, asString, readJsonObject } from "@/hooks/apiJson";
import { LOCALE } from "@/lib/albums";
import {
  addMonths,
  parseBox,
  parsePeriod,
  type MapBox,
  type MapPeriod,
} from "@/lib/mapArea";
import {
  isMonthCount,
  monthLabel,
  type MonthCount,
  type TimelinePhoto,
} from "@/components/find/timeline";

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

function periodQuery(period: MapPeriod): URLSearchParams {
  const params = new URLSearchParams();
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  return params;
}

export async function fetchMapPoints(
  period: MapPeriod,
  signal: AbortSignal,
): Promise<MapPoints> {
  const response = await fetch(
    `/api/map/points?${periodQuery(period).toString()}`,
    { signal },
  );
  const data = await readSuccess(response);
  if (typeof data.cell !== "number") throw new Error("invalid_points");
  return { cell: data.cell, points: asArray(data.points).filter(isPoint) };
}

export async function fetchMapMonths(
  box: MapBox | null,
  signal: AbortSignal,
): Promise<MonthCount[]> {
  const query = box
    ? `?${new URLSearchParams({
        south: String(box.south),
        west: String(box.west),
        north: String(box.north),
        east: String(box.east),
      }).toString()}`
    : "";
  const data = await readSuccess(
    await fetch(`/api/map/months${query}`, { signal }),
  );
  return asArray(data.months).filter(isMonthCount);
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
  after: string | null,
  signal: AbortSignal,
): Promise<AreaPage> {
  const params = periodQuery(period);
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

/** Every month from `first` to `last`, both included. */
export function monthsBetween(first: string, last: string): string[] {
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) months.push(m);
  return months;
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString(LOCALE, {
    month: "long",
    timeZone: "UTC",
  });
}

/** "mai 2019", "mai – août 2021", "mai 2019 – août 2021" */
export function periodLabel(from: string, to: string): string {
  if (from === to) return monthLabel(from);
  if (from.slice(0, 4) === to.slice(0, 4))
    return `${monthName(from)} – ${monthLabel(to)}`;
  return `${monthLabel(from)} – ${monthLabel(to)}`;
}
