import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { StatsSummary } from "@/components/stats/types";

// Force dynamic rendering for routes using auth
export const dynamic = "force-dynamic";

// The first screen of /stats. One pass over photos and one over folders, run in
// parallel, so the headline numbers arrive in a few hundred milliseconds. The
// per-tab detail lives in the sibling routes and is fetched only when opened.
export const GET = requireAuth(async function GET() {
  try {
    const [photosResult, foldersResult] = await Promise.all([
      query(`
        SELECT
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%')::int AS photos,
          COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')::int AS videos,
          COALESCE(SUM(size), 0)::float8 AS storage_bytes,
          COALESCE(SUM(size) FILTER (WHERE mime_type LIKE 'video/%'), 0)::float8 AS video_bytes,
          COUNT(DISTINCT folder_id)::int AS albums,
          COUNT(*) FILTER (WHERE is_favorite)::int AS favorites,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata ? 'dimensions')::int AS with_dimensions,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata ? 'date_taken')::int AS with_date,
          COUNT(*) FILTER (
            WHERE mime_type NOT LIKE 'video/%' AND metadata IS NULL AND metadata_status IS DISTINCT FROM 'failed'
          )::int AS pending
        FROM photos
      `),
      query(`
        SELECT
          COUNT(*)::int AS folders,
          COUNT(*) FILTER (WHERE last_synced IS NULL OR last_synced < NOW() - INTERVAL '7 days')::int AS stale_folders,
          to_char(MAX(last_synced), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_synced
        FROM folders
      `),
    ]);

    const p = photosResult.rows[0];
    const f = foldersResult.rows[0];

    const data: StatsSummary = {
      photos: p.photos,
      videos: p.videos,
      storage_bytes: p.storage_bytes,
      video_bytes: p.video_bytes,
      albums: p.albums,
      folders: f.folders,
      favorites: p.favorites,
      metadata: {
        images: p.photos,
        with_dimensions: p.with_dimensions,
        with_date: p.with_date,
        pending: p.pending,
      },
      sync: {
        stale_folders: f.stale_folders,
        last_synced: f.last_synced,
      },
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats", error as Error, {
      method: "GET",
      path: "/api/stats",
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
