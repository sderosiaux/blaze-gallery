import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { IgnoredFiles } from "@/components/stats/types";

export const dynamic = "force-dynamic";

// Files left out of duplicate detection. One pass, and each file lands in one
// category only (first match wins), so the total is not double counted.
const CATEGORIES: Record<string, string> = {
  synology_thumbnails: "Synology thumbnails",
  system_files: "System and hidden files",
  eadir_folders: "Files in @eaDir folders",
  small_files: "Files under 10 KB",
};

export const GET = requireAuth(async function GET() {
  try {
    const result = await query(`
      WITH classified AS (
        SELECT
          p.filename,
          p.size,
          f.path,
          CASE
            WHEN p.filename LIKE 'SYNOPHOTO_THUMB_%' THEN 'synology_thumbnails'
            WHEN p.filename IN ('Thumbs.db', '.DS_Store', 'desktop.ini') OR p.filename LIKE '.%' THEN 'system_files'
            WHEN f.path LIKE '%@eaDir%' THEN 'eadir_folders'
            WHEN p.size <= 10240 THEN 'small_files'
          END AS category
        FROM photos p
        JOIN folders f ON f.id = p.folder_id
      )
      SELECT
        category,
        COUNT(*)::int AS count,
        COALESCE(SUM(size), 0)::float8 AS total_size_bytes,
        (ARRAY_AGG(DISTINCT CASE WHEN category = 'eadir_folders' THEN path ELSE filename END))[1:3] AS examples
      FROM classified
      WHERE category IS NOT NULL
      GROUP BY category
    `);

    const rows = result.rows as Array<{ category: string; count: number; total_size_bytes: number; examples: string[] }>;
    const breakdown = Object.keys(CATEGORIES)
      .map((category) => {
        const row = rows.find((r) => r.category === category);
        return {
          category,
          label: CATEGORIES[category],
          count: row?.count ?? 0,
          total_size_bytes: row?.total_size_bytes ?? 0,
          examples: row?.examples ?? [],
        };
      })
      .filter((c) => c.count > 0);

    const data: IgnoredFiles = {
      summary: {
        total_ignored_files: breakdown.reduce((sum, c) => sum + c.count, 0),
        total_ignored_size_bytes: breakdown.reduce((sum, c) => sum + c.total_size_bytes, 0),
      },
      breakdown,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats/ignored-files", error as Error, {
      method: "GET",
      path: "/api/stats/ignored-files",
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
