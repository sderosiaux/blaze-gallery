import { NextRequest, NextResponse } from "next/server";
import { thumbnailService, getThumbnailStorageInfo } from "@/lib/thumbnails";
import { query } from "@/lib/database";
import { logger } from "@/lib/logger";
import { listObjects } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    const fs = require("fs");
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
      logger.error("Database connection health check failed", error as Error);
    }

    try {
      if (storageInfo.mode === "s3") {
        await listObjects(
          storageInfo.bucket!,
          storageInfo.prefix ? `${storageInfo.prefix}/` : undefined,
          undefined,
          1,
          1,
        );
        checks.thumbnails_directory = true;
      } else {
        checks.thumbnails_directory = fs.existsSync(storageInfo.location);
      }
    } catch (error) {
      logger.error("Thumbnails directory health check failed", error as Error);
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
