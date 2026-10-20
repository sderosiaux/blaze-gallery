import { HUE_LABELS, TONE_LABELS, type Hue } from "@/lib/colors";
import {
  EXPRESSION_LABELS,
  type Expression,
  type UrlFilter,
} from "@/lib/photoFilter";
import {
  keepParts,
  readDate,
  removeParts,
  understandQuery,
  type QueryPart,
} from "@/lib/searchQuery";
import type { FilterVocabulary } from "./useFilterVocabulary";

/** One condition of the filter as the filter bar shows it, and the filter without it. */
export interface FilterChip {
  key: string;
  label: string;
  kind:
    | "person"
    | "look"
    | "tag"
    | "only"
    | "color"
    | "tone"
    | "date"
    | "words";
  /** The person's face, for a person chip */
  faceId?: number | null;
  hue?: Hue;
  expression?: Expression;
  remove: (filter: UrlFilter) => UrlFilter;
}

const NOBODY_ELSE = "Personne d'autre";
const NOBODY = "Sans personne";

/**
 * The chips of a filter: what its words were read as (the way the server
 * reads them, lib/filterResolver.ts), then each parameter. A person and
 * how her face looks are one chip, « Céline · Sourit ». Without the
 * vocabulary yet, names and tags read as words and people show unnamed.
 */
export function filterChips(
  filter: UrlFilter,
  vocabulary: FilterVocabulary | null,
): FilterChip[] {
  const people = vocabulary?.people ?? [];
  const nameOf = (id: number) =>
    people.find((person) => person.id === id)?.name ?? "Une personne";
  const faceOf = (id: number) =>
    people.find((person) => person.id === id)?.coverFaceId ?? null;
  const tagLabel = (tag: string) =>
    vocabulary?.tags.find((entry) => entry.tag === tag)?.label ?? tag;
  const chips: FilterChip[] = [];

  const { q } = filter;
  if (q.trim() !== "") {
    const understood = understandQuery(q, people, vocabulary?.tagged ?? []);
    const withQ = (parts: readonly QueryPart[]) => (f: UrlFilter) => ({
      ...f,
      q: removeParts(f.q, parts),
    });
    const parts = understood.parts.filter(
      (part) =>
        !(part.kind === "color" && filter.colors.color) &&
        !(part.kind === "tone" && filter.colors.tone),
    );
    const merged = new Set<QueryPart>();
    for (const part of parts) {
      if (merged.has(part)) continue;
      switch (part.kind) {
        case "person": {
          // Her looks, read right after her name, go on her chip
          const looks = parts.filter(
            (other) =>
              other.kind === "expression" &&
              other.people.length === 1 &&
              other.people[0] === part.personId,
          );
          for (const look of looks) merged.add(look);
          chips.push({
            key: `q-person-${part.personId}`,
            label: [part.label, ...looks.map((look) => look.label)].join(" · "),
            kind: "person",
            faceId: faceOf(part.personId),
            remove: withQ([part, ...looks]),
          });
          break;
        }
        case "expression":
          chips.push({
            key: `q-look-${part.expression}-${part.people.join("-")}`,
            label: part.label,
            kind: "look",
            expression: part.expression,
            remove: withQ([part]),
          });
          break;
        case "tag":
          chips.push({
            key: `q-tag-${part.tag}`,
            label: part.negated
              ? `Sans ${part.label.toLowerCase()}`
              : part.label,
            kind: "tag",
            remove: withQ([part]),
          });
          break;
        case "only":
          chips.push({
            key: "q-only",
            label: part.label,
            kind: "only",
            remove: withQ([part]),
          });
          break;
        case "color":
          chips.push({
            key: "q-color",
            label: part.label,
            kind: "color",
            hue: part.hue,
            remove: withQ([part]),
          });
          break;
        case "tone":
          chips.push({
            key: "q-tone",
            label: part.label,
            kind: "tone",
            remove: withQ([part]),
          });
          break;
        case "date":
          chips.push({
            key: `q-date-${String(part.spans[0]?.[0] ?? 0)}`,
            label: part.label,
            kind: "date",
            remove: withQ([part]),
          });
          break;
      }
    }
    const words = understood.parts.length === 0 ? q.trim() : understood.text;
    if (words)
      chips.push({
        key: "q-words",
        label: `« ${words} »`,
        kind: "words",
        remove: (f) => ({ ...f, q: keepParts(f.q, understood.parts) }),
      });
  }

  const looksOf = (id: number) =>
    filter.faces.filter((face) => face.person === id);
  const shown = new Set<number>();
  for (const id of [
    ...filter.people,
    ...filter.faces.flatMap((face) =>
      face.person === null ? [] : [face.person],
    ),
  ]) {
    if (shown.has(id)) continue;
    shown.add(id);
    const looks = looksOf(id);
    chips.push({
      key: `p-${id}`,
      label: [
        nameOf(id),
        ...looks.map((face) => EXPRESSION_LABELS[face.expression]),
      ].join(" · "),
      kind: "person",
      faceId: faceOf(id),
      remove: (f) => ({
        ...f,
        people: f.people.filter((other) => other !== id),
        faces: f.faces.filter((face) => face.person !== id),
      }),
    });
  }
  for (const face of filter.faces)
    if (face.person === null)
      chips.push({
        key: `expr-${face.expression}`,
        label: EXPRESSION_LABELS[face.expression],
        kind: "look",
        expression: face.expression,
        remove: (f) => ({
          ...f,
          faces: f.faces.filter(
            (other) =>
              !(other.person === null && other.expression === face.expression),
          ),
        }),
      });
  for (const tag of filter.tags)
    chips.push({
      key: `tag-${tag.tag}`,
      label: tag.negated
        ? `Sans ${tagLabel(tag.tag).toLowerCase()}`
        : tagLabel(tag.tag),
      kind: "tag",
      remove: (f) => ({
        ...f,
        tags: f.tags.filter((other) => other.tag !== tag.tag),
      }),
    });
  if (filter.only)
    chips.push({
      key: "only",
      label: shown.size > 0 ? NOBODY_ELSE : NOBODY,
      kind: "only",
      remove: (f) => ({ ...f, only: false }),
    });
  const { color, tone } = filter.colors;
  if (color)
    chips.push({
      key: "color",
      label: HUE_LABELS[color],
      kind: "color",
      hue: color,
      remove: (f) => ({ ...f, colors: { ...f.colors, color: null } }),
    });
  if (tone)
    chips.push({
      key: "tone",
      label: TONE_LABELS[tone],
      kind: "tone",
      remove: (f) => ({ ...f, colors: { ...f.colors, tone: null } }),
    });
  filter.dates.forEach((words, i) => {
    chips.push({
      key: `date-${i}-${words}`,
      label: readDate(words)?.label ?? words,
      kind: "date",
      remove: (f) => ({ ...f, dates: f.dates.filter((_, n) => n !== i) }),
    });
  });
  return chips;
}
