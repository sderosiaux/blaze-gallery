import {
  COLOR_TONES,
  HUE_LABELS,
  HUES,
  TONE_LABELS,
  type Hue,
} from "@/lib/colors";
import {
  EXPRESSION_LABELS,
  EXPRESSIONS,
  type Expression,
} from "@/lib/photoFilter";
import { expressionPhrases } from "@/lib/searchQuery";
import { normalizeTextForSearch } from "@/lib/textUtils";
import type { FilterVocabulary } from "./useFilterVocabulary";

/** A way to finish the word being typed, as the search box reads it. */
export interface Completion {
  kind: "person" | "look" | "tag" | "color" | "tone";
  label: string;
  /** What replaces the word being typed */
  insert: string;
  faceId?: number | null;
  hue?: Hue;
  expression?: Expression;
}

/** How each look is best written after a name: « Céline sourit », « Suzie les yeux fermés ». */
const LOOK_WORDS: Record<Expression, string> = {
  sourit: "sourit",
  rit: "rit",
  triste: "triste",
  yeux_fermes: "les yeux fermés",
};

const MIN_LENGTH = 2;
const LIMIT = 6;

const key = (text: string) => normalizeTextForSearch(text);

/** Whether a word of `text` starts with `typed` (both keys). */
function startsAWord(text: string, typed: string): boolean {
  return key(text)
    .split(/[\s'’-]+/)
    .some((word) => word.startsWith(typed));
}

/** The word being typed: the last one, when the caret is at the end. */
export function typedWord(value: string): { word: string; start: number } {
  const match = /(\S+)$/.exec(value);
  return match
    ? { word: match[1] ?? "", start: match.index }
    : { word: "", start: value.length };
}

/**
 * The people, looks, scene tags and colors that finish the word being
 * typed, most likely first: people by how often they are photographed,
 * then the rest in the vocabulary's order.
 */
export function completionsFor(
  value: string,
  vocabulary: FilterVocabulary | null,
): Completion[] {
  const typed = key(typedWord(value).word);
  if (typed.length < MIN_LENGTH) return [];
  const found: Completion[] = [];
  for (const person of vocabulary?.people ?? [])
    if (startsAWord(person.name, typed))
      found.push({
        kind: "person",
        label: person.name,
        insert: person.name,
        faceId: person.coverFaceId,
      });
  const looks = new Set(
    expressionPhrases()
      .filter(({ phrase }) =>
        phrase.split(" ").some((word) => word.startsWith(typed)),
      )
      .map(({ expression }) => expression),
  );
  for (const expression of EXPRESSIONS)
    if (
      looks.has(expression) ||
      startsAWord(EXPRESSION_LABELS[expression], typed)
    )
      found.push({
        kind: "look",
        label: EXPRESSION_LABELS[expression],
        insert: LOOK_WORDS[expression],
        expression,
      });
  for (const tag of vocabulary?.tags ?? []) {
    const word = [tag.label, ...tag.words].find((w) => startsAWord(w, typed));
    if (word)
      found.push({
        kind: "tag",
        label: tag.label,
        insert: tag.words[0] ?? tag.label.toLowerCase(),
      });
  }
  for (const hue of HUES)
    if (startsAWord(HUE_LABELS[hue], typed))
      found.push({
        kind: "color",
        label: HUE_LABELS[hue],
        insert: HUE_LABELS[hue].toLowerCase(),
        hue,
      });
  for (const tone of COLOR_TONES)
    if (startsAWord(TONE_LABELS[tone], typed))
      found.push({
        kind: "tone",
        label: TONE_LABELS[tone],
        insert: TONE_LABELS[tone].toLowerCase(),
      });
  // The word already whole is no suggestion
  return found
    .filter((completion) => key(completion.insert) !== typed)
    .slice(0, LIMIT);
}

/**
 * `value` with the word being typed replaced by the completion, a space
 * after; words of it typed already are not written twice (« Suzie en col »
 * is « Suzie en colère »).
 */
export function complete(value: string, completion: Completion): string {
  const { start } = typedWord(value);
  const before = value.slice(0, start).trimEnd();
  const words = completion.insert.split(" ");
  for (let k = words.length - 1; k > 0; k -= 1) {
    const typedAlready = key(words.slice(0, k).join(" "));
    if (key(before).endsWith(typedAlready))
      return `${before} ${words.slice(k).join(" ")} `;
  }
  return `${value.slice(0, start)}${completion.insert} `;
}
