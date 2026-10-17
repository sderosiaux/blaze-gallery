import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { VideoStats } from "@/components/stats/types";
import { firstRow } from "@/app/api/_lib/db";

export const dynamic = "force-dynamic";

const LIMIT = 25;

export const GET = requireAuth(async function GET() {
  try {
    const [summaryResult, formatsResult, largestResult, albumsResult] =
      await Promise.all([
        query<VideoStats["summary"]>(`
        SELECT
          COUNT(*)::int AS total_videos,
          COALESCE(SUM(size), 0)::float8 AS total_size_bytes,
          COALESCE(AVG(size), 0)::float8 AS avg_size_bytes,
          COALESCE(MAX(size), 0)::float8 AS max_size_bytes,
          COUNT(DISTINCT folder_id)::int AS albums_with_videos
        FROM photos
        WHERE mime_type LIKE 'video/%'
      `),
        query<VideoStats["formats"][number]>(`
        SELECT
          CASE WHEN strpos(filename, '.') > 0 THEN LOWER(split_part(filename, '.', -1)) ELSE 'none' END AS format,
          COUNT(*)::int AS count,
          COALESCE(SUM(size), 0)::float8 AS total_size_bytes
        FROM photos
        WHERE mime_type LIKE 'video/%'
        GROUP BY 1
        ORDER BY count DESC
      `),
        query<VideoStats["largest"][number]>(
          `
        SELECT
          p.id::int AS id,
          p.filename,
          p.size::float8 AS size,
          CASE WHEN strpos(p.filename, '.') > 0 THEN LOWER(split_part(p.filename, '.', -1)) ELSE 'none' END AS format,
          f.path AS folder_path,
          f.name AS folder_name
        FROM photos p
        JOIN folders f ON f.id = p.folder_id
        WHERE p.mime_type LIKE 'video/%'
        ORDER BY p.size DESC
        LIMIT $1
        `,
          [LIMIT],
        ),
        query<VideoStats["albums"][number]>(
          `
        SELECT
          f.id::int AS id,
          f.name,
          f.path,
          v.video_count,
          v.total_size_bytes
        FROM (
          SELECT folder_id, COUNT(*)::int AS video_count, COALESCE(SUM(size), 0)::float8 AS total_size_bytes
          FROM photos
          WHERE mime_type LIKE 'video/%'
          GROUP BY folder_id
          ORDER BY video_count DESC, total_size_bytes DESC
          LIMIT $1
        ) v
        JOIN folders f ON f.id = v.folder_id
        ORDER BY v.video_count DESC, v.total_size_bytes DESC
        `,
          [LIMIT],
        ),
      ]);

    const data: VideoStats = {
      summary: firstRow(summaryResult, "Video summary"),
      formats: formatsResult.rows,
      largest: largestResult.rows,
      albums: albumsResult.rows,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats/videos", error as Error, {
      method: "GET",
      path: "/api/stats/videos",
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
