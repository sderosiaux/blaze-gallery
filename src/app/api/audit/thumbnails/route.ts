import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import { getThumbnailStorageInfo } from "@/lib/thumbnails";
import { listObjects } from "@/lib/s3";
import * as fs from "fs";
import * as path from "path";

interface ThumbnailStats {
  thumbnail_generation: {
    total_photos: number;
    thumbnails_generated: number;
    thumbnails_pending: number;
    generation_rate: number;
    avg_thumbnail_size_bytes: number;
    total_thumbnail_storage_bytes: number;
  };
  cache_performance?: {
    cache_hits: number;
    cache_misses: number;
    hit_rate: number;
  };
  thumbnail_storage: {
    thumbnail_directory_size_bytes: number;
    thumbnail_files_count: number;
    oldest_thumbnail?: string;
    newest_thumbnail?: string;
  };
  debug_info: {
    thumbnail_directory_path: string;
    directory_exists: boolean;
    file_vs_db_discrepancy: number;
    orphaned_files: string[];
    missing_files: string[];
  };
}

async function getThumbnailDirectoryStats(thumbnailDir: string) {
  try {
    const stats = {
      total_size: 0,
      file_count: 0,
      oldest: null as Date | null,
      newest: null as Date | null,
    };

    if (!fs.existsSync(thumbnailDir)) {
      return { total_size: 0, file_count: 0, oldest: null, newest: null };
    }

    const files = fs.readdirSync(thumbnailDir);

    for (const file of files) {
      const filePath = path.join(thumbnailDir, file);
      try {
        const fileStat = fs.statSync(filePath);
        if (fileStat.isFile()) {
          stats.total_size += fileStat.size;
          stats.file_count++;

          if (!stats.oldest || fileStat.mtime < stats.oldest) {
            stats.oldest = fileStat.mtime;
          }
          if (!stats.newest || fileStat.mtime > stats.newest) {
            stats.newest = fileStat.mtime;
          }
        }
      } catch (err) {
        // Skip files we can't stat
        continue;
      }
    }

    return stats;
  } catch (error) {
    console.error("Error reading thumbnail directory:", error);
    return { total_size: 0, file_count: 0, oldest: null, newest: null };
  }
}

async function getThumbnailS3Stats(bucket: string, prefix?: string) {
  const stats = {
    total_size: 0,
    file_count: 0,
    oldest: null as Date | null,
    newest: null as Date | null,
  };
  const keys: string[] = [];

  let continuationToken: string | undefined;
  let pageNumber = 1;

  do {
    const { objects, nextContinuationToken, isTruncated } = await listObjects({
      bucket,
      prefix: prefix || undefined,
      continuationToken,
      maxKeys: 1000,
      pageNumber,
    });

    for (const obj of objects) {
      stats.total_size += obj.size;
      stats.file_count += 1;
      keys.push(obj.key);

      if (!stats.oldest || obj.lastModified < stats.oldest) {
        stats.oldest = obj.lastModified;
      }

      if (!stats.newest || obj.lastModified > stats.newest) {
        stats.newest = obj.lastModified;
      }
    }

    continuationToken = nextContinuationToken;
    pageNumber += 1;

    if (!isTruncated) {
      break;
    }
  } while (continuationToken);

  return { stats, keys };
}

