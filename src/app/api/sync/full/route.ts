import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createSyncJob } from "@/lib/database";
import { syncService } from "@/lib/sync";
import { testS3Connection } from "@/lib/config";
import { logger } from "@/lib/logger";
import { authenticateRequest } from "@/lib/auth";

export const POST = requireAuth(async function POST(request: NextRequest) {
  // Authentication check for sync operations
  const authResult = authenticateRequest(request, { apiKeyRequired: true });
  if (!authResult.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: authResult.error || "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const connectionTest = await testS3Connection();

    if (!connectionTest.success) {
      return NextResponse.json(
        {
          success: false,
          error: `S3 connection failed: ${connectionTest.error}`,
        },
        { status: 400 },
      );
    }

    const job = await createSyncJob({
      type: "full_scan",
    });

    if (!syncService.isServiceRunning()) {
      syncService.start();
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      message: "Full sync started",
    });
  } catch (error) {
    logger.apiError("Error in POST /api/sync/full", error as Error, {
      method: "POST",
      path: "/api/sync/full",
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
