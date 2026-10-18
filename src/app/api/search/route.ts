import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { parseColorFilter } from "@/lib/colors";
import type { FolderSearchCursor, PhotoSearchCursor } from "@/lib/database";
import {
  countSearchMatches,
  searchFolders,
  searchPhotos,
} from "@/lib/database";
import { logger } from "@/lib/logger";
import { isRecord } from "@/hooks/apiJson";

export const dynamic = "force-dynamic";

const PHOTO_PAGE = 100;
const FOLDER_PAGE = 20;

/**
 * Folders and photos matching `q`, accent- and case-insensitively.
 * Without a cursor: the first page of each, their totals and the cursors
 * (`next_photos`, `next_folders`; null on the last page). With
 * `photos_after` or `folders_after` set to one of those opaque cursors:
 * only the next page of that list and its following cursor. `color` /
 * `tone` narrow the photos (not the folders) to those holding that color,
 * in that tone; a cursor goes with the same filter.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();
  const photosAfter = searchParams.get("photos_after");
  const foldersAfter = searchParams.get("folders_after");
  const parsedColors = parseColorFilter((key) => searchParams.get(key));
  if (!parsedColors.ok) {
    return NextResponse.json(
      { success: false, error: parsedColors.error },
      { status: 400 },
    );
  }
  const colors = parsedColors.value;

  if (q === "") {
    return NextResponse.json({
      success: true,
      photos: [],
      photo_total: 0,
      next_photos: null,
      folders: [],
      folder_total: 0,
      next_folders: null,
    });
  }

  try {
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

    const [photos, folders, totals] = await Promise.all([
      searchPhotos(q, null, PHOTO_PAGE, colors),
      searchFolders(q, null, FOLDER_PAGE),
      countSearchMatches(q, colors),
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

function badCursor(param: string) {
  return NextResponse.json(
    { success: false, error: `${param} must be a cursor from this API` },
    { status: 400 },
  );
}

function encodeCursor(cursor: object | null): string | null {
  return cursor
    ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
    : null;
}

function decodeCursor<C>(
  value: string,
  read: (parsed: unknown) => C | null,
): C | null {
  try {
    return read(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
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
