/**
 * From a URL's filter (lib/photoFilter.ts) to the PhotoFilter every list
 * runs on (lib/database.ts): `q` read by understandQuery against the named
 * people and the scene tags, the tags' thresholds from db/tags.json, the
 * dates read, and the content embedded with its floor measured. Every
 * API route of a list resolves the same way, so a filter keeps the same
 * photos wherever it is read. Server only: it reads the database and
 * db/tags.json.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ColorFilter } from "./colors";
import {
  contentPhotos,
  listPersonNames,
  NO_PHOTO_FILTER,
  rareTags,
  taggedShare,
  tagsWithPhotos,
  type PhotoFilter,
  type TagFilter,
} from "./database";
import { logger } from "./logger";
import type { FaceCondition, UrlFilter } from "./photoFilter";
import {
  findTag,
  NO_TAGS,
  readTagVocabulary,
  type SceneTag,
  type TagVocabulary,
} from "./sceneTags";
import {
  isStopword,
  readDate,
  understandQuery,
  type QueryPart,
} from "./searchQuery";
import type { DateFilter } from "./semanticQuery";
import { hasDateFilter } from "./semanticQuery";
import { embedContent } from "./semanticSearch";

let vocabulary: TagVocabulary | null = null;

/**
 * db/tags.json, read once per server. Until the worker's file is deployed
 * there is none: every tag word then reads as content, ranked by meaning.
 * A file that does not read is logged and treated the same way, so a bad
 * deploy of it costs the tags, not the lists.
 */
