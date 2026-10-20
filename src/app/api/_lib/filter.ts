import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CONTENT_LIMIT, type PhotoFilter } from "@/lib/database";
import {
  resolveFilter,
  withContent,
  type ContentStatus,
  type FilterScope,
  type ResolvedFilter,
} from "@/lib/filterResolver";
import { parseUrlFilter } from "@/lib/photoFilter";

export type ListFilter =
  | {
      ok: true;
      filter: PhotoFilter;
      resolved: ResolvedFilter;
      /** What became of the content, null without one (withContent) */
      content: ContentStatus | null;
      /** False when the content's photos were too many to keep them all */
      complete: boolean;
    }
  | { ok: false; response: NextResponse };

/**
 * The filter of a list request (lib/photoFilter.ts parameters), resolved
 * and with its content measured, plus what the view adds (`scope`). A
 * value that does not read answers 400.
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
  const { filter, content, complete } = await withContent(resolved.value);
  return { ok: true, filter, resolved: resolved.value, content, complete };
}

/**
 * What a list answers about its filter: whether the content applied, the
 * tags read as words instead, with tags how much of the gallery the
 * tagger has read (`tagged_share`, 0..1), and `content_limited` when only
 * the nearest of the content's photos are kept (CONTENT_LIMIT, how many).
 */
export function filterNotes(list: Extract<ListFilter, { ok: true }>) {
  return {
    content: list.content,
    ...(list.complete ? {} : { content_limited: CONTENT_LIMIT }),
    untagged: list.resolved.untagged,
    ...(list.resolved.taggedShare === null
      ? {}
      : { tagged_share: list.resolved.taggedShare }),
  };
}

function badFilter(error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status: 400 });
}
