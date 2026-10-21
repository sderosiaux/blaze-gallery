import type { Photo } from "@/types";
import { thumbnailUrl } from "@/lib/photoUrls";
import { stackOf } from "@/lib/database";

/** Row of `SELECT p.*, f.name AS folder_name, f.path AS folder_path FROM photos p LEFT JOIN folders f ...` */
export type PhotoWithFolderRow = Omit<
  Photo,
  "thumbnail_url" | "is_favorite" | "stack"
> & {
  is_favorite: boolean | null;
  folder_name: string | null;
  folder_path: string | null;
  /** With stackColumns (lib/database.ts) */
  stack_id?: number | null;
  stack_count?: number | null;
};

/** Adds the thumbnail URL and a real boolean for is_favorite; metadata is JSONB, already parsed by pg. */
export function withThumbnailUrl(row: PhotoWithFolderRow) {
  const { stack_id, stack_count, ...photo } = row;
  const stack = stackOf({ stack_id, stack_count });
  return {
    ...photo,
    is_favorite: Boolean(row.is_favorite),
    thumbnail_url: thumbnailUrl(row.id),
    metadata: row.metadata,
    ...(stack ? { stack } : {}),
  };
}
