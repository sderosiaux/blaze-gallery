/**
 * What semantic photo search decides before touching the database: the text
 * the embedder is asked to embed, the similarity a photo needs to count as a
 * match, and date bounds.
 */
import { addDays, firstDay, isDay, isMonth, lastDay } from "./mapArea";
import type { MapPeriod, Parsed } from "./mapArea";

/** Longer queries get no semantic part: the text model reads 64 tokens. */
export const SEMANTIC_QUERY_MAX = 200;

/**
 * Where the list of photos matching a query ends. SigLIP2 text–image cosine
 * similarities are small and shift from one query to the next: on the
 * library, photos that show the query score ~0.11–0.16 and the first
 * unrelated ones ~0.09–0.10 for "neige" or "mariage", while cakes that do
 * match score 0.08–0.12 for "gâteau d'anniversaire". So a photo is listed
 * when it is within SEMANTIC_MARGIN of the query's SEMANTIC_REFERENCE_RANK-th
 * best photo, never below SEMANTIC_MIN_SIMILARITY. The reference is not the
 * best photo: a poster reading "CHAT PERDU" scores 0.162 for "les chats",
 * 0.03 above the first real cat, and would cut every cat off.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.08;
export const SEMANTIC_MARGIN = 0.035;
export const SEMANTIC_REFERENCE_RANK = 5;

/**
 * The key of search_query_embeddings: NFC, spaces collapsed, lower case,
 * accents kept (the model reads them). Null when there is nothing to embed.
 */
export function normalizeSemanticQuery(q: string): string | null {
  const text = q.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return text === "" || text.length > SEMANTIC_QUERY_MAX ? null : text;
}

/** Days of date taken: `from` included, `before` excluded; null leaves that side open. */
export interface DateRange {
  from: string | null;
  before: string | null;
}

/**
 * Days of the year, "MM-DD", both included, every year; `from` after `to`
 * runs over the new year (winter: "12-01" to "02-29").
 */
export interface AnnualWindow {
  from: string;
  to: string;
}

/**
 * When the photos were taken: within one of `ranges` (none: any year) and
 * on a day of one of `annual` (none: any day). "Noël 2011" is a range,
 * "Noël" a window: a photo of the 2011 holidays passes both.
 */
export interface DateFilter {
  ranges: DateRange[];
  annual: AnnualWindow[];
}

export const ANY_DATE: DateFilter = { ranges: [], annual: [] };

export function hasDateFilter(dates: DateFilter): boolean {
  return dates.ranges.length > 0 || dates.annual.length > 0;
}

/** One range as a filter; open on both sides is any date. */
export function rangeFilter(range: DateRange): DateFilter {
  return range.from === null && range.before === null
    ? ANY_DATE
    : { ranges: [range], annual: [] };
}

/** The map's period (months or days, both included) as a filter. */
export function periodFilter(period: MapPeriod): DateFilter {
  return rangeFilter({
    from: period.from ? firstDay(period.from) : null,
    before: period.to ? addDays(lastDay(period.to), 1) : null,
  });
}

const YEAR = /^(19|20)\d{2}$/;

/** "2019", "2019-07" or "2019-07-14" as its first and last day. */
function boundDays(value: string): { first: string; last: string } | null {
  if (YEAR.test(value))
    return { first: `${value}-01-01`, last: `${value}-12-31` };
  if (isMonth(value) || isDay(value))
    return { first: firstDay(value), last: lastDay(value) };
  return null;
}

/**
 * A year, month or day on each side (both included), compared as text with
 * the ISO date_taken like the timeline and the map do.
 */
export function parseDateRange(
  from: string | undefined,
  to: string | undefined,
): Parsed<DateRange> {
  const start = from ? boundDays(from) : null;
  const end = to ? boundDays(to) : null;
  if (from && !start)
    return { ok: false, error: "from must be YYYY, YYYY-MM or YYYY-MM-DD" };
  if (to && !end)
    return { ok: false, error: "to must be YYYY, YYYY-MM or YYYY-MM-DD" };
  if (start && end && start.first > end.last)
    return { ok: false, error: "from must not come after to" };
  return {
    ok: true,
    value: {
      from: start ? start.first : null,
      before: end ? addDays(end.last, 1) : null,
    },
  };
}
