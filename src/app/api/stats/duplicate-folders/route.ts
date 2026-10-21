import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query, requireRow } from "@/lib/database";
import { logger } from "@/lib/logger";
import type {
  DuplicateFolderGroup,
  DuplicateFolders,
} from "@/components/stats/types";

interface DuplicateFoldersRow {
  total_groups: number;
  total_folders: number;
  reclaimable_bytes: number;
  groups: DuplicateFolderGroup[];
}

export const dynamic = "force-dynamic";

const GROUP_LIMIT = 50;

// Two folders are copies when they hold exactly the same set of filename|size
// pairs. The signature is the md5 of that sorted list: grouping on 32-char
// hashes instead of the full lists (up to megabytes for large albums) is what
// brought this from ~30 s to under a second.
export const GET = requireAuth(async function GET() {
  try {
    const result = await query<DuplicateFoldersRow>(
      `
      WITH signatures AS MATERIALIZED (
        SELECT
          f.id, f.name, f.path,
          COUNT(*)::int AS file_count,
          SUM(p.size)::float8 AS total_size,
          md5(STRING_AGG(p.filename || '|' || p.size, '::' ORDER BY p.filename, p.size)) AS signature
        FROM folders f
        JOIN photos p ON p.folder_id = f.id
        WHERE f.path NOT LIKE '%@eaDir%'
          AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
          AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
          AND p.size > 10240
          AND p.trashed_at IS NULL
        GROUP BY f.id, f.name, f.path
      ),
      groups AS MATERIALIZED (
        SELECT signature, COUNT(*)::int AS copies, MIN(file_count) AS file_count, MIN(total_size) AS total_size
        FROM signatures
        GROUP BY signature
        HAVING COUNT(*) > 1
      ),
      top AS MATERIALIZED (
        SELECT * FROM groups ORDER BY total_size * (copies - 1) DESC, signature LIMIT $1
      ),
      members AS MATERIALIZED (
        SELECT s.signature, s.id, s.name, s.path, s.file_count, s.total_size
        FROM signatures s
        JOIN top t ON t.signature = s.signature
      )
      SELECT
        (SELECT COUNT(*) FROM groups)::int AS total_groups,
        (SELECT COALESCE(SUM(copies), 0) FROM groups)::int AS total_folders,
        (SELECT COALESCE(SUM(total_size * (copies - 1)), 0) FROM groups)::float8 AS reclaimable_bytes,
        COALESCE((
          SELECT json_agg(json_build_object(
            'folder_signature', t.signature,
            'count', t.copies,
            'file_count', t.file_count,
            'total_size_bytes', t.total_size,
            'folders', (
              SELECT json_agg(json_build_object(
                'id', m.id, 'path', m.path, 'name', m.name,
                'photo_count', m.file_count, 'total_size_bytes', m.total_size
              ) ORDER BY m.path)
              FROM members m
              WHERE m.signature = t.signature
            )
          ) ORDER BY t.total_size * (t.copies - 1) DESC, t.signature)
          FROM top t
        ), '[]'::json) AS groups
      `,
      [GROUP_LIMIT],
    );

    const row = requireRow(result, "Duplicate folders");
    const data: DuplicateFolders = {
      summary: {
        total_duplicate_folder_groups: row.total_groups,
        total_duplicate_folders: row.total_folders,
        potential_space_saved_bytes: row.reclaimable_bytes,
      },
      duplicates: row.groups,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError(
      "Error in GET /api/stats/duplicate-folders",
      error as Error,
      {
        method: "GET",
        path: "/api/stats/duplicate-folders",
      },
    );
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
