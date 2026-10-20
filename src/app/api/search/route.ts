import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { hasColorFilter } from "@/lib/colors";
import type {
  FolderSearchCursor,
  PhotoFilter,
  PhotoSearchCursor,
} from "@/lib/database";
import {
  countSearchMatches,
  getPhotosByColor,
  getTimelinePhotos,
  hasPhotoFilter,
  searchFolders,
  searchPhotos,
} from "@/lib/database";
import { resolveFilter, type ResolvedFilter } from "@/lib/filterResolver";
import { listPeople } from "@/lib/people";
import { hasUrlFilter, parseUrlFilter } from "@/lib/photoFilter";
import type { QueryPart } from "@/lib/searchQuery";
import { semanticSearch, type SemanticResults } from "@/lib/semanticSearch";
import { logger } from "@/lib/logger";
import { isRecord } from "@/hooks/apiJson";
import {
  decodeCursor,
  encodeCursor,
  toOffsetCursor,
} from "@/app/api/_lib/cursor";

export const dynamic = "force-dynamic";

const PHOTO_PAGE = 100;
const FOLDER_PAGE = 20;
const SEMANTIC_PAGE = 60;
const FILTERED_PAGE = 100;
const PEOPLE_LIMIT = 6;

/**
 * Folders and photos matching `q`, accent- and case-insensitively, the
 * photos showing what `q` describes (`semantic`, ranked by similarity), and
 * how `q` was understood (`understood`, lib/searchQuery.ts): the named
 * people and how they look, dates, scene tags, colors and tones it asks
 * for narrow `semantic` to the photos passing them, with the filter
 * parameters of lib/photoFilter.ts besides `q`; the people are also in
 * `people`, as /personnes shows them. When nothing is left to rank by
 * (« Suzie en 2015 »), or the content could not be ranked (semantic
 * unavailable), `filtered` lists what the filters keep: by share of the
 * color when there is one ("color"), else newest first ("taken"). Tags no
 * photo has yet are read as words to rank by (`untagged`). Folder and file
 * names match the query as typed.
 * Without a cursor: the first page of each list, the totals of the name
 * matches and the cursors (`next_photos`, `next_folders`, `semantic.next`,
 * `filtered.next`; null on the last page). With `photos_after`,
 * `folders_after`, `semantic_after` or `filtered_after` set to one of those
 * opaque cursors: only the next page of that list and its following cursor.
 * The filter parameters narrow the photos, name matches included (not the
 * folders); `color` / `tone` each override the one the query says, whose
 * chip goes away. A cursor goes with the same query and filter.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = parseUrlFilter(
    (key) => searchParams.get(key),
    (key) => searchParams.getAll(key),
  );
  if (!url.ok) {
    return NextResponse.json(
      { success: false, error: url.error },
      { status: 400 },
    );
  }
  const { q } = url.value;
  const photosAfter = searchParams.get("photos_after");
  const foldersAfter = searchParams.get("folders_after");
  const semanticAfter = searchParams.get("semantic_after");
  const filteredAfter = searchParams.get("filtered_after");

  try {
    if (!hasUrlFilter(url.value)) {
      return NextResponse.json({
        success: true,
        photos: [],
        photo_total: 0,
        next_photos: null,
        folders: [],
        folder_total: 0,
        next_folders: null,
        semantic: {
          status: "ok",
          photos: [],
          next: null,
          indexed: null,
        },
        filtered: null,
        understood: null,
        people: [],
      });
    }

    if (foldersAfter !== null) {
      const after = decodeCursor(foldersAfter, toFolderCursor);
      if (!after) return badCursor("folders_after");
      const page = await searchFolders(q, after, FOLDER_PAGE);
      return NextResponse.json({
        success: true,
        folders: page.items,
        next_folders: encodeCursor(page.next),
      });
    }

    const resolution = await resolveFilter(url.value);
    if (!resolution.ok) {
      return NextResponse.json(
        { success: false, error: resolution.error },
        { status: 400 },
      );
    }
    const search = resolution.value;

    if (semanticAfter !== null) {
      const after = decodeCursor(semanticAfter, toOffsetCursor);
      if (!after) return badCursor("semantic_after");
      const page = await semanticPage(search, after.offset, false);
      return NextResponse.json({
        success: true,
        semantic: {
          ...page,
          next: page.next === null ? null : encodeCursor({ offset: page.next }),
        },
      });
    }

    if (filteredAfter !== null) {
      const after = decodeCursor(filteredAfter, (value) =>
        toFilteredCursor(value, filteredOrder(search.filter)),
      );
      if (!after) return badCursor("filtered_after");
      return NextResponse.json({
        success: true,
        filtered: await filteredPage(search.filter, after),
      });
    }

    if (photosAfter !== null) {
      const after = decodeCursor(photosAfter, toPhotoCursor);
      if (!after) return badCursor("photos_after");
      const page = await searchPhotos(q, after, PHOTO_PAGE, search.filter);
      return NextResponse.json({
        success: true,
        photos: page.items,
        next_photos: encodeCursor(page.next),
      });
    }

    const ranked = search.content !== null;
    const named = q !== "";
    const [photos, folders, totals, semantic, filtered, people] =
      await Promise.all([
        named ? searchPhotos(q, null, PHOTO_PAGE, search.filter) : null,
        named ? searchFolders(q, null, FOLDER_PAGE) : null,
        named ? countSearchMatches(q, search.filter) : null,
        semanticPage(search, 0, true),
        // Nothing to rank by: the filters' photos
        !ranked && hasPhotoFilter(search.filter)
          ? filteredPage(search.filter)
          : null,
        peopleOf(peopleIn(search.filter)),
      ]);
    // The content could not be ranked: the filters still apply
    const fallback =
      ranked && semantic.status !== "ok" && hasPhotoFilter(search.filter)
        ? await filteredPage(search.filter)
        : filtered;

    return NextResponse.json({
      success: true,
      query: q,
      understood: {
        parts: search.parts.map(understoodPart),
        text: search.text,
        content: search.content,
      },
      untagged: search.untagged,
      photos: photos?.items ?? [],
      photo_total: totals?.photos ?? 0,
      next_photos: encodeCursor(photos?.next ?? null),
      folders: folders?.items ?? [],
      folder_total: totals?.folders ?? 0,
      next_folders: encodeCursor(folders?.next ?? null),
      semantic: {
        ...semantic,
        next:
          semantic.next === null
            ? null
            : encodeCursor({ offset: semantic.next }),
      },
      filtered: fallback,
      people,
    });
  } catch (error) {
    logger.apiError("Error performing search", error as Error, {
      method: "GET",
      path: "/api/search",
    });

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});

/** A part of the query as the page's chips read it (components/find/QueryChips.tsx). */
function understoodPart(part: QueryPart) {
  return {
    kind: part.kind,
    label: part.label,
    spans: part.spans,
    ...(part.kind === "person" || part.kind === "without"
      ? { person_id: part.personId }
      : {}),
    ...(part.kind === "color" ? { color: part.hue } : {}),
    ...(part.kind === "tone" ? { tone: part.tone } : {}),
    ...(part.kind === "expression"
      ? { expression: part.expression, people: part.people }
      : {}),
    ...(part.kind === "tag" ? { tag: part.tag, negated: part.negated } : {}),
  };
}

