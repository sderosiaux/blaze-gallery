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
  tags: TagChoice[];
  /** The tags the server reads in a query: those with photos */
  tagged: TagChoice[];
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
    tagged: tags.filter((t) => t.tagged),
    years:
      years && typeof years.from === "number" && typeof years.to === "number"
        ? { from: years.from, to: years.to }
        : null,
  };
}

// One request per tab: the filter bar, the chips and the search box share it
let loading: Promise<FilterVocabulary> | null = null;

function loadVocabulary(): Promise<FilterVocabulary> {
  loading ??= fetch("/api/filters/vocabulary")
    .then(async (response) => {
      const data = await readJsonObject(response);
      if (!response.ok || data.success !== true)
        throw new Error(`HTTP ${response.status}`);
      return readVocabulary(data);
    })
    .catch((error: unknown) => {
      // The next one asks again
      loading = null;
      throw error;
    });
  return loading;
}

/** The vocabulary, null until it comes (or when it could not be had: chips then show what the URL says). */
export function useFilterVocabulary(): FilterVocabulary | null {
  const [vocabulary, setVocabulary] = useState<FilterVocabulary | null>(null);
  useEffect(() => {
    let live = true;
    loadVocabulary()
      .then((loaded) => {
        if (live) setVocabulary(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return vocabulary;
}
