/**
 * How the search box reads a query, French first, accents and case aside:
 * named people and how they look, dates, scene tags, colors and tones
 * become filters, and what is left says what the photos show. « Suzie à la
 * plage en 2015 » is Suzie's photos of 2015 ranked by « plage » (or, with
 * the tag plage, those the worker tagged so); « Céline qui sourit », the
 * photos where Céline's face smiles; « que des chatons », kittens and
 * nobody. Pure: the named people and the tags come from the caller, and
 * the page uses removeParts to drop what a chip stands for.
 */
import {
  HUE_LABELS,
  TONE_LABELS,
  type ColorFilter,
  type ColorTone,
  type Hue,
} from "./colors";
import { addDays, isDay, isMonth, lastDay } from "./mapArea";
import {
  EXPRESSION_LABELS,
  type Expression,
  type FaceCondition,
  type TagCondition,
} from "./photoFilter";
import type { AnnualWindow, DateFilter, DateRange } from "./semanticQuery";
import { normalizeTextForSearch } from "./textUtils";

/** [start, end) of the query string */
export type Span = [number, number];

/** A person the owner named (people.name), as the parser matches them. */
export interface NamedPerson {
  id: number;
  name: string;
}

/** A scene tag as the parser reads it (lib/sceneTags.ts SceneTag). */
export interface TagWords {
  tag: string;
  label: string;
  words: readonly string[];
}

/**
 * Something the query was understood to ask, as a chip shows it: `spans`
 * covers its words and the ones that only lead to it ("en" of "en 2015",
 * "et" before a second name, "qui" before "sourit"), so removing them
 * leaves a query that reads.
 */
export type QueryPart =
  | { kind: "person"; label: string; personId: number; spans: Span[] }
  | { kind: "date"; label: string; spans: Span[] }
  | { kind: "color"; label: string; hue: Hue; spans: Span[] }
  | { kind: "tone"; label: string; tone: ColorTone; spans: Span[] }
  | {
      kind: "expression";
      label: string;
      expression: Expression;
      /** The people whose face looks so; none: anyone's */
      people: number[];
      spans: Span[];
    }
  | {
      kind: "tag";
      label: string;
      tag: string;
      negated: boolean;
      spans: Span[];
    }
  | { kind: "only"; label: string; spans: Span[] }
  /** A person not on the photos: « sans Céline », « ni Stéphane » */
  | { kind: "without"; label: string; personId: number; spans: Span[] };

export interface UnderstoodQuery {
  /** In query order */
  parts: QueryPart[];
  /** Photos showing all of them, whatever their face says */
  people: number[];
  /** Photos showing none of them */
  withoutPeople: number[];
  /** Faces the photos show, each on its own: a person smiling, someone crying */
  faces: FaceCondition[];
  tags: TagCondition[];
  /** Nobody else on the photos than `people` and the faces' people; nobody at all without them */
  only: boolean;
  dates: DateFilter;
  colors: ColorFilter;
  /** The words left for the content, as typed; null when none are left */
  text: string | null;
  /**
   * What the photos should show, for the embedder: `text`, plus the words a
   * date also means ("Noël") and those of the tags around it ("un chat qui
   * court sur la plage" reads whole). Null when only filters remain.
   */
  content: string | null;
  /**
   * Whether content keeps only the photos close enough to it (the relevance
   * floor). False when content is only what a date means: "Noël" selects
   * the photos of the holidays, the content only orders them.
   */
  cut: boolean;
}

interface Token {
  /** As typed */
  text: string;
  /** Lower case, accents dropped, ’ as ' */
  key: string;
  start: number;
  end: number;
}

