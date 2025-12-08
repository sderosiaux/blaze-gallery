import { NextResponse } from "next/server";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";

interface DuplicateGroup {
  filename: string;
  count: number;
  photos: {
    id: number;
    s3_key: string;
    size: number;
    folder_path: string;
    created_at: string;
  }[];
}

export async function GET() {
  try {
    // Find photos with duplicate filename+size combinations, excluding system/thumbnail files
    const result = await query(`
      WITH filtered_photos AS (
        SELECT
          p.id,
          p.filename,
          p.s3_key,
          p.size,
          p.created_at,
          f.path as folder_path
        FROM photos p
        JOIN folders f ON p.folder_id = f.id
        WHERE f.path NOT LIKE '%/@eaDir/%'
          AND f.path NOT LIKE '%@eaDir%'
          AND p.filename NOT LIKE 'SYNOPHOTO_THUMB_%'
          AND p.filename NOT LIKE 'Thumbs.db'
          AND p.filename NOT LIKE '.DS_Store'
          AND p.size > 10240
      ), duplicate_keys AS (
        SELECT filename, size
        FROM filtered_photos
        GROUP BY filename, size
        HAVING COUNT(*) > 1
      )
      SELECT
        fp.id,
        fp.filename,
        fp.s3_key,
        fp.size,
        fp.created_at,
        fp.folder_path
      FROM filtered_photos fp
      JOIN duplicate_keys dk
        ON fp.filename = dk.filename AND fp.size = dk.size
      ORDER BY fp.filename, fp.size, fp.created_at
    `);

    const duplicatePhotos = result.rows as {
      id: number;
      filename: string;
      s3_key: string;
      size: number;
      created_at: string;
      folder_path: string;
    }[];

    // Group duplicates by filename and size
    const duplicateGroups: Record<string, DuplicateGroup> = {};

    for (const photo of duplicatePhotos) {
      const groupKey = `${photo.filename}|${photo.size}`;

      if (!duplicateGroups[groupKey]) {
        duplicateGroups[groupKey] = {
          filename: photo.filename,
          count: 0,
          photos: [],
        };
      }

      duplicateGroups[groupKey].photos.push({
        id: photo.id,
        s3_key: photo.s3_key,
        size: photo.size,
        folder_path: photo.folder_path,
        created_at: photo.created_at,
      });
      duplicateGroups[groupKey].count++;
    }

    // Convert to array and sort by count (most duplicates first)
    const sortedGroups = Object.values(duplicateGroups).sort(
      (a, b) => b.count - a.count,
    );

    // Calculate summary stats
    const totalDuplicateFiles = sortedGroups.length;
    const totalDuplicatePhotos = duplicatePhotos.length;
    const potentialSpaceSaved = sortedGroups.reduce((total, group) => {
      if (group.photos.length <= 1) return total;

      // Calculate space that could be saved by keeping only one copy of each duplicate
      // We keep the first one and sum the sizes of all other duplicates
      const totalGroupSize = group.photos.reduce((sum, photo) => {
        const size = Number(photo.size) || 0;
        return sum + size;
      }, 0);
      const keepOneSize = Number(group.photos[0]?.size) || 0;
      const spaceSaved = totalGroupSize - keepOneSize;

      return total + spaceSaved;
    }, 0);

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_duplicate_filenames: totalDuplicateFiles,
          total_duplicate_photos: totalDuplicatePhotos,
          potential_space_saved_bytes: potentialSpaceSaved,
        },
        duplicates: sortedGroups,
      },
    });
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
}
