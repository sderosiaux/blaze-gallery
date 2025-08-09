import { NextRequest, NextResponse } from "next/server";
import { thumbnailService, getThumbnailsPath, getDatabasePath } from "@/lib/thumbnails";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const fs = require("fs");

    const dbPath = getDatabasePath();
    const thumbnailsPath = getThumbnailsPath();

    const checks = {
      database: false,
      thumbnails_directory: false,
      timestamp: new Date().toISOString(),
    };

    try {
      checks.database = fs.existsSync(dbPath);
    } catch (error) {
      logger.error("Database health check failed", error as Error);
    }

    try {
      checks.thumbnails_directory = fs.existsSync(thumbnailsPath);
    } catch (error) {
      logger.error("Thumbnails directory health check failed", error as Error);
    }

    const thumbnailStats = thumbnailService.getThumbnailStats();

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
