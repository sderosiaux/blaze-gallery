/**
 * The colors a photo holds, as photo_colors measures them (db/schema.sql):
 * the 12 hue families in their stored order and the tones read from
 * colorfulness, luminance and monochrome. Shared by the pages, the API
 * routes and the MCP tools; the SQL thresholds are in lib/database.ts.
 */

/** In photo_colors.hues order: HUES[i] is hues[i + 1] in SQL. */
export const HUES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "grey",
  "white",
] as const;

export type Hue = (typeof HUES)[number];

export const HUE_LABELS: Record<Hue, string> = {
  red: "Rouge",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  teal: "Turquoise",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
  brown: "Brun",
  black: "Noir",
  grey: "Gris",
  white: "Blanc",
};

/** Agrees with "photo": "Aucune photo bleue". */
const HUE_ADJECTIVES: Record<Hue, string> = {
  red: "rouge",
  orange: "orange",
  yellow: "jaune",
  green: "verte",
  teal: "turquoise",
  blue: "bleue",
  purple: "violette",
  pink: "rose",
  brown: "brune",
  black: "noire",
  grey: "grise",
  white: "blanche",
};

export const COLOR_TONES = [
  "vives",
  "douces",
  "lumineuse",
  "sombre",
  "neutres",
  "nb",
] as const;

export type ColorTone = (typeof COLOR_TONES)[number];

export const TONE_LABELS: Record<ColorTone, string> = {
  vives: "Vives",
  douces: "Douces",
  lumineuse: "Lumineuse",
  sombre: "Sombre",
  neutres: "Neutres",
  nb: "Noir et blanc",
};

const TONE_ADJECTIVES: Record<ColorTone, string> = {
  vives: "aux couleurs vives",
  douces: "aux couleurs douces",
  lumineuse: "lumineuse",
  sombre: "sombre",
  neutres: "aux tons neutres",
  nb: "en noir et blanc",
};

/** A photo holds a color from this share of its (center-weighted) picture (db/schema.sql). */
export const HOLDS = 0.03;

/** Where each tone starts, calibrated on the library (db/schema.sql). */
export const TONE_LIMITS = {
  /** colorfulness >= */
  vives: 55,
  /** colorfulness <, not monochrome */
  douces: 22,
  /** luminance > */
  lumineuse: 65,
  /** luminance < */
  sombre: 30,
  /** colorfulness <, not monochrome */
  neutres: 15,
} as const;

export interface ToneMeasures {
  colorfulness: number;
  luminance: number;
  monochrome: boolean;
}

const TONE_TESTS: Record<ColorTone, (m: ToneMeasures) => boolean> = {
  vives: (m) => m.colorfulness >= TONE_LIMITS.vives,
  douces: (m) => m.colorfulness < TONE_LIMITS.douces && !m.monochrome,
  lumineuse: (m) => m.luminance > TONE_LIMITS.lumineuse,
  sombre: (m) => m.luminance < TONE_LIMITS.sombre,
  neutres: (m) => m.colorfulness < TONE_LIMITS.neutres && !m.monochrome,
  nb: (m) => m.monochrome,
};

/** The tones a photo is in, as the filters and the Couleurs page read them. */
export function tonesOf(measures: ToneMeasures): ColorTone[] {
  return COLOR_TONES.filter((tone) => TONE_TESTS[tone](measures));
}

/** `?color=` and `?tone=`: either, both (photos holding the color in that tone) or neither. */
export interface ColorFilter {
  color: Hue | null;
  tone: ColorTone | null;
}

export const NO_COLOR_FILTER: ColorFilter = { color: null, tone: null };

export function isHue(value: unknown): value is Hue {
  return HUES.some((hue) => hue === value);
}

export function isColorTone(value: unknown): value is ColorTone {
  return COLOR_TONES.some((tone) => tone === value);
}

/** 1-based position in photo_colors.hues */
export function hueIndex(hue: Hue): number {
  return HUES.indexOf(hue) + 1;
}

export function hasColorFilter(filter: ColorFilter): boolean {
  return filter.color !== null || filter.tone !== null;
}

export type ParsedColorFilter =
  | { ok: true; value: ColorFilter }
  | { ok: false; error: string };

/** Reads `color` and `tone`; absent or empty leaves that side open. */
export function parseColorFilter(
  get: (key: string) => string | null,
): ParsedColorFilter {
  const color = get("color") ?? "";
  const tone = get("tone") ?? "";
  if (color !== "" && !isHue(color))
    return { ok: false, error: `color must be one of ${HUES.join(", ")}` };
  if (tone !== "" && !isColorTone(tone))
    return {
      ok: false,
      error: `tone must be one of ${COLOR_TONES.join(", ")}`,
    };
  return {
    ok: true,
    value: {
      color: isHue(color) ? color : null,
      tone: isColorTone(tone) ? tone : null,
    },
  };
}

/** The filter as a page reads it from its URL: an unknown value is no filter. */
export function readUrlColorFilter(
  get: (key: string) => string | null,
): ColorFilter {
  const parsed = parseColorFilter(get);
  return parsed.ok ? parsed.value : NO_COLOR_FILTER;
}

/** Adds `color` and `tone` to API query parameters when set. */
export function setColorParams(
  params: URLSearchParams,
  filter: ColorFilter,
): URLSearchParams {
  if (filter.color) params.set("color", filter.color);
  if (filter.tone) params.set("tone", filter.tone);
  return params;
}

/** Where a list ranked by color goes on: the last photo's score and id. */
export interface ColorRankCursor {
  score: number;
  id: number;
}

/** "<score>|<id>", the opaque `next_after` of a ranked list. */
export function formatRankCursor(cursor: ColorRankCursor): string {
  return `${cursor.score}|${cursor.id}`;
}

export function parseRankCursor(value: string): ColorRankCursor | null {
  const [scorePart, idPart, ...rest] = value.split("|");
  if (scorePart === undefined || idPart === undefined || rest.length > 0)
    return null;
  const score = Number(scorePart);
  const id = Number(idPart);
  return scorePart !== "" &&
    Number.isFinite(score) &&
    Number.isSafeInteger(id) &&
    id > 0
    ? { score, id }
    : null;
}

/** "rouge", "sombre", "bleue en noir et blanc": what follows "Aucune photo". */
export function filterAdjective(filter: ColorFilter): string {
  return [
    filter.color ? HUE_ADJECTIVES[filter.color] : null,
    filter.tone ? TONE_ADJECTIVES[filter.tone] : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** "Rouge", "Sombre", "Rouge · Sombre": the chosen chips, for a title. */
export function filterLabel(filter: ColorFilter): string {
  return [
    filter.color ? HUE_LABELS[filter.color] : null,
    filter.tone ? TONE_LABELS[filter.tone] : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
