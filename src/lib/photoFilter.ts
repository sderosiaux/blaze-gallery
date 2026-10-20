/**
 * The filter every photo list reads, the same on each view of the app, in
 * the API routes and in the MCP tools: who is on the photos and how they
 * look, what the scene shows, when, in which colors, and the words typed.
 * Pure, shared by the pages and the server: lib/filterResolver.ts reads
 * `q` and the scene tags into lib/database.ts's PhotoFilter, which turns it
 * into SQL.
 */
import {
  isColorTone,
  isHue,
  parseColorFilter,
  setColorParams,
  type ColorFilter,
} from "./colors";

/**
 * How a face looks, as the faces pass measures it (db/schema.sql, faces):
 * the 8 expression probabilities, the eyes and the mouth. The thresholds
 * are lib/database.ts's EXPRESSION_SQL.
 */
export const EXPRESSIONS = [
  "sourit",
  "rit",
  "triste",
  "colere",
  "surpris",
  "peur",
  "yeux_fermes",
] as const;

export type Expression = (typeof EXPRESSIONS)[number];

export const EXPRESSION_LABELS: Record<Expression, string> = {
  sourit: "Sourit",
  rit: "Rit",
  triste: "Triste",
  colere: "En colère",
  surpris: "Surpris",
  peur: "A peur",
  yeux_fermes: "Yeux fermés",
};

export function isExpression(value: unknown): value is Expression {
  return EXPRESSIONS.some((expression) => expression === value);
}

/** A face on the photo: `person`'s, or anyone's when null, looking `expression`. */
export interface FaceCondition {
  person: number | null;
  expression: Expression;
}

/** A scene tag of db/tags.json the photos show, or with `negated` do not. */
export interface TagCondition {
  tag: string;
  negated: boolean;
}

/**
 * The filter as a URL carries it, each view's and the API's:
 *   q      the words typed, read again on every request (lib/searchQuery.ts)
 *   p      a person on the photos, repeated for each; "4.sourit": person 4, smiling
 *   expr   someone on the photos looking so ("triste")
 *   tag    a scene tag ("plage"); "-voiture": not that
 *   only   "1": nobody else on the photos, nobody at all without people
 *   color, tone   lib/colors.ts
 *   date   when, in the words the search box reads ("2015", "été 2015", "noël")
 * Views keep their own parameters (photo, year, the map's box and period)
 * beside these; FILTER_KEYS are the ones that follow from view to view.
 */
export interface UrlFilter {
  q: string;
  people: number[];
  faces: FaceCondition[];
  tags: TagCondition[];
  only: boolean;
  colors: ColorFilter;
  dates: string[];
}

export const FILTER_KEYS = [
  "q",
  "p",
  "expr",
  "tag",
  "only",
  "color",
  "tone",
  "date",
] as const;

export const NO_URL_FILTER: UrlFilter = {
  q: "",
  people: [],
  faces: [],
  tags: [],
  only: false,
  colors: { color: null, tone: null },
  dates: [],
};

/** Longest `q` and `date` a URL may carry: past them, nothing reads them. */
export const MAX_QUERY = 500;
const MAX_DATE_WORDS = 60;
/** More conditions than anyone types: a URL past them is not a filter. */
const MAX_VALUES = 12;

const PERSON = /^(\d{1,15})(?:\.([a-z_]+))?$/;
const TAG = /^(-?)([a-z0-9_]{1,40})$/;