export function sceneTagVocabulary(): TagVocabulary {
  if (vocabulary) return vocabulary;
  const file = path.join(process.cwd(), "db", "tags.json");
  try {
    vocabulary = readTagVocabulary(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT")
      logger.error(
        "db/tags.json does not read: scene tags are off",
        { file },
        error instanceof Error ? error : new Error(String(error)),
      );
    vocabulary = NO_TAGS;
  }
  return vocabulary;
}

/** The worker tags while the app runs: which tags have photos is asked again after this long. */
const TAGGED_TTL_MS = 60_000;
let tagged: { at: number; tags: Set<string> } | null = null;

/** The vocabulary's tags some photo of the gallery has (photo_tags), cached TAGGED_TTL_MS. */
export async function taggedTags(
  known: TagVocabulary = sceneTagVocabulary(),
): Promise<Set<string>> {
  if (tagged && Date.now() - tagged.at < TAGGED_TTL_MS) return tagged.tags;
  const tags = await tagsWithPhotos(
    known.tags.map((entry) => entry.tag),
    known.version,
  );
  tagged = { at: Date.now(), tags };
  return tags;
}

/** A run of the tagger takes hours: how far it has got is asked again after this long. */
const SHARE_TTL_MS = 10 * 60_000;
let share: { at: number; version: number; share: number } | null = null;

/** taggedShare of the vocabulary's version, cached SHARE_TTL_MS. */
async function cachedTaggedShare(version: number): Promise<number> {
  if (share?.version === version && Date.now() - share.at < SHARE_TTL_MS)
    return share.share;
  share = { at: Date.now(), version, share: await taggedShare(version) };
  return share.share;
}

/** How long a tag counts as rare or not (rareTags): the worker tags as the app runs. */
const RARE_TTL_MS = 60_000;
const rarity = new Map<string, { at: number; rare: boolean }>();

/** Each tag with whether few photos show it, asked again after RARE_TTL_MS. */
async function withRarity(tags: TagFilter[]): Promise<TagFilter[]> {
  const keyOf = (t: TagFilter) =>
    `${t.tag}@${String(t.threshold)}v${String(t.version)}`;
  const now = Date.now();
  const unknown = tags.filter((t) => {
    const known = rarity.get(keyOf(t));
    return !t.negated && (!known || now - known.at >= RARE_TTL_MS);
  });
  if (unknown.length > 0) {
    const rare = await rareTags(unknown);
    for (const t of unknown)
      rarity.set(keyOf(t), { at: now, rare: rare.has(t.tag) });
  }
  return tags.map((t) => ({
    ...t,
    rare: !t.negated && rarity.get(keyOf(t))?.rare === true,
  }));
}

/** What a view adds to the URL's filter: a person's page, a folder, the favorites, the map's period. */
export interface FilterScope {
  people?: readonly number[];
  folder?: string;
  favorites?: boolean;
  dates?: readonly DateFilter[];
}

export interface ResolvedFilter {
  /** Without its content: withContent measures it */
  filter: PhotoFilter;
  /** The words of `q` left for the content, as typed (UnderstoodQuery.text) */
  text: string | null;
  /** What the photos should show, for the embedder; null: nothing */
  content: string | null;
  /** Keep only the photos close enough to `content` (UnderstoodQuery.cut) */
  cut: boolean;
  /** How `q` was read, as chips show it; a color or tone of the URL replaces the query's */
  parts: QueryPart[];
  /** Labels of the dates of the URL, in its order */
  dateLabels: string[];
  /**
   * Tags of the filter no photo has yet (the worker has not tagged them),
   * or of no vocabulary (db/tags.json missing): their words were read as
   * content instead, a negated one left out.
   */
  untagged: string[];
  /**
   * With tags in the filter, the share of the gallery's photos the tagger
   * has read (0..1): the others cannot show a tag yet. Null without tags.
   */
  taggedShare: number | null;
}

export type Resolution =
  | { ok: true; value: ResolvedFilter }
  | { ok: false; error: string };

/**
 * The URL's filter as lists run it. Unknown tags and dates that do not
 * read are errors; an unknown person id keeps no photo, like a deleted one.
 */
export async function resolveFilter(
  url: UrlFilter,
  scope: FilterScope = {},
  known: TagVocabulary = sceneTagVocabulary(),
): Promise<Resolution> {
  const [names, withPhotos] = await Promise.all([
    url.q === "" ? Promise.resolve([]) : listPersonNames(),
    taggedTags(known),
  ]);

  const tagged = (tag: SceneTag) => withPhotos.has(tag.tag);
  const understood = understandQuery(url.q, names, known.tags);

  // A tag nobody tagged a photo with yet would keep none: its words are
  // content instead, ranked by meaning, until the worker has tagged photos
  // with it. Typed, they are the words as typed; already in the content
  // when other words are (UnderstoodQuery.content).
  const typed = (tag: string) => {
    const said = understood.parts
      .flatMap((part) =>
        part.kind === "tag" && part.tag === tag
          ? part.spans.map(([start, end]) => url.q.slice(start, end))
          : [],
      )
      .join(" ")
      .split(/\s+/);
    // "des chiens" is "chiens": the leading words only weigh on the ranking
    while (said.length > 1 && isStopword(said[0] ?? "")) said.shift();
    return said.join(" ");
  };
  const tags: TagFilter[] = [];
  const untagged: string[] = [];
  const fallbackWords: string[] = [];
  const conditions = [
    ...understood.tags.map((condition) => ({ condition, typed: true })),
    ...url.tags.map((condition) => ({ condition, typed: false })),
  ];
  for (const { condition, typed: fromQ } of conditions) {
    const entry = findTag(known, condition.tag);
    if (!entry) {
      // Without the vocabulary file, tags are words, not errors
      if (known.tags.length === 0) {
        untagged.push(condition.tag);
        continue;
      }
      return { ok: false, error: `unknown tag: ${condition.tag}` };
    }
    if (tags.some((tag) => tag.tag === entry.tag)) continue;
    if (tagged(entry))
      tags.push({
        ...condition,
        threshold: entry.threshold,
        version: known.version,
      });
    else {
      untagged.push(entry.tag);
      if (!condition.negated && !(fromQ && understood.text !== null))
        fallbackWords.push(
          fromQ ? typed(entry.tag) : (entry.words[0] ?? entry.label),
        );
    }
  }

  const dates: DateFilter[] = [];
  const dateLabels: string[] = [];
  for (const words of url.dates) {
    const date = readDate(words);
    if (!date) return { ok: false, error: `date does not read: ${words}` };
    dates.push(date.dates);
    dateLabels.push(date.label);
  }
  if (hasDateFilter(understood.dates)) dates.push(understood.dates);

  // The URL's color and tone (the color bar) replace the query's
  const colors: ColorFilter = {
    color: url.colors.color ?? understood.colors.color,
    tone: url.colors.tone ?? understood.colors.tone,
  };
  const parts = understood.parts.filter(
    (part) =>
      !(part.kind === "color" && url.colors.color) &&
      !(part.kind === "tone" && url.colors.tone),
  );

  const faces = uniqueFaces([...understood.faces, ...url.faces]);
  const lookers = new Set(faces.map((face) => face.person));
  const people = [
    ...new Set([...understood.people, ...url.people, ...(scope.people ?? [])]),
  ].filter((id) => !lookers.has(id));
  const withoutPeople = [
    ...new Set([...understood.withoutPeople, ...url.withoutPeople]),
  ];
  // "/albums/2015/" is the folder albums/2015
  const trimmed = scope.folder?.replace(/^\/+|\/+$/g, "");
  const folder = trimmed === undefined || trimmed === "" ? null : trimmed;

  const words = [understood.content, ...fallbackWords].filter(
    (word): word is string => word !== null,
  );
  return {
    ok: true,
    value: {
      filter: {
        ...NO_PHOTO_FILTER,
        people,
        withoutPeople,
        faces,
        tags: await withRarity(tags),
        only: url.only || understood.only,
        dates: [...dates, ...(scope.dates ?? [])],
        colors,
        folder,
        favorites: scope.favorites ?? false,
      },
      text: understood.text,
      content: words.length > 0 ? words.join(" ") : null,
      cut: understood.cut || fallbackWords.length > 0,
      parts,
      dateLabels,
      untagged,
      taggedShare:
        tags.length > 0 ? await cachedTaggedShare(known.version) : null,
    },
  };
}

/**
 * ok: the content is part of the filter. unavailable: it could not be
 * embedded (no embedder, no answer in time): the list keeps the other
 * conditions only, and says so.
 */
export type ContentStatus = "ok" | "unavailable";

/** A content's photos, by query and filter: lists page and the map moves on the same ones. */
const CONTENT_TTL_MS = 10 * 60_000;
const CONTENT_CACHE_SIZE = 100;
const contents = new Map<
  string,
  { at: number; ids: number[]; complete: boolean }
>();

/**
 * The filter with its content as a condition (PhotoFilter.content), for
 * the lists kept in their own order: the photos close enough to the
 * content (contentPhotos), measured among the photos the rest of the
 * filter keeps, kept CONTENT_TTL_MS for that query and filter. A
 * content that only orders (« Noël » alone, cut false) changes nothing in
 * a list with an order of its own.
 * Measured 2026-10-19 against a floor taken over the whole library: a
 * person's photos score lower for a scene than the library's best (a face
 * fills them), so « plage » kept 74 of Céline's photos with the library's
 * floor and 855 with hers, the 800th still a beach; on a rare match it
 * lets more in (« chat » among Suzie's photos: 81, about a third with a
 * cat), where a scene tag does better.
 */
export async function withContent(resolved: ResolvedFilter): Promise<{
  filter: PhotoFilter;
  content: ContentStatus | null;
  /** False when CONTENT_LIMIT cut the content's photos */
  complete: boolean;
}> {
  if (resolved.content === null || !resolved.cut)
    return { filter: resolved.filter, content: null, complete: true };
  const embedding = await embedContent(resolved.content);
  if (!embedding)
    return { filter: resolved.filter, content: "unavailable", complete: true };
  const key = JSON.stringify([
    embedding.model,
    resolved.content,
    resolved.filter,
  ]);
  const now = Date.now();
  let found = contents.get(key);
  if (!found || now - found.at >= CONTENT_TTL_MS) {
    found = { at: now, ...(await contentPhotos(embedding, resolved.filter)) };
    contents.delete(key);
    contents.set(key, found);
    const oldest = contents.keys().next();
    if (contents.size > CONTENT_CACHE_SIZE && !oldest.done)
      contents.delete(oldest.value);
  }
  return {
    filter: { ...resolved.filter, content: { ids: found.ids } },
    content: "ok",
    complete: found.complete,
  };
}

function uniqueFaces(faces: FaceCondition[]): FaceCondition[] {
  return faces.filter(
    (face, i) =>
      faces.findIndex(
        (other) =>
          other.person === face.person && other.expression === face.expression,
      ) === i,
  );
}
