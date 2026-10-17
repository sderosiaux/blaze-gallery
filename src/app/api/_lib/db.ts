import type { QueryResult, QueryResultRow } from "pg";
import type { Photo } from "@/types";

/** First row of a query that always yields one (a bare aggregate); throws if the driver returned none. */
export function firstRow<R extends QueryResultRow>(
  result: QueryResult<R>,
  what: string,
): R {
  const row = result.rows[0];
  if (!row) {
    throw new Error(`${what} query returned no row`);
  }
  return row;
}

/** Row of `SELECT p.*, f.name AS folder_name, f.path AS folder_path FROM photos p LEFT JOIN folders f ...` */
export type PhotoWithFolderRow = Omit<
  Photo,
  "thumbnail_url" | "is_favorite"
> & {
  is_favorite: boolean | null;
  folder_name: string | null;
  folder_path: string | null;
};

/** Adds the thumbnail URL and a real boolean for is_favorite; metadata is JSONB, already parsed by pg. */
export function withThumbnailUrl(row: PhotoWithFolderRow) {
  return {
    ...row,
    is_favorite: Boolean(row.is_favorite),
    thumbnail_url: `/api/photos/${row.id}/thumbnail`,
    metadata: row.metadata,
  };
}
