/**
 * The scene tags the worker writes into photo_tags (db/schema.sql), as
 * db/tags.json defines them: that file belongs to the worker's tagging
 * task, the app only reads its words, labels and thresholds. Pure; the
 * server reads the file (lib/filterResolver.ts).
 */

/** How the filter menu groups them: Scène/Lieu, Animaux, the rest. */
export const TAG_GROUPS = [
  "scene",
  "lieu",
  "animal",
  "moment",
  "chose",
] as const;

export type TagGroup = (typeof TAG_GROUPS)[number];

export interface SceneTag {
  tag: string;
  /** As a chip shows it: "Extérieur" */
  label: string;
  group: TagGroup;
  /** What the search box reads as this tag: words or phrases, as typed */
  words: string[];
  /** A photo shows the tag from this score (photo_tags.score, 0..1) */
  threshold: number;
}

export interface TagVocabulary {
  version: number;
  tags: SceneTag[];
}

export const NO_TAGS: TagVocabulary = { version: 0, tags: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTagGroup(value: unknown): value is TagGroup {
  return TAG_GROUPS.some((group) => group === value);
}

/**
 * The vocabulary of a parsed db/tags.json. A file that does not have its
 * shape throws: a tag read with no threshold would filter on anything.
 */
export function readTagVocabulary(json: unknown): TagVocabulary {
  if (!isRecord(json) || !Array.isArray(json.tags))
    throw new Error("tags.json: expected { version, tags: [...] }");
  const version = json.version;
  if (typeof version !== "number" || !Number.isInteger(version))
    throw new Error("tags.json: version must be an integer");
  const tags = json.tags.map((entry, i): SceneTag => {
    if (!isRecord(entry)) throw new Error(`tags.json: tags[${i}] is no object`);
    const { tag, label, group, words, threshold } = entry;
    if (typeof tag !== "string" || !/^[a-z0-9_]{1,40}$/.test(tag))
      throw new Error(`tags.json: tags[${i}].tag must match [a-z0-9_]+`);
    if (typeof label !== "string" || label === "")
      throw new Error(`tags.json: ${tag}.label is missing`);
    if (!isTagGroup(group))
      throw new Error(
        `tags.json: ${tag}.group must be one of ${TAG_GROUPS.join(", ")}`,
      );
    if (
      !Array.isArray(words) ||
      !words.every((w): w is string => typeof w === "string" && w.trim() !== "")
    )
      throw new Error(`tags.json: ${tag}.words must be strings`);
    if (typeof threshold !== "number" || !(threshold > 0 && threshold <= 1))
      throw new Error(`tags.json: ${tag}.threshold must be in (0, 1]`);
    return { tag, label, group, words, threshold };
  });
  return { version, tags };
}

export function findTag(
  vocabulary: TagVocabulary,
  tag: string,
): SceneTag | undefined {
  return vocabulary.tags.find((entry) => entry.tag === tag);
}
