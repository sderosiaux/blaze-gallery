import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import type { HealthStats } from "@/components/stats/types";
import { firstRow } from "@/app/api/_lib/db";

export const dynamic = "force-dynamic";

// Timestamps are stored without a zone, in UTC: format them in SQL so the
// client gets an unambiguous ISO string whatever the server's TZ is.
const ISO = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;

export const GET = requireAuth(async function GET() {
  try {
    const [metadataResult, syncResult] = await Promise.all([
      query<HealthStats["metadata"]>(`
        SELECT
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%')::int AS images,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata ? 'dimensions')::int AS with_dimensions,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata ? 'date_taken')::int AS with_date,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata->'camera'->>'make' IS NOT NULL)::int AS with_camera,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata ? 'location')::int AS with_location,
          COUNT(*) FILTER (
            WHERE mime_type NOT LIKE 'video/%' AND metadata IS NULL AND metadata_status IS DISTINCT FROM 'failed'
          )::int AS pending,
          COUNT(*) FILTER (WHERE mime_type NOT LIKE 'video/%' AND metadata_status = 'failed')::int AS failed,
          COUNT(*) FILTER (WHERE mime_type LIKE 'video/%')::int AS videos
        FROM photos
      `),
      query<HealthStats["sync"]>(`
        SELECT
          COUNT(*)::int AS total_folders,
          COUNT(*) FILTER (WHERE last_synced >= NOW() - INTERVAL '1 day')::int AS synced_last_day,
          COUNT(*) FILTER (WHERE last_synced >= NOW() - INTERVAL '7 days')::int AS synced_last_week,
          COUNT(*) FILTER (WHERE last_synced < NOW() - INTERVAL '7 days')::int AS stale,
          COUNT(*) FILTER (WHERE last_synced IS NULL)::int AS never_synced,
          to_char(MAX(last_synced), ${ISO}) AS last_synced,
          to_char(MIN(last_synced), ${ISO}) AS oldest_synced
        FROM folders
      `),
    ]);

    const data: HealthStats = {
      metadata: firstRow(metadataResult, "Metadata health"),
      sync: firstRow(syncResult, "Sync health"),
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/stats/health", error as Error, {
      method: "GET",
      path: "/api/stats/health",
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
