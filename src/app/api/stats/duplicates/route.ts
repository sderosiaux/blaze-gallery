import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query, requireRow } from "@/lib/database";
import { logger } from "@/lib/logger";
import type {
  DuplicateFileGroup,
  DuplicateFiles,
} from "@/components/stats/types";

interface DuplicatesRow {
  total_groups: number;
  total_photos: number;
  reclaimable_bytes: number;
  groups: DuplicateFileGroup[];
}

export const dynamic = "force-dynamic";

const GROUP_LIMIT = 50;
const LOCATIONS_PER_GROUP = 6;

// A duplicate is the same filename with the same byte size, outside system and
// thumbnail files. Everything is aggregated in SQL: the library has ~25k such
// groups (~60k rows), and shipping them all to Node used to hit the 60 s query
// timeout. Only the groups that free the most space travel, with a few
// locations each.
export const GET = requireAuth(async function GET() {
  try {
    const result = await query<DuplicatesRow>(
      `
      WITH candidates AS MATERIALIZED (
        SELECT p.id, p.filename, p.size, f.path, f.name
        FROM photos p
        JOIN folders f ON f.id = p.folder_id
        WHERE f.path NOT LIKE '%@eaDir%'
          AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
          AND p.filename NOT IN ('Thumbs.db', '.DS_Store')
          AND p.size > 10240
          -- Already thrown away: no longer a copy to decide on
          AND p.trashed_at IS NULL
      ),
      groups AS MATERIALIZED (
        SELECT filename, size, COUNT(*)::int AS copies
        FROM candidates
        GROUP BY filename, size
        HAVING COUNT(*) > 1
      ),
      top AS MATERIALIZED (
        SELECT filename, size, copies
        FROM groups
        ORDER BY size * (copies - 1) DESC, filename
        LIMIT $1
      ),
      top_photos AS MATERIALIZED (
        SELECT c.id, c.filename, c.size, c.path, c.name,
          ROW_NUMBER() OVER (PARTITION BY c.filename, c.size ORDER BY c.path, c.id) AS rn
        FROM candidates c
        JOIN top t ON t.filename = c.filename AND t.size = c.size
      )
      SELECT
        (SELECT COUNT(*) FROM groups)::int AS total_groups,
        (SELECT COALESCE(SUM(copies), 0) FROM groups)::int AS total_photos,
        (SELECT COALESCE(SUM(size * (copies - 1)), 0) FROM groups)::float8 AS reclaimable_bytes,
        COALESCE((
          SELECT json_agg(json_build_object(
            'filename', t.filename,
            'size', t.size,
            'count', t.copies,
            'photos', (
              SELECT json_agg(json_build_object('id', tp.id, 'folder_path', tp.path, 'folder_name', tp.name) ORDER BY tp.rn)
              FROM top_photos tp
              WHERE tp.filename = t.filename AND tp.size = t.size AND tp.rn <= $2
            )
          ) ORDER BY t.size * (t.copies - 1) DESC, t.filename)
          FROM top t
        ), '[]'::json) AS groups
      `,
      [GROUP_LIMIT, LOCATIONS_PER_GROUP],
    );

    const row = requireRow(result, "Duplicate files");
    const data: DuplicateFiles = {
      summary: {
        total_duplicate_filenames: row.total_groups,
        total_duplicate_photos: row.total_photos,
        potential_space_saved_bytes: row.reclaimable_bytes,
      },
      duplicates: row.groups,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats/duplicates", error as Error, {
      method: "GET",
      path: "/api/stats/duplicates",
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
