/**
 * The stacks of near-duplicates as the Doublons page reviews them: each
 * with every photo of it the gallery shows, best first, the first one
 * proposed as the photo to keep (photo_groups.rank).
 */
import type { Photo } from "@/types";
import { inGallery, query, requireRow } from "./database";
import { thumbnailUrl } from "./photoUrls";

/**
 * copies: every photo of the stack is the same file, the same MD5 in
 * photos.etag for each (not a multipart upload's, not one unread); bursts:
 * the others.
 */
export type StackKind = "all" | "copies" | "bursts";

export const STACK_KINDS: readonly StackKind[] = ["all", "copies", "bursts"];

export type StackPhoto = Photo & {
  folder_path: string;
  /** Its place among the photos of the stack the gallery shows, from 1 */
  rank: number;
  link: "centre" | "copy" | "burst" | "same" | "raw" | "bracket";
};

export interface StackEntry {
  id: number;
  /** Best first: the first is the one proposed to keep */
  photos: StackPhoto[];
  copies: boolean;
}

export interface StackCursor {
  taken: string;
  id: number;
}

/** Per stack the gallery shows two photos of or more: its size, its kind, its newest date. */
const STACKS = `
  visible AS MATERIALIZED (
    SELECT g.group_id, g.copy_of, p.etag, p.metadata ->> 'date_taken' AS taken
    FROM photo_groups g JOIN photos p ON p.id = g.photo_id
    WHERE ${inGallery()}
  ),
  stacks AS MATERIALIZED (
    SELECT group_id, count(*)::int AS photos,
           bool_and(copy_of IS NOT NULL) AND count(DISTINCT copy_of) = 1
             AND bool_and(coalesce(etag ~ '^[0-9a-f]{32}$', false))
             AND count(DISTINCT etag) = 1 AS copies,
           coalesce(max(taken), '') AS taken
    FROM visible GROUP BY group_id HAVING count(*) >= 2
  )`;

const KIND_WHERE: Record<StackKind, string> = {
  all: "true",
  copies: "s.copies",
  bursts: "NOT s.copies",
};

/**
 * A page of stacks of `kind`, newest first (by their newest photo),
 * keyset-paginated on (that date, group id), and for all of that kind how
 * many stacks there are and how many photos keeping one of each would
 * throw away.
 */
export async function listStacks(
  kind: StackKind,
  after: StackCursor | null,
  limit: number,
): Promise<{
  stacks: StackEntry[];
  next: StackCursor | null;
  total: { stacks: number; extra: number };
}> {
  const params: unknown[] = [limit + 1];
  const seek = after
    ? (params.push(after.taken, after.id),
      "AND (s.taken, s.group_id) < ($2::text, $3::bigint)")
    : "";
  const page = await query<{
    group_id: number;
    taken: string;
    copies: boolean;
  }>(
    `WITH ${STACKS}
     SELECT s.group_id::int AS group_id, s.taken, s.copies FROM stacks s
     WHERE ${KIND_WHERE[kind]} ${seek}
     ORDER BY s.taken DESC, s.group_id DESC
     LIMIT $1`,
    params,
  );
  const [members, totals] = await Promise.all([
    query<StackPhoto & { group_id: number; is_favorite: boolean | null }>(
      `SELECT p.*, f.path AS folder_path, g.group_id::int AS group_id, g.link,
              row_number() OVER (PARTITION BY g.group_id ORDER BY g.rank)::int AS rank
       FROM photo_groups g
       JOIN photos p ON p.id = g.photo_id
       JOIN folders f ON f.id = p.folder_id
       WHERE g.group_id = ANY($1::bigint[]) AND ${inGallery()}
       ORDER BY g.group_id, rank`,
      [page.rows.slice(0, limit).map((row) => row.group_id)],
    ),
    query<{ stacks: number; extra: number }>(
      `WITH ${STACKS}
       SELECT count(*)::int AS stacks, coalesce(sum(s.photos - 1), 0)::int AS extra
       FROM stacks s WHERE ${KIND_WHERE[kind]}`,
    ),
  ]);
  const byStack = new Map<number, StackPhoto[]>();
  for (const { group_id, ...photo } of members.rows) {
    const list = byStack.get(group_id) ?? [];
    list.push({
      ...photo,
      id: Number(photo.id),
      is_favorite: Boolean(photo.is_favorite),
      thumbnail_url: thumbnailUrl(photo.id),
    });
    byStack.set(group_id, list);
  }
  const stacks = page.rows.slice(0, limit).flatMap((row) => {
    const photos = byStack.get(row.group_id) ?? [];
    return photos.length >= 2
      ? [{ id: row.group_id, photos, copies: row.copies }]
      : [];
  });
  const last = page.rows[Math.min(limit, page.rows.length) - 1];
  return {
    stacks,
    next:
      page.rows.length > limit && last
        ? { taken: last.taken, id: last.group_id }
        : null,
    total: requireRow(totals),
  };
}