// Words and commas; the punctuation around words separates them
const WORD = /[^\s,;:!?«»"“”()[\]{}]+|,/g;
// l'été, d'anniversaire, qu'il: the article is a word of its own
const ELISION = /^(l|d|j|m|t|s|c|n|qu|jusqu|lorsqu|puisqu)['’]/i;

function keyOf(text: string): string {
  return normalizeTextForSearch(text).replace(/’/g, "'");
}

function tokenize(q: string): Token[] {
  const tokens: Token[] = [];
  const words = new RegExp(WORD.source, "g");
  for (let match = words.exec(q); match; match = words.exec(q)) {
    let start = match.index;
    let text = match[0];
    // A sentence's full stop is not part of its last word ("en 2015.")
    const trimmed = text.replace(/\.+$/, "");
    if (trimmed !== "") text = trimmed;
    const elision = ELISION.exec(text);
    if (elision && elision[0].length < text.length) {
      const article = elision[0];
      tokens.push({
        text: article,
        key: keyOf(article),
        start,
        end: start + article.length,
      });
      start += article.length;
      text = text.slice(article.length);
    }
    tokens.push({ text, key: keyOf(text), start, end: start + text.length });
  }
  return tokens;
}

function words(list: string): string[] {
  return list.split(" ");
}

/**
 * Words that say nothing a photo shows. The words left of a query only make
 * a content when some other word remains, and they are trimmed off its ends:
 * the text model scores a photo higher for "à la plage" than for "plage"
 * whatever it shows, so a garden party scores like a beach (2026-10-18:
 * Suzie's 2015 photos, best 0.089 against 0.061).
 */
const STOPWORDS = new Set([
  ...words("le la les l' un une des du de d' au aux a et ou en dans sur sous"),
  ...words("avec chez pour par vers ce cet cette ces tout tous toute toutes"),
  ...words("mes mon ma nos notre ses son sa leur leurs qui que qu' j' m' t'"),
  ...words("s' c' n' moi toi nous vous lui elle eux , &"),
  // Say what the photos do not show: never what they show
  ...words("sans pas ni ne"),
  // Every result is one
  ...words("photo photos image images cliche cliches"),
  ...words("the an of in on and at with my our picture pictures pic pics"),
]);

/** Whether a word alone says nothing a photo shows ("la", "à", "photos"). */
export function isStopword(word: string): boolean {
  return STOPWORDS.has(keyOf(word));
}

/** Between two names: both people are on the photos. */
const PEOPLE_JOINERS = new Set(words("et & , avec"));

/** Left dangling at an end once a chip's words are gone. */
const LOOSE_ENDS = new Set(words("et & , ou avec"));

// ---- dates --------------------------------------------------------------------

/** Words that only lead to a date: "en 2015", "de 2010 à 2012", "à l'été 2019". */
const DATE_LEADS = new Set(
  words("en de du d' a au l' le les pour pendant durant dans"),
);

/** Between two years of a range: "2010 à 2012", "2010 - 2012". */
const RANGE_JOINERS = new Set(words("a au - – — /"));

const MONTHS = words(
  "janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre",
);

const MONTH_LABELS = words(
  "janvier février mars avril mai juin juillet août septembre octobre novembre décembre",
);

/**
 * Meteorological seasons, as the months a family files them under. With a
 * year, the season's days of that calendar year: "hiver 2010" is January,
 * February and December 2010.
 */
const SEASONS: Record<string, { label: string; window: AnnualWindow }> = {
  printemps: { label: "printemps", window: { from: "03-01", to: "05-31" } },
  ete: { label: "été", window: { from: "06-01", to: "08-31" } },
  automne: { label: "automne", window: { from: "09-01", to: "11-30" } },
  hiver: { label: "hiver", window: { from: "12-01", to: "02-29" } },
};

/**
 * The days a family photographs Christmas: the library's "Noël" folders run
 * from the tree (12-19) to the meals with the other side of the family
 * (12-27, 12-28); New Year's Eve is another party.
 */
const CHRISTMAS: AnnualWindow = { from: "12-15", to: "12-30" };

const YEAR = /^(19|20)\d{2}$/;
const YEAR_RANGE = /^((?:19|20)\d{2})[-–—/]((?:19|20)\d{2})$/;
const FRENCH_DAY = /^(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})$/;
const FRENCH_MONTH = /^(\d{1,2})\/((?:19|20)\d{2})$/;
const DAY_OF_MONTH = /^([1-9]|[12]\d|3[01])(er)?$/;
const DECADE = /^((?:19|20)?\d0)s?$/;

interface DateValue {
  label: string;
  ranges: DateRange[];
  annual: AnnualWindow[];
}

interface Match<T> {
  /** Token after the match */
  end: number;
  value: T;
}

const pad = (n: number) => String(n).padStart(2, "0");

function yearRange(first: number, last: number): DateRange {
  return { from: `${first}-01-01`, before: `${last + 1}-01-01` };
}

/** The days of `window` within the calendar year `year`. */
function windowInYear(window: AnnualWindow, year: number): DateRange[] {
  // A window's "02-29" is the end of February, leap year or not
  const end = (to: string) =>
    to === "02-29" ? `${year}-03-01` : addDays(`${year}-${to}`, 1);
  if (window.from <= window.to)
    return [{ from: `${year}-${window.from}`, before: end(window.to) }];
  return [
    { from: `${year}-01-01`, before: end(window.to) },
    { from: `${year}-${window.from}`, before: `${year + 1}-01-01` },
  ];
}

function capitalized(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function yearAt(tokens: Token[], i: number): number | null {
  const key = tokens[i]?.key;
  return key !== undefined && YEAR.test(key) ? Number(key) : null;
}

/** A month name, "décembre" or "decembre": its index. */
function monthAt(tokens: Token[], i: number): number | null {
  const index = MONTHS.indexOf(tokens[i]?.key ?? "");
  return index === -1 ? null : index;
}

/** A calendar day ("2021-02-29" is not one), as a one-day range. */
function dayValue(day: string): DateValue | null {
  if (!isDay(day)) return null;
  const month = Number(day.slice(5, 7)) - 1;
  const date = Number(day.slice(8, 10));
  return {
    label: `${date === 1 ? "1er" : String(date)} ${MONTH_LABELS[month] ?? ""} ${day.slice(0, 4)}`,
    ranges: [{ from: day, before: addDays(day, 1) }],
    annual: [],
  };
}

function monthValue(month: string): DateValue {
  const index = Number(month.slice(5, 7)) - 1;
  return {
    label: capitalized(`${MONTH_LABELS[index] ?? ""} ${month.slice(0, 4)}`),
    ranges: [{ from: `${month}-01`, before: addDays(lastDay(month), 1) }],
    annual: [],
  };
}

/** A date written as one word: "2010-2012", "2012-07-14", "2012-07", "14/07/2012", "07/2012". */
function oneWordDate(key: string): DateValue | null {
  const range = YEAR_RANGE.exec(key);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
    if (a === undefined || b === undefined) return null;
    return { label: `${a}–${b}`, ranges: [yearRange(a, b)], annual: [] };
  }
  if (isDay(key)) return dayValue(key);
  if (isMonth(key)) return monthValue(key);
  const french = FRENCH_DAY.exec(key);
  if (french)
    return dayValue(
      `${french[3] ?? ""}-${pad(Number(french[2]))}-${pad(Number(french[1]))}`,
    );
  const frenchMonth = FRENCH_MONTH.exec(key);
  if (frenchMonth) {
    const month = `${frenchMonth[2] ?? ""}-${pad(Number(frenchMonth[1]))}`;
    return isMonth(month) ? monthValue(month) : null;
  }
  return null;
}

/** A date expression starting at token `i`, its leading words excluded. */
function dateAt(tokens: Token[], i: number): Match<DateValue> | null {
  const key = tokens[i]?.key;
  if (key === undefined) return null;

  if (key === "entre") {
    const a = yearAt(tokens, i + 1);
    const b = yearAt(tokens, i + 3);
    if (a !== null && b !== null && tokens[i + 2]?.key === "et") {
      const [first, last] = a <= b ? [a, b] : [b, a];
      return {
        end: i + 4,
        value: {
          label: `${first}–${last}`,
          ranges: [yearRange(first, last)],
          annual: [],
        },
      };
    }
    return null;
  }

  if (key === "avant" || key === "apres" || key === "depuis") {
    const year = yearAt(tokens, i + 1);
    if (year === null) return null;
    const range: DateRange =
      key === "avant"
        ? { from: null, before: `${year}-01-01` }
        : { from: `${key === "apres" ? year + 1 : year}-01-01`, before: null };
    const word =
      key === "avant" ? "avant" : key === "apres" ? "après" : "depuis";
    return {
      end: i + 2,
      value: {
        label: capitalized(`${word} ${year}`),
        ranges: [range],
        annual: [],
      },
    };
  }

  if (key === "annees") {
    const decade = DECADE.exec(tokens[i + 1]?.key ?? "");
    if (!decade?.[1]) return null;
    const digits = decade[1];
    const start =
      digits.length === 4
        ? Number(digits)
        : Number(digits) + (Number(digits) >= 30 ? 1900 : 2000);
    return {
      end: i + 2,
      value: {
        label: `Années ${digits}`,
        ranges: [yearRange(start, start + 9)],
        annual: [],
      },
    };
  }

  const year = yearAt(tokens, i);
  if (year !== null) {
    const last = RANGE_JOINERS.has(tokens[i + 1]?.key ?? "")
      ? yearAt(tokens, i + 2)
      : null;
    if (last !== null) {
      const [first, end] = year <= last ? [year, last] : [last, year];
      return {
        end: i + 3,
        value: {
          label: `${first}–${end}`,
          ranges: [yearRange(first, end)],
          annual: [],
        },
      };
    }
    return {
      end: i + 1,
      value: {
        label: String(year),
        ranges: [yearRange(year, year)],
        annual: [],
      },
    };
  }

  const word = oneWordDate(key);
  if (word) return { end: i + 1, value: word };

  // "14 juillet", "1er janvier 2012"
  const dayOfMonth = DAY_OF_MONTH.exec(key);
  const dayMonth = dayOfMonth ? monthAt(tokens, i + 1) : null;
  if (dayOfMonth && dayMonth !== null) {
    const date = Number(dayOfMonth[1]);
    const withYear = yearAt(tokens, i + 2);
    const day = `${pad(dayMonth + 1)}-${pad(date)}`;
    if (withYear !== null) {
      const value = dayValue(`${withYear}-${day}`);
      if (value) return { end: i + 3, value };
    }
    const label = `${date === 1 ? "1er" : String(date)} ${MONTH_LABELS[dayMonth] ?? ""}`;
    return {
      end: i + 2,
      value: { label, ranges: [], annual: [{ from: day, to: day }] },
    };
  }

  const month = monthAt(tokens, i);
  if (month !== null) {
    const withYear = yearAt(tokens, i + 1);
    if (withYear !== null)
      return { end: i + 2, value: monthValue(`${withYear}-${pad(month + 1)}`) };
    return {
      end: i + 1,
      value: {
        label: capitalized(MONTH_LABELS[month] ?? ""),
        ranges: [],
        annual: [{ from: `${pad(month + 1)}-01`, to: `${pad(month + 1)}-31` }],
      },
    };
  }

  const season =
    key === "noel" ? { label: "noël", window: CHRISTMAS } : SEASONS[key];
  if (season) {
    const { label: name, window } = season;
    const withYear = yearAt(tokens, i + 1);
    if (withYear !== null)
      return {
        end: i + 2,
        value: {
          label: capitalized(`${name} ${withYear}`),
          ranges: windowInYear(window, withYear),
          annual: [],
        },
      };
    return {
      end: i + 1,
      value: { label: capitalized(name), ranges: [], annual: [window] },
    };
  }

  return null;
}

// ---- colors -------------------------------------------------------------------

/** Each word of `byValue[v]` read as `v`. */
function wordsFor<V extends string>(
  byValue: Record<V, string>,
): Map<string, V> {
  const entries = Object.keys(byValue) as V[];
  return new Map(
    entries.flatMap((value) =>
      words(byValue[value]).map((word): [string, V] => [word, value]),
    ),
  );
}

/** Masculine, feminine and plural, accents dropped (keys). */
const HUE_WORDS = wordsFor<Hue>({
  red: "rouge rouges",
  orange: "orange oranges orangee orangees",
  yellow: "jaune jaunes",
  green: "vert verte verts vertes",
  teal: "turquoise turquoises",
  blue: "bleu bleue bleus bleues",
  purple: "violet violette violets violettes mauve mauves",
  pink: "rose roses",
  brown: "brun brune bruns brunes marron marrons",
  black: "noir noire noirs noires",
  grey: "gris grise grises",
  white: "blanc blanche blancs blanches",
});

const TONE_WORDS = wordsFor<ColorTone>({
  vives: "vive vives vif vifs coloree colorees colore colores",
  douces: "douce douces doux pastel pastels",
  lumineuse: "lumineuse lumineuses lumineux clair claire clairs claires",
  sombre: "sombre sombres",
  neutres: "neutre neutres",
  nb: "nb n&b n/b noir-et-blanc monochrome monochromes",
});

/** Words that make the color the photo's, not a thing's: "en rouge", "aux couleurs vives", "dans les tons bleus". */
const COLOR_LEADS = new Set(words("en aux a dans"));
const COLOR_ARTICLES = new Set(words("les des la le l' de d'"));
const COLOR_NOUNS = new Set(
  words("couleur couleurs ton tons teinte teintes dominante"),
);

type ColorValue = { kind: "hue"; hue: Hue } | { kind: "tone"; tone: ColorTone };

/** "noir et blanc" (or "noir & blanc"), a tone word, or a hue word at `i`. */
function colorAt(tokens: Token[], i: number): Match<ColorValue> | null {
  const key = tokens[i]?.key ?? "";
  if (
    HUE_WORDS.get(key) === "black" &&
    (tokens[i + 1]?.key === "et" || tokens[i + 1]?.key === "&") &&
    HUE_WORDS.get(tokens[i + 2]?.key ?? "") === "white"
  )
    return { end: i + 3, value: { kind: "tone", tone: "nb" } };
  const tone = TONE_WORDS.get(key);
  if (tone) return { end: i + 1, value: { kind: "tone", tone } };
  const hue = HUE_WORDS.get(key);
  if (hue) return { end: i + 1, value: { kind: "hue", hue } };
  return null;
}

// ---- people -------------------------------------------------------------------

interface PersonKeys {
  id: number;
  name: string;
  keys: string[];
}

/** The longest name at `i`: a whole name, or the first name of a longer one nobody else answers to. */
function personAt(
  tokens: Token[],
  i: number,
  people: PersonKeys[],
): Match<PersonKeys> | null {
  let best: Match<PersonKeys> | null = null;
  for (const person of people) {
    const { keys } = person;
    if (
      keys.length > 0 &&
      keys.every((k, n) => tokens[i + n]?.key === k) &&
      (!best || i + keys.length > best.end)
    )
      best = { end: i + keys.length, value: person };
  }
  if (best) return best;
  const key = tokens[i]?.key;
  const byFirstName = people.filter(
    (p) => p.keys.length > 1 && p.keys[0] === key,
  );
  const only = byFirstName[0];
  return byFirstName.length === 1 && only ? { end: i + 1, value: only } : null;
}

// ---- phrases ------------------------------------------------------------------

/** A phrase as keys: "éclate de rire" is ["eclate", "de", "rire"]. */
function phraseKeys(phrase: string): string[] {
  return tokenize(phrase).map((t) => t.key);
}

/** The longest of `phrases` at `i`. */
function phraseAt<V>(
  tokens: Token[],
  i: number,
  phrases: readonly { keys: readonly string[]; value: V }[],
): Match<V> | null {
  let best: Match<V> | null = null;
  for (const { keys, value } of phrases) {
    if (
      keys.length > 0 &&
      keys.every((k, n) => tokens[i + n]?.key === k) &&
      (!best || i + keys.length > best.end)
    )
      best = { end: i + keys.length, value };
  }
  return best;
}

// ---- how a face looks -----------------------------------------------------------

/**
 * Masculine, feminine and plural, verb and adjective, accents dropped. Each
 * says one Expression of lib/photoFilter.ts.
 */
const EXPRESSION_PHRASES: Record<Expression, string> = {
  sourit:
    "sourit sourient souriant souriante souriants souriantes sourire sourires heureux heureuse heureuses content contente contents contentes joyeux joyeuse joyeuses",
  rit: "rit rient rire rires rigole rigolent hilare hilares eclate_de_rire eclatent_de_rire eclat_de_rire eclats_de_rire mort_de_rire morte_de_rire morts_de_rire mortes_de_rire fou_rire",
  triste:
    "triste tristes pleure pleurent pleurs larmes en_larmes chagrin malheureux malheureuse malheureuses",
  yeux_fermes:
    "yeux_fermes les_yeux_fermes yeux_clos les_yeux_clos ferme_les_yeux ferment_les_yeux",
};

const EXPRESSION_KEYS = (
  Object.keys(EXPRESSION_PHRASES) as Expression[]
).flatMap((expression) =>
  words(EXPRESSION_PHRASES[expression]).map((phrase) => ({
    keys: phrase.split("_"),
    value: expression,
  })),
);

/** Every phrase read as a look, its keys joined by spaces ("eclate de rire"): what the search box suggests from. */
export function expressionPhrases(): {
  phrase: string;
  expression: Expression;
}[] {
  return EXPRESSION_KEYS.map(({ keys, value }) => ({
    phrase: keys.join(" "),
    expression: value,
  }));
}

/**
 * Alone, these say something else ("le contenu"): they only read as a
 * face's look after a person or "quelqu'un".
 */
const BOUND_ONLY = new Set(words("content contente contents contentes"));

/** Between a person and how they look: "Céline qui sourit", "Suzie est triste". */
const EXPRESSION_LEADS = new Set(words("qui est sont a ont avec"));

/** Anyone, as the subject of a look: "quelqu'un qui pleure", "des gens qui rient". */
const SUBJECTS = [
  "quelqu'un",
  "qqn",
  "gens",
  "personnes",
  "tout le monde",
  "tous",
  "enfant",
  "enfants",
  "bebe",
  "bebes",
  "visage",
  "visages",
].map((phrase) => ({ keys: phraseKeys(phrase), value: true }));

/** How a face looks at `i`, its leading words included ("qui a les yeux fermés"). */
function expressionAt(
  tokens: Token[],
  i: number,
): (Match<Expression> & { first: number }) | null {
  for (let lead = 0; lead <= 2; lead += 1) {
    if (lead > 0 && !EXPRESSION_LEADS.has(tokens[i + lead - 1]?.key ?? ""))
      return null;
    const match = phraseAt(tokens, i + lead, EXPRESSION_KEYS);
    if (match) return { ...match, first: i + lead };
  }
  return null;
}

// ---- nobody else ------------------------------------------------------------------

/** Nobody on the photos: "sans personne", "personne d'autre". */
const NOBODY = [
  "sans personne",
  "sans personnes",
  "sans gens",
  "sans visage",
  "sans visages",
  "sans humain",
  "sans humains",
  "sans personne d'autre",
  "personne d'autre",
].map((phrase) => ({ keys: phraseKeys(phrase), value: true }));

/** Only what follows: "seulement des chats", "uniquement Suzie", "rien que Suzie". */
const ONLY_WORDS = ["seulement", "uniquement", "rien que", "rien qu'"].map(
  (phrase) => ({ keys: phraseKeys(phrase), value: true }),
);

/** After people: they are alone on the photos. */
const ALONE = [
  "seul",
  "seule",
  "seuls",
  "seules",
  "tout seul",
  "toute seule",
  "tous seuls",
  "toutes seules",
].map((phrase) => ({ keys: phraseKeys(phrase), value: true }));

/** Between a negation and what it negates: « sans un parasol », « pas de vent ». */
const NEGATED_ARTICLES = new Set(words("de d' du des la le les l' un une"));

/** Whether token `i` is what a negation just before it negates. */
function negatedAt(tokens: Token[], i: number): boolean {
  let n = i - 1;
  while (n >= 0 && NEGATED_ARTICLES.has(tokens[n]?.key ?? "")) n -= 1;
  return NEGATIONS.has(tokens[n]?.key ?? "") || tokens[n]?.key === "ni";
}

/** Before a person: she is not on the photos. */
const PERSON_NEGATIONS = new Set(words("sans ni pas"));

/** "il n'y a que des chats": "que" says only after these, or at the start. */
const BEFORE_ONLY_QUE = new Set(words("ne n' rien juste"));

/** "que des chatons", "que Suzie": "que" says only when one of these follows it. */
const AFTER_ONLY_QUE = new Set(
  words("des les du de d' la le l' un une mon ma mes"),
);

// ---- scene tags -------------------------------------------------------------------

/** Words that lead to a tag: "à la plage", "en extérieur", "avec un chat", "photos de chats". */
const TAG_LEADS = new Set(
  words(
    "en a au aux la le les l' dans sur sous avec de des du d' un une chez pres",
  ),
);

/** Leading a tag, it says the photos do not show it: "sans voiture", "pas de chien". */
const NEGATIONS = new Set(words("sans pas aucun aucune"));

interface TagKeys {
  keys: readonly string[];
  value: TagWords;
}

/** A word's plural the way French writes most of them: chat, chats; oiseau, oiseaux; cheval, chevaux. */
function pluralOf(key: string): string[] {
  if (STOPWORDS.has(key) || /[sxz]$/.test(key)) return [];
  if (/(au|eu)$/.test(key)) return [`${key}x`];
  if (key.endsWith("al")) return [`${key.slice(0, -2)}aux`, `${key}s`];
  return [`${key}s`];
}

/**
 * Each tag's words, and their plurals: of the last word ("chats"), of the
 * first ("couchers de soleil") and of every word ("jeunes animaux").
 */
function tagKeysOf(tags: readonly TagWords[]): TagKeys[] {
  return tags.flatMap((tag) =>
    tag.words.flatMap((word) => {
      const keys = phraseKeys(word);
      const pluralAt = (at: number[]) =>
        at.reduce<string[][]>(
          (variants, n) =>
            variants.flatMap((variant) => {
              const plurals = pluralOf(variant[n] ?? "");
              return plurals.length === 0
                ? [variant]
                : plurals.map((plural) =>
                    variant.map((k, m) => (m === n ? plural : k)),
                  );
            }),
          [keys],
        );
      const last = keys.length - 1;
      const variants = [
        keys,
        ...pluralAt([last]),
        ...pluralAt([0]),
        ...pluralAt(keys.map((_, n) => n)),
      ];
      const seen = new Set<string>();
      return variants
        .filter((variant) => {
          const id = variant.join(" ");
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((variant) => ({ keys: variant, value: tag }));
    }),
  );
}

/** A tag at `i`, led by up to three words ("pas de", "à la"), maybe negated. */
function tagAt(
  tokens: Token[],
  i: number,
  tags: readonly TagKeys[],
): (Match<TagWords> & { negated: boolean; first: number }) | null {
  if (tags.length === 0) return null;
  const negated = NEGATIONS.has(tokens[i]?.key ?? "");
  const start = negated ? i + 1 : i;
  for (let lead = 0; lead <= 3; lead += 1) {
    if (lead > 0 && !TAG_LEADS.has(tokens[start + lead - 1]?.key ?? ""))
      return null;
    const match = phraseAt(tokens, start + lead, tags);
    if (match) return { ...match, negated, first: start + lead };
  }
  return null;
}

// ---- the query ----------------------------------------------------------------

/** "negated": what a negation negates (negatedAt), left out of every text */
type Role = "part" | "content" | "stop" | "negated";

const spanOf = (tokens: Token[], first: number, end: number): Span => [
  tokens[first]?.start ?? 0,
  tokens[end - 1]?.end ?? 0,
];

/**
 * The text of tokens `indices` (in order), trimmed of stopwords at both
 * ends: runs of neighbours keep the query's own spelling ("d'anniversaire"),
 * a token in `spelled` is written as it says ("noel" as "noël"). Null when
 * nothing but stopwords is left.
 */
function textOf(
  q: string,
  tokens: Token[],
  indices: number[],
  spelled: ReadonlyMap<number, string> = new Map(),
): string | null {
  const stop = (index: number) => STOPWORDS.has(tokens[index]?.key ?? "");
  let first = 0;
  let last = indices.length - 1;
  while (first <= last && stop(indices[first] ?? -1)) first += 1;
  while (last >= first && stop(indices[last] ?? -1)) last -= 1;
  const runs: string[] = [];
  let run: Span | null = null;
  const close = () => {
    if (run) runs.push(q.slice(run[0], run[1]));
    run = null;
  };
  for (const index of indices.slice(first, last + 1)) {
    const token = tokens[index];
    if (!token) continue;
    const word = spelled.get(index);
    if (word !== undefined) {
      close();
      runs.push(word);
    } else if (run && tokens[index - 1]?.end === run[1]) run[1] = token.end;
    else {
      close();
      run = [token.start, token.end];
    }
  }
  close();
  return runs.length === 0 ? null : runs.join(" ").replace(/\s+/g, " ");
}

/**
 * Reads `q` against the named `people` and the scene `tags`. Left to right,
 * at each word: "sans personne", "seulement", "que des" (nobody else on the
 * photos); a name (the longest), and "seul" right after names; a date with
 * the words leading to it; how a face looks, bound to the names just
 * before it ("Céline et Stéphane qui sourient": each of them smiles) or to
 * anyone ("quelqu'un qui pleure", "photos tristes"); a tag with the words
 * leading to it, "sans" or "pas de" before it to say not that; a color or
 * a tone. A color or a look counts for the photo at the start, after a
 * filter or a stopword ("photos rouges"), or led by "en" or "couleurs"
 * ("plage en noir et blanc"); right after another word it describes that
 * thing and stays content ("un chat noir", "un chien heureux"). One color
 * and one tone at most: a second one is content. A year is a whole word:
 * "IMG_2015" is no date. Dates combine as DateFilter says. Nothing
 * understood: the whole query is the content, as typed.
 */
export function understandQuery(
  q: string,
  people: readonly NamedPerson[],
  tags: readonly TagWords[] = [],
): UnderstoodQuery {
  const tokens = tokenize(q);
  const named: PersonKeys[] = people.map(({ id, name }) => ({
    id,
    name,
    keys: tokenize(name).map((t) => t.key),
  }));
  const tagKeys = tagKeysOf(tags);
  const roles: Role[] = [];
  // A date's own word that also says what the photos show: "Noël"
  const hints = new Map<number, string>();
  // A tag's words: content again when other words are ("un chat qui court")
  const tagHints: number[] = [];
  // Tokens naming a thing (a tag): a color or a look right after describes it
  const things = new Set<number>();
  const parts: QueryPart[] = [];
  const dates: DateFilter = { ranges: [], annual: [] };
  const colors: ColorFilter = { color: null, tone: null };
  const personIds: number[] = [];
  const withoutIds: number[] = [];
  const faces: FaceCondition[] = [];
  const tagConditions: TagCondition[] = [];
  let only = false;
  // The names just read ("Céline et Stéphane") and the token after them
  let run: { ids: number[]; end: number } | null = null;
  const mark = (from: number, end: number) => {
    for (let n = from; n < end; n += 1) roles[n] = "part";
  };
  const describes = (n: number) => roles[n] === "content" || things.has(n);
  const markOnly = (from: number, end: number) => {
    mark(from, end);
    only = true;
    const known = parts.find((p) => p.kind === "only");
    if (known) known.spans.push(spanOf(tokens, from, end));
    else
      parts.push({
        kind: "only",
        label: "",
        spans: [spanOf(tokens, from, end)],
      });
  };

  let i = 0;
  while (i < tokens.length) {
    const key = tokens[i]?.key ?? "";
    // « que » alone is a relative pronoun (« le chat que la voisine a
    // adopté »): it says only at the start or after « ne », « rien », « juste »
    const onlyQue =
      (key === "que" || key === "qu'") &&
      (i === 0 ||
        [1, 2, 3].some((back) =>
          BEFORE_ONLY_QUE.has(tokens[i - back]?.key ?? ""),
        )) &&
      (AFTER_ONLY_QUE.has(tokens[i + 1]?.key ?? "") ||
        personAt(tokens, i + 1, named) !== null);
    const nobody =
      phraseAt(tokens, i, NOBODY) ??
      phraseAt(tokens, i, ONLY_WORDS) ??
      (onlyQue ? { end: i + 1, value: true } : null) ??
      (run?.end === i ? phraseAt(tokens, i, ALONE) : null);
    if (nobody) {
      markOnly(i, nobody.end);
      i = nobody.end;
      continue;
    }

    const absent = PERSON_NEGATIONS.has(key)
      ? personAt(tokens, i + 1, named)
      : null;
    if (absent) {
      mark(i, absent.end);
      const { id, name } = absent.value;
      parts.push({
        kind: "without",
        label: name,
        personId: id,
        spans: [spanOf(tokens, i, absent.end)],
      });
      if (!withoutIds.includes(id)) withoutIds.push(id);
      run = null;
      i = absent.end;
      continue;
    }

    const person = personAt(tokens, i, named);
    if (person) {
      const spans: Span[] = [spanOf(tokens, i, person.end)];
      // "Céline et Stéphane": the "et" goes with the second name
      const joiner = tokens[i - 1];
      const before = parts[parts.length - 1];
      let joined = false;
      if (
        joiner &&
        PEOPLE_JOINERS.has(joiner.key) &&
        roles[i - 1] === "stop" &&
        before?.kind === "person" &&
        (before.spans[before.spans.length - 1]?.[1] ?? -1) ===
          tokens[i - 2]?.end
      ) {
        spans.unshift([joiner.start, joiner.end]);
        roles[i - 1] = "part";
        joined = true;
      }
      mark(i, person.end);
      const { id, name } = person.value;
      const known = parts.find((p) => p.kind === "person" && p.personId === id);
      if (known) known.spans.push(...spans);
      else {
        parts.push({ kind: "person", label: name, personId: id, spans });
        personIds.push(id);
      }
      run =
        run && (run.end === i || (joined && run.end === i - 1))
          ? { ids: [...run.ids, id], end: person.end }
          : { ids: [id], end: person.end };
      i = person.end;
      continue;
    }

    let date: Match<DateValue> | null = null;
    let lead = 0;
    for (; lead <= 2 && !date; lead += 1) {
      if (lead > 0 && !DATE_LEADS.has(tokens[i + lead - 1]?.key ?? "")) break;
      date = dateAt(tokens, i + lead);
    }
    if (date) {
      const at = i + lead - 1;
      mark(i, date.end);
      if (tokens[at]?.key === "noel") hints.set(at, "noël");
      dates.ranges.push(...date.value.ranges);
      dates.annual.push(...date.value.annual);
      parts.push({
        kind: "date",
        label: date.value.label,
        spans: [spanOf(tokens, i, date.end)],
      });
      i = date.end;
      continue;
    }

    const subject = phraseAt(tokens, i, SUBJECTS);
    const look = expressionAt(tokens, subject ? subject.end : i);
    if (look) {
      const bound = !subject && run?.end === i ? run.ids : [];
      const word = tokens[look.first]?.key ?? "";
      const alone = look.end - look.first === 1 && BOUND_ONLY.has(word);
      if (
        bound.length > 0 ||
        subject !== null ||
        (!alone && !describes(i - 1))
      ) {
        mark(i, look.end);
        parts.push({
          kind: "expression",
          label: EXPRESSION_LABELS[look.value],
          expression: look.value,
          people: bound,
          spans: [spanOf(tokens, i, look.end)],
        });
        if (bound.length === 0)
          faces.push({ person: null, expression: look.value });
        for (const id of bound)
          faces.push({ person: id, expression: look.value });
        // "Céline qui sourit les yeux fermés": the next look is hers too
        if (run && bound.length > 0) run = { ...run, end: look.end };
        i = look.end;
        continue;
      }
    }

    const tag = tagAt(tokens, i, tagKeys);
    if (tag) {
      mark(i, tag.end);
      for (let n = tag.first; n < tag.end; n += 1) things.add(n);
      // "sans voiture" says nothing the photos show
      if (!tag.negated) for (let n = i; n < tag.end; n += 1) tagHints.push(n);
      const spans: Span[] = [spanOf(tokens, i, tag.end)];
      const known = parts.find(
        (p) => p.kind === "tag" && p.tag === tag.value.tag,
      );
      if (known) known.spans.push(...spans);
      else {
        parts.push({
          kind: "tag",
          label: tag.value.label,
          tag: tag.value.tag,
          negated: tag.negated,
          spans,
        });
        tagConditions.push({ tag: tag.value.tag, negated: tag.negated });
      }
      i = tag.end;
      continue;
    }

    let color: Match<ColorValue> | null = null;
    let colorFrom = i;
    if (COLOR_LEADS.has(tokens[i]?.key ?? "")) {
      colorFrom += 1;
      if (COLOR_ARTICLES.has(tokens[colorFrom]?.key ?? "")) colorFrom += 1;
    }
    if (COLOR_NOUNS.has(tokens[colorFrom]?.key ?? "")) colorFrom += 1;
    const led = colorFrom > i;
    if (led || !describes(i - 1)) color = colorAt(tokens, colorFrom);
    if (
      color &&
      (color.value.kind === "hue"
        ? colors.color === null
        : colors.tone === null)
    ) {
      const value = color.value;
      const spans: Span[] = [spanOf(tokens, i, color.end)];
      mark(i, color.end);
      if (value.kind === "hue") {
        colors.color = value.hue;
        parts.push({
          kind: "color",
          label: HUE_LABELS[value.hue],
          hue: value.hue,
          spans,
        });
      } else {
        colors.tone = value.tone;
        parts.push({
          kind: "tone",
          label: TONE_LABELS[value.tone],
          tone: value.tone,
          spans,
        });
      }
      i = color.end;
      continue;
    }

    // A thing the photos must not show and no filter says (« plage sans
    // parasol »): the embedder cannot read « not », so it is no content
    roles[i] = STOPWORDS.has(tokens[i]?.key ?? "")
      ? "stop"
      : negatedAt(tokens, i)
        ? "negated"
        : "content";
    i += 1;
  }

  const left = tokens.flatMap((_, n) =>
    roles[n] === "part" || roles[n] === "negated" ? [] : [n],
  );
  const text = textOf(q, tokens, left);
  const withHints = [
    ...left,
    ...hints.keys(),
    ...(text === null ? [] : tagHints),
  ].sort((a, b) => a - b);
  const content =
    parts.length === 0
      ? (text ??
        (q.trim() === "" || roles.includes("negated")
          ? null
          : q.trim().replace(/\s+/g, " ")))
      : textOf(q, tokens, withHints, hints);
  // A face's person is on the photo: no need to ask it twice
  const lookers = new Set(faces.map((face) => face.person));
  const plain = personIds.filter((id) => !lookers.has(id));
  return {
    parts: parts.map((part) =>
      part.kind === "only"
        ? { ...part, label: onlyLabel(personIds.length > 0, faces) }
        : part,
    ),
    people: plain,
    withoutPeople: withoutIds,
    faces,
    tags: tagConditions,
    only,
    dates,
    colors,
    text: parts.length === 0 ? null : text,
    content,
    cut: parts.length === 0 || text !== null,
  };
}

/**
 * What « nobody else » reads as: nobody but the people named; with a look
 * on anyone's face (« que des enfants qui sourient »), every face looks so.
 */
export function onlyLabel(
  withPeople: boolean,
  faces: readonly FaceCondition[],
): string {
  if (faces.some((face) => face.person === null)) return "Tout le monde";
  return withPeople ? "Personne d'autre" : "Sans personne";
}

/**
 * `text` read as one date, as the `date` filter of a URL carries it
 * ("2015", "été 2015", "en décembre", "noël"): its label and days. Null
 * when it is no date, or more than one.
 */
export function readDate(
  text: string,
): { label: string; dates: DateFilter } | null {
  const tokens = tokenize(text);
  for (let lead = 0; lead <= 2; lead += 1) {
    if (lead > 0 && !DATE_LEADS.has(tokens[lead - 1]?.key ?? "")) return null;
    const date = dateAt(tokens, lead);
    if (date)
      return date.end === tokens.length
        ? {
            label: date.value.label,
            dates: { ranges: date.value.ranges, annual: date.value.annual },
          }
        : null;
  }
  return null;
}

/**
 * The query without what `parts` stand for: their words cut out, and an
 * "et" or a comma left hanging at either end dropped. "Céline et Stéphane
 * à Noël" without Céline is "Stéphane à Noël".
 */
export function removeParts(
  q: string,
  parts: readonly { spans: readonly Span[] }[],
): string {
  const cuts = parts
    .flatMap((part) => part.spans)
    .slice()
    .sort((a, b) => a[0] - b[0]);
  let kept = "";
  let at = 0;
  for (const [start, end] of cuts) {
    if (start > at) kept += q.slice(at, start);
    at = Math.max(at, end);
  }
  kept += q.slice(at);
  const tokens = tokenize(kept);
  let first = 0;
  let last = tokens.length - 1;
  while (first <= last && LOOSE_ENDS.has(tokens[first]?.key ?? "")) first += 1;
  while (last >= first && LOOSE_ENDS.has(tokens[last]?.key ?? "")) last -= 1;
  if (first > last) return "";
  return kept
    .slice(tokens[first]?.start ?? 0, tokens[last]?.end ?? 0)
    .replace(/\s+/g, " ");
}
