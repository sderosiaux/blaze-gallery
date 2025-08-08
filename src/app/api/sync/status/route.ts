import { NextRequest, NextResponse } from "next/server";
import { getActiveSyncJobs } from "@/lib/database";
import { syncService } from "@/lib/sync";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const activeJobs = await getActiveSyncJobs();
    const currentJob = syncService.getCurrentJob();
    const isRunning = syncService.isServiceRunning();

    return NextResponse.json({
      success: true,
      isRunning,
      currentJob,
      activeJobs,
      queueLength: activeJobs.filter((job) => job.status === "pending").length,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/sync/status", error as Error, {
      method: "GET",
      path: "/api/sync/status",
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