/** Everyone the filter puts on the photos, plainly or by a face's look. */
function peopleIn(filter: PhotoFilter): number[] {
  return [
    ...new Set([
      ...filter.people,
      ...filter.faces.flatMap((face) =>
        face.person === null ? [] : [face.person],
      ),
    ]),
  ];
}

/** Nothing to embed reads as unavailable, without asking the embedder. */
function semanticPage(
  search: ResolvedFilter,
  offset: number,
  count: boolean,
): Promise<SemanticResults> {
  if (search.content === null)
    return Promise.resolve({
      status: "unavailable",
      photos: [],
      next: null,
      indexed: null,
    });
  return semanticSearch(search.content, {
    filter: search.filter,
    cut: search.cut,
    offset,
    limit: SEMANTIC_PAGE,
    count,
  });
}

type FilteredOrder = "color" | "taken";

type FilteredCursor =
  | { order: "color"; score: number; id: number }
  | { order: "taken"; dateTaken: string; id: number };

function filteredOrder(filter: PhotoFilter): FilteredOrder {
  return hasColorFilter(filter.colors) ? "color" : "taken";
}

/**
 * One page of the photos the filters keep, as the Couleurs page ranks a
 * color (most of it first) or as the timeline lists photos (newest first).
 */
async function filteredPage(
  filter: PhotoFilter,
  after: FilteredCursor | null = null,
) {
  if (filteredOrder(filter) === "color") {
    const { photos, next } = await getPhotosByColor(
      filter,
      after?.order === "color" ? after : null,
      FILTERED_PAGE,
    );
    return {
      order: "color" as const,
      photos,
      next: next ? encodeCursor({ score: next.score, id: next.id }) : null,
    };
  }
  const photos = await getTimelinePhotos(
    after?.order === "taken" ? after : null,
    FILTERED_PAGE,
    filter,
  );
  const last = photos[photos.length - 1];
  const taken = last?.metadata?.date_taken;
  return {
    order: "taken" as const,
    photos,
    next:
      photos.length === FILTERED_PAGE && last && taken
        ? encodeCursor({ dateTaken: taken, id: Number(last.id) })
        : null,
  };
}

/** The named people of the query, counted and pictured as /personnes shows them. */
async function peopleOf(ids: number[]) {
  if (ids.length === 0) return [];
  const people = await listPeople();
  return ids
    .flatMap((id) => people.filter((person) => person.id === id))
    .slice(0, PEOPLE_LIMIT)
    .map(({ id, name, photo_count, cover_face_id }) => ({
      id,
      name,
      photo_count,
      cover_face_id,
    }));
}

function badCursor(param: string) {
  return NextResponse.json(
    { success: false, error: `${param} must be a cursor from this API` },
    { status: 400 },
  );
}

function toFilteredCursor(
  value: unknown,
  order: FilteredOrder,
): FilteredCursor | null {
  if (!isRecord(value)) return null;
  const { score, dateTaken, id } = value;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0)
    return null;
  if (order === "color")
    return typeof score === "number" && Number.isFinite(score)
      ? { order, score, id }
      : null;
  return typeof dateTaken === "string" && !Number.isNaN(Date.parse(dateTaken))
    ? { order, dateTaken, id }
    : null;
}

function toPhotoCursor(value: unknown): PhotoSearchCursor | null {
  if (!isRecord(value)) return null;
  const { folderPath, filename, id } = value;
  return typeof folderPath === "string" &&
    typeof filename === "string" &&
    typeof id === "string" &&
    /^\d+$/.test(id)
    ? { folderPath, filename, id }
    : null;
}

function toFolderCursor(value: unknown): FolderSearchCursor | null {
  if (!isRecord(value)) return null;
  const { name, path } = value;
  return typeof name === "string" && typeof path === "string"
    ? { name, path }
    : null;
}