export async function GET(request: NextRequest) {
  try {
    // Get basic thumbnail statistics from database
    const thumbnailStatsResult = await query(`
      SELECT
        COUNT(*) as total_photos,
        SUM(CASE WHEN thumbnail_path IS NOT NULL AND thumbnail_path != '' THEN 1 ELSE 0 END) as thumbnails_generated,
        SUM(CASE WHEN thumbnail_path IS NULL OR thumbnail_path = '' THEN 1 ELSE 0 END) as thumbnails_pending
      FROM photos
    `);

    const thumbnailStats = thumbnailStatsResult.rows[0] as {
      total_photos: number;
      thumbnails_generated: number;
      thumbnails_pending: number;
    };

    // Calculate generation rate
    const generation_rate =
      thumbnailStats.total_photos > 0
        ? (thumbnailStats.thumbnails_generated / thumbnailStats.total_photos) *
          100
        : 0;

    // Get thumbnail directory stats using unified path function
    const storageInfo = getThumbnailStorageInfo();
    let dirStats: {
      total_size: number;
      file_count: number;
      oldest: Date | null;
      newest: Date | null;
    };
    let storageFiles: string[] = [];
    let directoryExists = false;

    if (storageInfo.mode === "s3") {
      const { stats, keys } = await getThumbnailS3Stats(
        storageInfo.bucket!,
        storageInfo.prefix ? `${storageInfo.prefix}/` : undefined,
      );
      dirStats = stats;
      storageFiles = keys;
      directoryExists = true;
    } else {
      dirStats = await getThumbnailDirectoryStats(storageInfo.location);
      directoryExists = fs.existsSync(storageInfo.location);
      storageFiles = directoryExists
        ? fs
            .readdirSync(storageInfo.location)
            .filter((f) =>
              fs.statSync(path.join(storageInfo.location, f)).isFile(),
            )
        : [];
    }

    // Calculate average thumbnail size from actual files only
    const avgThumbnailSize =
      dirStats.file_count > 0
        ? Math.round(dirStats.total_size / dirStats.file_count)
        : 0;

    // Identify discrepancies between files and database records
    // Get all photos with thumbnail_path set
    const photosWithThumbnailsResult = await query(`
      SELECT id, thumbnail_path FROM photos
      WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''
    `);
    const photosWithThumbnails = photosWithThumbnailsResult.rows as {
      id: number;
      thumbnail_path: string;
    }[];

    const dbThumbnailFiles =
      storageInfo.mode === "s3"
        ? photosWithThumbnails.map((p) => p.thumbnail_path)
        : photosWithThumbnails.map((p) => path.basename(p.thumbnail_path));

    // Find files on disk that aren't in database
    const orphanedFiles = storageFiles.filter(
      (file) =>
        !dbThumbnailFiles.includes(
          storageInfo.mode === "s3" ? file : path.basename(file),
        ),
    );

    // Find database records pointing to files that don't exist
    const missingFiles = photosWithThumbnails
      .filter((p) => {
        if (storageInfo.mode === "s3") {
          return !storageFiles.includes(p.thumbnail_path);
        }
        return !storageFiles.includes(path.basename(p.thumbnail_path));
      })
      .map((p) =>
        storageInfo.mode === "s3"
          ? p.thumbnail_path
          : path.basename(p.thumbnail_path),
      );

    // Try to get cache performance from audit logs if available
    let cachePerformance = null;
    try {
      const cacheStatsResult = await query(`
        SELECT
          COUNT(*) as total_requests,
          SUM(CASE WHEN endpoint LIKE '%thumbnail%' AND status_code = 304 THEN 1 ELSE 0 END) as cache_hits,
          SUM(CASE WHEN endpoint LIKE '%thumbnail%' AND status_code = 200 THEN 1 ELSE 0 END) as cache_misses
        FROM s3_audit_logs
        WHERE endpoint LIKE '%thumbnail%'
        AND timestamp >= NOW() - INTERVAL '24 hours'
      `);

      const cacheStats = cacheStatsResult.rows[0] as {
        total_requests: number;
        cache_hits: number;
        cache_misses: number;
      };

      if (cacheStats.total_requests > 0) {
        cachePerformance = {
          cache_hits: cacheStats.cache_hits,
          cache_misses: cacheStats.cache_misses,
          hit_rate: (cacheStats.cache_hits / cacheStats.total_requests) * 100,
        };
      }
    } catch (error) {
      // S3 audit table might not exist or no recent thumbnail requests
      console.log("S3 audit data not available for cache performance:", error);
    }

    const result: ThumbnailStats = {
      thumbnail_generation: {
        total_photos: thumbnailStats.total_photos,
        thumbnails_generated: thumbnailStats.thumbnails_generated,
        thumbnails_pending: thumbnailStats.thumbnails_pending,
        generation_rate: generation_rate,
        avg_thumbnail_size_bytes: avgThumbnailSize,
        total_thumbnail_storage_bytes: dirStats.total_size,
      },
      thumbnail_storage: {
        thumbnail_directory_size_bytes: dirStats.total_size,
        thumbnail_files_count: dirStats.file_count,
        oldest_thumbnail: dirStats.oldest?.toISOString(),
        newest_thumbnail: dirStats.newest?.toISOString(),
      },
      debug_info: {
        thumbnail_directory_path: storageInfo.location,
        directory_exists: directoryExists,
        file_vs_db_discrepancy:
          dirStats.file_count - thumbnailStats.thumbnails_generated,
        orphaned_files: orphanedFiles.slice(0, 10), // Limit to first 10 for UI
        missing_files: missingFiles.slice(0, 10), // Limit to first 10 for UI
      },
    };

    if (cachePerformance) {
      result.cache_performance = cachePerformance;
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/audit/thumbnails", error as Error, {
      method: "GET",
      path: "/api/audit/thumbnails",
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
