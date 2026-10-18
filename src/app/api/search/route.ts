import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { parseColorFilter } from "@/lib/colors";
import type {
  FolderSearchCursor,
  PersonPhotoCursor,
  PhotoSearchCursor,
} from "@/lib/database";
import {
  countSearchMatches,
  getPerson,
  getPersonPhotos,
  searchFolders,
  searchPeople,
  searchPhotos,
} from "@/lib/database";
import { semanticSearch } from "@/lib/semanticSearch";
import { ANY_DATE } from "@/lib/semanticQuery";
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
const PEOPLE_LIMIT = 6;

/**
 * Folders and photos matching `q`, accent- and case-insensitively, the
 * photos showing what `q` describes (`semantic`, ranked by similarity) and
 * the named people `q` is about (`people`).
 * Without a cursor: the first page of each list, the totals of the text
 * matches and the cursors (`next_photos`, `next_folders`, `semantic.next`;
 * null on the last page). With `photos_after`, `folders_after` or
 * `semantic_after` set to one of those opaque cursors: only the next page of
 * that list and its following cursor. `color` / `tone` narrow the photos,
 * text and semantic matches alike (not the folders), to those holding that
 * color, in that tone; a cursor goes with the same filter.
 * With `person=<id>` instead of `q`: the photos showing that person, newest
 * first, paged with `photos_after`.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();
  const person = searchParams.get("person");
  const photosAfter = searchParams.get("photos_after");
  const foldersAfter = searchParams.get("folders_after");
  const semanticAfter = searchParams.get("semantic_after");
  const parsedColors = parseColorFilter((key) => searchParams.get(key));
  if (!parsedColors.ok) {
    return NextResponse.json(
      { success: false, error: parsedColors.error },
      { status: 400 },
    );
  }
  const colors = parsedColors.value;

  try {
    if (person !== null) {
      if (!/^\d+$/.test(person)) {
        return NextResponse.json(
          { success: false, error: "person must be a person id" },
          { status: 400 },
        );
      }
      return await personPhotos(Number(person), photosAfter);
    }

    if (q === "") {
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
        people: [],
      });
    }

    if (semanticAfter !== null) {
      const after = decodeCursor(semanticAfter, toOffsetCursor);
      if (!after) return badCursor("semantic_after");
      const page = await semanticSearch(q, {
        range: ANY_DATE,
        colors,
        offset: after.offset,
        limit: SEMANTIC_PAGE,
        count: false,
      });
      return NextResponse.json({
        success: true,
        semantic: {
          ...page,
          next: page.next === null ? null : encodeCursor({ offset: page.next }),
        },
      });
    }

    if (photosAfter !== null) {
      const after = decodeCursor(photosAfter, toPhotoCursor);
      if (!after) return badCursor("photos_after");
      const page = await searchPhotos(q, after, PHOTO_PAGE, colors);
      return NextResponse.json({
        success: true,
        photos: page.items,
        next_photos: encodeCursor(page.next),
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

    const [photos, folders, totals, semantic, people] = await Promise.all([
      searchPhotos(q, null, PHOTO_PAGE, colors),
      searchFolders(q, null, FOLDER_PAGE),
      countSearchMatches(q, colors),
      semanticSearch(q, {
        range: ANY_DATE,
        colors,
        offset: 0,
        limit: SEMANTIC_PAGE,
        count: true,
      }),
      searchPeople(q, PEOPLE_LIMIT),
    ]);

    return NextResponse.json({
      success: true,
      query: q,
      photos: photos.items,
      photo_total: totals.photos,
      next_photos: encodeCursor(photos.next),
      folders: folders.items,
      folder_total: totals.folders,
      next_folders: encodeCursor(folders.next),
      semantic: {
        ...semantic,
        next:
          semantic.next === null
            ? null
            : encodeCursor({ offset: semantic.next }),
      },
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

const PERSON_PAGE = 100;

async function personPhotos(personId: number, photosAfter: string | null) {
  if (photosAfter !== null) {
    const after = decodeCursor(photosAfter, toPersonPhotoCursor);
    if (!after) return badCursor("photos_after");
    const page = await getPersonPhotos(personId, after, PERSON_PAGE);
    return NextResponse.json({
      success: true,
      photos: page.items,
      next_photos: encodeCursor(page.next),
    });
  }
  const [person, page] = await Promise.all([
    getPerson(personId),
    getPersonPhotos(personId, null, PERSON_PAGE),
  ]);
  if (!person) {
    return NextResponse.json(
      { success: false, error: "No such person" },
      { status: 404 },
    );
  }
  return NextResponse.json({
    success: true,
    person,
    photos: page.items,
    photo_total: person.photo_count,
    next_photos: encodeCursor(page.next),
  });
}

function badCursor(param: string) {
  return NextResponse.json(
    { success: false, error: `${param} must be a cursor from this API` },
    { status: 400 },
  );
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

function toPersonPhotoCursor(value: unknown): PersonPhotoCursor | null {
  if (!isRecord(value)) return null;
  const { taken, id } = value;
  return typeof taken === "string" && typeof id === "string" && /^\d+$/.test(id)
    ? { taken, id }
    : null;
}
