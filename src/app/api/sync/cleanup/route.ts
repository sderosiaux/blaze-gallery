import { NextRequest, NextResponse } from "next/server";
import { createSyncJob } from "@/lib/database";
import { syncService } from "@/lib/sync";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const job = await createSyncJob({
      type: "cleanup",
    });

    if (!syncService.isServiceRunning()) {
      syncService.start();
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: "Cleanup job started",
    });
  } catch (error) {
    logger.apiError("Error in POST /api/sync/cleanup", error as Error, {
      method: "POST",
      path: "/api/sync/cleanup",
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
