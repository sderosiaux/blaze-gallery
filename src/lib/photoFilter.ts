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
 * are lib/database.ts's EXPRESSION_SQL; the looks it cannot read right 9
 * times in 10 are not offered.
 */
export const EXPRESSIONS = ["sourit", "rit", "triste", "yeux_fermes"] as const;

export type Expression = (typeof EXPRESSIONS)[number];

export const EXPRESSION_LABELS: Record<Expression, string> = {
  sourit: "Sourit",
  rit: "Rit",
  triste: "Triste",
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
 *   p      a person on the photos, repeated for each; "4.sourit": person 4,
 *          smiling; "-4": person 4 not on them
 *   expr   someone on the photos looking so ("triste")
 *   tag    a scene tag ("plage"); "-voiture": not that
 *   only   "1": nobody else on the photos, nobody at all without people
 *   color, tone   lib/colors.ts
 *   date   when, in the words the search box reads ("2015", "été 2015", "noël")
 *   like   a photo's id: the photos that look like it (« Ressemble à »,
 *          lib/database.ts SIMILAR_MIN_COSINE); Recherche ranks by it
 * Views keep their own parameters (photo, year, the map's box and period)
 * beside these; FILTER_KEYS are the ones that follow from view to view.
 */
export interface UrlFilter {
  q: string;
  people: number[];
  withoutPeople: number[];
  faces: FaceCondition[];
  tags: TagCondition[];
  only: boolean;
  colors: ColorFilter;
  dates: string[];
  /** The photo the others must look like, null for none */
  like: number | null;
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
  "like",
] as const;

export const NO_URL_FILTER: UrlFilter = {
  q: "",
  people: [],
  withoutPeople: [],
  faces: [],
  tags: [],
  only: false,
  colors: { color: null, tone: null },
  dates: [],
  like: null,
};

/** Longest `q` and `date` a URL may carry: past them, nothing reads them. */
export const MAX_QUERY = 500;
const MAX_DATE_WORDS = 60;
/** More conditions than anyone types: a URL past them is not a filter. */
export const MAX_VALUES = 12;

const PERSON = /^(-?)(\d{1,15})(?:\.([a-z_]+))?$/;
const TAG = /^(-?)([a-z0-9_]{1,40})$/;
const PHOTO_ID = /^\d{1,15}$/;

/** A photo id as `like` carries it, else null. */
function photoId(value: string | null): number | null {
  if (value === null || !PHOTO_ID.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function hasUrlFilter(filter: UrlFilter): boolean {
  return (
    filter.q.trim() !== "" ||
    filter.people.length > 0 ||
    filter.withoutPeople.length > 0 ||
    filter.faces.length > 0 ||
    filter.tags.length > 0 ||
    filter.only ||
    filter.colors.color !== null ||
    filter.colors.tone !== null ||
    filter.dates.length > 0 ||
    filter.like !== null
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
  const withoutPeople: number[] = [];
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
    const id = match ? Number(match[2]) : NaN;
    const without = match?.[1] === "-";
    const expression = match?.[3];
    if (
      !match ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      (without && expression !== undefined)
    )
      return {
        ok: false,
        error: "p must be a person id, <id>.<expression> or -<id>",
      };
    if (without) {
      if (!withoutPeople.includes(id)) withoutPeople.push(id);
    } else if (expression === undefined) {
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

  const likeValue = get("like");
  const like =
    likeValue === null || likeValue === "" ? null : photoId(likeValue);
  if (likeValue !== null && likeValue !== "" && like === null)
    return { ok: false, error: "like must be a photo id" };

  return {
    ok: true,
    value: {
      q,
      people,
      withoutPeople,
      faces: dedupeFaces(faces),
      tags: dedupeTags(tags),
      only: only === "1",
      colors: colors.value,
      dates,
      like,
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
      return (
        m !== null &&
        (m[3] === undefined ? true : m[1] === "" && isExpression(m[3]))
      );
    }),
    ...keep("expr", isExpression),
    ...keep("tag", (v) => TAG.test(v)),
    ...keep("only", (v) => v === "1"),
    ...keep("date", (v) => v.trim().length <= MAX_DATE_WORDS),
    ...keep("like", (v) => photoId(v) !== null).slice(0, 1),
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
  for (const id of filter.withoutPeople) params.append("p", `-${String(id)}`);
  for (const face of filter.faces) {
    if (face.person === null) params.append("expr", face.expression);
    else params.append("p", `${String(face.person)}.${face.expression}`);
  }
  for (const tag of filter.tags)
    params.append("tag", `${tag.negated ? "-" : ""}${tag.tag}`);
  if (filter.only) params.set("only", "1");
  setColorParams(params, filter.colors);
  for (const date of filter.dates) params.append("date", date);
  if (filter.like !== null) params.set("like", String(filter.like));
  return params;
}

/**
 * `params` with « Ressemble à » set to photo `id`, or cleared with null;
 * the rest of the filter and the view's own parameters stay.
 */
export function setLikeParam(
  params: URLSearchParams,
  id: number | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (id === null) next.delete("like");
  else next.set("like", String(id));
  return next;
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
