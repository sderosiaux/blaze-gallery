import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CONTENT_LIMIT, type PhotoFilter } from "@/lib/database";
import {
  resolveFilter,
  withContent,
  withLike,
  type ContentStatus,
  type FilterScope,
  type LikeStatus,
  type ResolvedFilter,
} from "@/lib/filterResolver";
import { parseUrlFilter } from "@/lib/photoFilter";
import { SIMILAR_LIMIT } from "@/lib/similar";

export type ListFilter =
  | {
      ok: true;
      filter: PhotoFilter;
      resolved: ResolvedFilter;
      /** What became of the content, null without one (withContent) */
      content: ContentStatus | null;
      /** False when the content's photos were too many to keep them all */
      complete: boolean;
      /** What became of « Ressemble à », null without it (withLike) */
      like: LikeStatus | null;
      /** False when the look-alikes were too many to keep them all */
      likeComplete: boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * The filter of a list request (lib/photoFilter.ts parameters), resolved
 * and with its content and its likeness measured, plus what the view adds
 * (`scope`). A value that does not read answers 400.
 */
export async function listFilter(
  request: NextRequest,
  scope: FilterScope = {},
): Promise<ListFilter> {
  const params = request.nextUrl.searchParams;
  const url = parseUrlFilter(
    (key) => params.get(key),
    (key) => params.getAll(key),
  );
  if (!url.ok) return { ok: false, response: badFilter(url.error) };
  const resolved = await resolveFilter(url.value, scope);
  if (!resolved.ok) return { ok: false, response: badFilter(resolved.error) };
  const withWords = await withContent(resolved.value);
  const liked = await withLike(withWords.filter, resolved.value.like);
  return {
    ok: true,
    filter: liked.filter,
    resolved: resolved.value,
    content: withWords.content,
    complete: withWords.complete,
    like: liked.like,
    likeComplete: liked.complete,
  };
}

/**
 * What a list answers about its filter: whether the content applied, the
 * tags read as words instead, with tags how much of the gallery the
 * tagger has read (`tagged_share`, 0..1), `content_limited` when only
 * the nearest of the content's photos are kept (CONTENT_LIMIT, how many),
 * whether « Ressemble à » applied (`like`) and `like_limited` likewise.
 */
export function filterNotes(list: Extract<ListFilter, { ok: true }>) {
  return {
    content: list.content,
    ...(list.complete ? {} : { content_limited: CONTENT_LIMIT }),
    ...(list.like === null ? {} : { like: list.like }),
    ...(list.likeComplete ? {} : { like_limited: SIMILAR_LIMIT }),
    untagged: list.resolved.untagged,
    ...(list.resolved.taggedShare === null
      ? {}
      : { tagged_share: list.resolved.taggedShare }),
  };
}

function badFilter(error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
