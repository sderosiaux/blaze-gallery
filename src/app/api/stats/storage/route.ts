import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type {
  AlbumStat,
  FileTypeStat,
  StorageStats,
} from "@/components/stats/types";

export const dynamic = "force-dynamic";

const LIMIT = 50;

// Albums ranked by size and by count come from the same per-folder aggregate,
// computed once; folders.photo_count is not trusted here because it lags the
// photos table between syncs.
export const GET = requireAuth(async function GET() {
  try {
    const [albumsResult, typesResult] = await Promise.all([
      query<AlbumStat & { rank_by: string }>(
        `
        WITH per_folder AS MATERIALIZED (
          SELECT
            folder_id,
            COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%')::int AS photo_count,
            COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')::int AS video_count,
            COALESCE(SUM(size), 0)::float8 AS total_size
          FROM photos
          GROUP BY folder_id
        ),
        by_size AS (
          SELECT 'size' AS rank_by, * FROM per_folder ORDER BY total_size DESC LIMIT $1
        ),
        by_count AS (
          SELECT 'count' AS rank_by, * FROM per_folder ORDER BY photo_count + video_count DESC, total_size DESC LIMIT $1
        )
        SELECT r.rank_by, f.id::int AS id, f.name, f.path, r.photo_count, r.video_count, r.total_size
        FROM (SELECT * FROM by_size UNION ALL SELECT * FROM by_count) r
        JOIN folders f ON f.id = r.folder_id
        `,
        [LIMIT],
      ),
      query<FileTypeStat>(`
        SELECT
          CASE WHEN strpos(filename, '.') > 0 THEN LOWER(split_part(filename, '.', -1)) ELSE 'none' END AS extension,
          CASE WHEN mime_type LIKE 'video/%' THEN 'video' ELSE 'photo' END AS kind,
          COUNT(*)::int AS count,
          COALESCE(SUM(size), 0)::float8 AS total_size_bytes
        FROM photos
        GROUP BY 1, 2
        ORDER BY total_size_bytes DESC
      `),
    ]);

    const rows = albumsResult.rows;
    const pick = (rankBy: string): AlbumStat[] =>
      rows
        .filter((r) => r.rank_by === rankBy)
        .map((r) => ({
          id: r.id,
          name: r.name,
          path: r.path,
          photo_count: r.photo_count,
          video_count: r.video_count,
          total_size: r.total_size,
        }));

    const bySize = pick("size").sort((a, b) => b.total_size - a.total_size);
    const byCount = pick("count").sort(
      (a, b) =>
        b.photo_count + b.video_count - (a.photo_count + a.video_count) ||
        b.total_size - a.total_size,
    );

    const data: StorageStats = {
      largest_by_size: bySize,
      largest_by_count: byCount,
      file_types: typesResult.rows,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats/storage", error as Error, {
      method: "GET",
      path: "/api/stats/storage",
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
