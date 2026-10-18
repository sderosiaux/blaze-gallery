/** Where and when the map looks, shared by /carte and /api/map/*. */

/** Degrees; west ≤ east, a selection never crosses the antimeridian. */
export interface MapBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Months of date taken ("YYYY-MM"), both included; null leaves that side open. */
export interface MapPeriod {
  from: string | null;
  to: string | null;
}

/** Points are counted per cell of 1/200° (about 550 m north–south). */
export const CELLS_PER_DEGREE = 200;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const DEGREES = /^-?\d{1,3}(\.\d{1,12})?$/;

export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

/** "2021-12" plus one is "2022-01". */
export function addMonths(month: string, n: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
}

type Read = (key: string) => string | null;

export function parsePeriod(get: Read): Parsed<MapPeriod> {
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  if (from !== "" && !isMonth(from))
    return { ok: false, error: "from must be a month, YYYY-MM" };
  if (to !== "" && !isMonth(to))
    return { ok: false, error: "to must be a month, YYYY-MM" };
  if (from !== "" && to !== "" && from > to)
    return { ok: false, error: "from must not come after to" };
  return { ok: true, value: { from: from || null, to: to || null } };
}

/**
 * The four sides under the given parameter names: all or none. Latitudes
 * within ±90, longitudes within ±180, south ≤ north and west ≤ east.
 */
export function parseBox(
  get: Read,
  names: Record<keyof MapBox, string>,
): Parsed<MapBox | null> {
  const keys = [names.south, names.west, names.north, names.east];
  const raw = keys.map((key) => get(key) ?? "");
  const given = raw.filter((value) => value !== "");
  if (given.length === 0) return { ok: true, value: null };
  const all = keys.join(", ");
  if (given.length < 4)
    return { ok: false, error: `${all} must be given together` };
  if (!given.every((value) => DEGREES.test(value)))
    return { ok: false, error: `${all} must be decimal degrees` };

  const [south = 0, west = 0, north = 0, east = 0] = raw.map(Number);
  const lat = (v: number) => v >= -90 && v <= 90;
  const lng = (v: number) => v >= -180 && v <= 180;
  if (!lat(south) || !lat(north) || !lng(west) || !lng(east))
    return { ok: false, error: "latitudes within ±90, longitudes within ±180" };
  if (south > north || west > east)
    return {
      ok: false,
      error: `${names.south} ≤ ${names.north} and ${names.west} ≤ ${names.east}`,
    };
  return { ok: true, value: { south, west, north, east } };
}
