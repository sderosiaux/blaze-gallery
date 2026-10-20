import { understandQuery, type UnderstoodQuery } from "@/lib/searchQuery";
import type { FilterVocabulary } from "./useFilterVocabulary";

// The chips, the menu and the pages read the same words on every render:
// once per words and vocabulary (a new vocabulary is a new object)
const memo = new WeakMap<object, Map<string, UnderstoodQuery>>();
const NO_VOCABULARY = {};
const KEPT = 50;

/** understandQuery against the vocabulary's people and tags (none before it comes). */
export function understood(
  q: string,
  vocabulary: FilterVocabulary | null,
): UnderstoodQuery {
  const owner = vocabulary ?? NO_VOCABULARY;
  let byWords = memo.get(owner);
  if (!byWords) {
    byWords = new Map();
    memo.set(owner, byWords);
  }
  let read = byWords.get(q);
  if (!read) {
    read = understandQuery(q, vocabulary?.people ?? [], vocabulary?.tags ?? []);
    if (byWords.size >= KEPT) byWords.clear();
    byWords.set(q, read);
  }
  return read;
}
