"use client";

import { useEffect, useState } from "react";
import { asArray, isRecord, readJsonObject } from "@/hooks/apiJson";
import {
  EXPRESSION_LABELS,
  isExpression,
  type Expression,
} from "@/lib/photoFilter";
import { TAG_GROUPS, type TagGroup } from "@/lib/sceneTags";
import type { NamedPerson, TagWords } from "@/lib/searchQuery";

export interface PersonChoice extends NamedPerson {
  coverFaceId: number | null;
}

export interface TagChoice extends TagWords {
  group: TagGroup;
  /** Some photo has it; the others still read as words (lib/filterResolver.ts) */
  tagged: boolean;
}

/** What the filters can say: /api/filters/vocabulary. */
export interface FilterVocabulary {
  /** Most photographed first */
  people: PersonChoice[];
  expressions: { key: Expression; label: string }[];
  /** What the server reads a query against (the tags without photos read as words) */
  tags: TagChoice[];
  years: { from: number; to: number } | null;
}

function readVocabulary(data: Record<string, unknown>): FilterVocabulary {
  const people = asArray(data.people).flatMap((p): PersonChoice[] =>
    isRecord(p) && typeof p.id === "number" && typeof p.name === "string"
      ? [
          {
            id: p.id,
            name: p.name,
            coverFaceId:
              typeof p.cover_face_id === "number" ? p.cover_face_id : null,
          },
        ]
      : [],
  );
  const tags = asArray(data.tags).flatMap((t): TagChoice[] =>
    isRecord(t) &&
    typeof t.tag === "string" &&
    typeof t.label === "string" &&
    TAG_GROUPS.some((g) => g === t.group) &&
    Array.isArray(t.words)
      ? [
          {
            tag: t.tag,
            label: t.label,
            group: t.group as TagGroup,
            words: t.words.filter((w): w is string => typeof w === "string"),
            tagged: t.tagged === true,
          },
        ]
      : [],
  );
  const years = isRecord(data.years) ? data.years : null;
  return {
    people,
    expressions: asArray(data.expressions).flatMap((e) =>
      isRecord(e) && isExpression(e.key)
        ? [{ key: e.key, label: EXPRESSION_LABELS[e.key] }]
        : [],
    ),
    tags,
    years:
      years && typeof years.from === "number" && typeof years.to === "number"
        ? { from: years.from, to: years.to }
        : null,
  };
}

/**
 * One request a minute per tab: the filter bar, the chips and the search
 * box share it, and a person named or a tag that got its first photos
 * shows in the next view opened after that.
 */
const FRESH_MS = 60_000;
let loading: { at: number; vocabulary: Promise<FilterVocabulary> } | null =
  null;

function loadVocabulary(): Promise<FilterVocabulary> {
  if (loading && Date.now() - loading.at < FRESH_MS) return loading.vocabulary;
  const vocabulary = fetch("/api/filters/vocabulary")
    .then(async (response) => {
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true)
        throw new Error(`HTTP ${response.status}`);
      return readVocabulary(data);
    })
    .catch((error: unknown) => {
      // The next one asks again
      if (loading?.vocabulary === vocabulary) loading = null;
      throw error;
    });
  loading = { at: Date.now(), vocabulary };
  return vocabulary;
}

/**
 * The vocabulary, null until it comes or when it could not be had (chips
 * then show what the URL says); `settled` once it came or failed.
 */
export function useFilterVocabularyState(): {
  vocabulary: FilterVocabulary | null;
  settled: boolean;
} {
  const [state, setState] = useState<{
    vocabulary: FilterVocabulary | null;
    settled: boolean;
  }>({ vocabulary: null, settled: false });
  useEffect(() => {
    let live = true;
    loadVocabulary()
      .then((vocabulary) => {
        if (live) setState({ vocabulary, settled: true });
      })
      .catch(() => {
        if (live) setState({ vocabulary: null, settled: true });
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** The vocabulary, null until it comes (or when it could not be had: chips then show what the URL says). */
export function useFilterVocabulary(): FilterVocabulary | null {
  return useFilterVocabularyState().vocabulary;
}
