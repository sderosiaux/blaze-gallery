import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { thumbnailService, getThumbnailStorageInfo } from "@/lib/thumbnails";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import { listObjects } from "@/lib/s3";

export async function GET() {
  try {
    const storageInfo = getThumbnailStorageInfo();

    const checks = {
      database: false,
      thumbnails_directory: false,
      timestamp: new Date().toISOString(),
    };

    // Test PostgreSQL connection
    try {
      await query("SELECT 1 as test");
      checks.database = true;
    } catch (error) {
      logger.error(
        "Database connection health check failed",
        undefined,
        error instanceof Error ? error : undefined,
      );
    }

    try {
      if (storageInfo.mode === "s3") {
        if (storageInfo.bucket === undefined) {
          throw new Error("Thumbnail bucket is not configured");
        }
        await listObjects({
          bucket: storageInfo.bucket,
          prefix: storageInfo.prefix ? `${storageInfo.prefix}/` : undefined,
          maxKeys: 1,
        });
        checks.thumbnails_directory = true;
      } else {
        checks.thumbnails_directory = existsSync(storageInfo.location);
      }
    } catch (error) {
      logger.error(
        "Thumbnails directory health check failed",
        undefined,
        error instanceof Error ? error : undefined,
      );
    }

    const thumbnailStats = await thumbnailService.getThumbnailStats();

    const isHealthy = checks.database && checks.thumbnails_directory;

    return NextResponse.json(
      {
        success: true,
        healthy: isHealthy,
        checks,
        stats: {
          thumbnails: thumbnailStats,
        },
      },
      {
        status: isHealthy ? 200 : 503,
      },
    );
  } catch (error) {
    logger.apiError("Error in GET /api/health", error as Error, {
      method: "GET",
      path: "/api/health",
    });
    return NextResponse.json(
      {
        success: false,
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