export function hasUrlFilter(filter: UrlFilter): boolean {
  return (
    filter.q.trim() !== "" ||
    filter.people.length > 0 ||
    filter.faces.length > 0 ||
    filter.tags.length > 0 ||
    filter.only ||
    filter.colors.color !== null ||
    filter.colors.tone !== null ||
    filter.dates.length > 0
  );
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The filter of a query string, every value checked: a wrong one is an
 * error, for the API to answer 400. Tags are checked against the
 * vocabulary and dates read by lib/filterResolver.ts.
 */
export function parseUrlFilter(
  get: (key: string) => string | null,
  getAll: (key: string) => string[],
): Read<UrlFilter> {
  const q = (get("q") ?? "").trim();
  if (q.length > MAX_QUERY)
    return { ok: false, error: `q must be at most ${MAX_QUERY} characters` };

  const people: number[] = [];
  const faces: FaceCondition[] = [];
  const personValues = getAll("p");
  const exprValues = getAll("expr");
  const tagValues = getAll("tag");
  const dateValues = getAll("date");
  if (
    [personValues, exprValues, tagValues, dateValues].some(
      (values) => values.length > MAX_VALUES,
    )
  )
    return { ok: false, error: `at most ${MAX_VALUES} values per parameter` };

  for (const value of personValues) {
    const match = PERSON.exec(value);
    const id = match ? Number(match[1]) : NaN;
    if (!match || !Number.isSafeInteger(id) || id <= 0)
      return {
        ok: false,
        error: "p must be a person id, or <id>.<expression>",
      };
    const expression = match[2];
    if (expression === undefined) {
      if (!people.includes(id)) people.push(id);
    } else if (!isExpression(expression)) {
      return {
        ok: false,
        error: `expression must be one of ${EXPRESSIONS.join(", ")}`,
      };
    } else faces.push({ person: id, expression });
  }
  for (const value of exprValues) {
    if (!isExpression(value))
      return {
        ok: false,
        error: `expr must be one of ${EXPRESSIONS.join(", ")}`,
      };
    faces.push({ person: null, expression: value });
  }

  const tags: TagCondition[] = [];
  for (const value of tagValues) {
    const match = TAG.exec(value);
    if (!match?.[2])
      return { ok: false, error: "tag must be a tag name, or -<tag> for not" };
    tags.push({ tag: match[2], negated: match[1] === "-" });
  }

  const only = get("only");
  if (only !== null && only !== "" && only !== "1")
    return { ok: false, error: "only must be 1" };

  const colors = parseColorFilter(get);
  if (!colors.ok) return colors;

  const dates = dateValues.map((value) => value.trim()).filter(Boolean);
  if (dates.some((value) => value.length > MAX_DATE_WORDS))
    return {
      ok: false,
      error: `date must be at most ${MAX_DATE_WORDS} characters`,
    };

  return {
    ok: true,
    value: {
      q,
      people,
      faces: dedupeFaces(faces),
      tags: dedupeTags(tags),
      only: only === "1",
      colors: colors.value,
      dates,
    },
  };
}

/** The filter as a page reads it from its URL: what does not read is left out. */
export function readUrlFilter(params: URLSearchParams): UrlFilter {
  const strict = parseUrlFilter(
    (key) => params.get(key),
    (key) => params.getAll(key),
  );
  if (strict.ok) return strict.value;
  // One wrong value drops that parameter, not the others
  const keep = (key: string, ok: (value: string) => boolean) =>
    params
      .getAll(key)
      .filter(ok)
      .slice(0, MAX_VALUES)
      .map((value): [string, string] => [key, value]);
  const cleaned = new URLSearchParams([
    ...keep("q", (v) => v.trim().length <= MAX_QUERY),
    ...keep("p", (v) => {
      const m = PERSON.exec(v);
      return m !== null && (m[2] === undefined || isExpression(m[2]));
    }),
    ...keep("expr", isExpression),
    ...keep("tag", (v) => TAG.test(v)),
    ...keep("only", (v) => v === "1"),
    ...keep("date", (v) => v.trim().length <= MAX_DATE_WORDS),
  ]);
  const color = params.get("color");
  const tone = params.get("tone");
  const colors: ColorFilter = {
    color: isHue(color) ? color : null,
    tone: isColorTone(tone) ? tone : null,
  };
  const read = parseUrlFilter(
    (key) => cleaned.get(key),
    (key) => cleaned.getAll(key),
  );
  return read.ok ? { ...read.value, colors } : { ...NO_URL_FILTER, colors };
}

/**
 * Writes the filter into `params` (FILTER_KEYS only; the view's own
 * parameters stay), in a stable order so equal filters give equal URLs.
 */
export function writeUrlFilter(
  params: URLSearchParams,
  filter: UrlFilter,
): URLSearchParams {
  for (const key of FILTER_KEYS) params.delete(key);
  if (filter.q.trim() !== "") params.set("q", filter.q.trim());
  for (const id of filter.people) params.append("p", String(id));
  for (const face of filter.faces) {
    if (face.person === null) params.append("expr", face.expression);
    else params.append("p", `${String(face.person)}.${face.expression}`);
  }
  for (const tag of filter.tags)
    params.append("tag", `${tag.negated ? "-" : ""}${tag.tag}`);
  if (filter.only) params.set("only", "1");
  setColorParams(params, filter.colors);
  for (const date of filter.dates) params.append("date", date);
  return params;
}

/** The filter as API query parameters, for a page's requests. */
export function filterQuery(filter: UrlFilter): URLSearchParams {
  return writeUrlFilter(new URLSearchParams(), filter);
}

/** "?…" carrying the filter, or "" without one: a link to another view keeps it. */
export function filterSearch(filter: UrlFilter): string {
  const query = filterQuery(filter).toString();
  return query ? `?${query}` : "";
}

/** Same conditions, same key: effects keyed on a filter stay put while it does. */
export function filterKey(filter: UrlFilter): string {
  return filterQuery(filter).toString();
}

function dedupeFaces(faces: FaceCondition[]): FaceCondition[] {
  return faces.filter(
    (face, i) =>
      faces.findIndex(
        (other) =>
          other.person === face.person && other.expression === face.expression,
      ) === i,
  );
}

function dedupeTags(tags: TagCondition[]): TagCondition[] {
  return tags.filter(
    (tag, i) => tags.findIndex((other) => other.tag === tag.tag) === i,
  );
}
