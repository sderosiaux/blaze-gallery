/**
 * What semantic photo search decides before touching the database: the text
 * the embedder is asked to embed, the similarity a photo needs to count as a
 * match, date bounds, and which named people a query is about.
 */
import { addDays, firstDay, isDay, isMonth, lastDay } from "./mapArea";
import type { Parsed } from "./mapArea";
import { normalizeTextForSearch } from "./textUtils";

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

export const ANY_DATE: DateRange = { from: null, before: null };

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

/** Lower case, no accents, every run of non-letters a single space. */
function words(text: string): string {
  return normalizeTextForSearch(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A query is about a person when it holds their whole name ("suzie à la
 * plage") or is one or more whole words of it ("suzie" for "Suzie Martin"),
 * accents and case aside: "chat" is not about "Chatelain".
 */
export function queryNamesPerson(q: string, name: string): boolean {
  const query = words(q);
  const person = words(name);
  if (query === "" || person === "") return false;
  return (
    ` ${query} `.includes(` ${person} `) || ` ${person} `.includes(` ${query} `)
  );
}
