import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { authenticateRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // Authentication check for sensitive config data
  const authResult = authenticateRequest(request, { apiKeyRequired: true });
  if (!authResult.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: authResult.error || "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const config = getConfig();

    const sanitizedConfig = {
      backblaze_endpoint: config.backblaze_endpoint,
      backblaze_bucket: config.backblaze_bucket,
      backblaze_access_key: config.backblaze_access_key ? "***" : "",
      backblaze_secret_key: config.backblaze_secret_key ? "***" : "",
      thumbnail_max_age_days: config.thumbnail_max_age_days,
      sync_interval_hours: config.sync_interval_hours,
    };

    return NextResponse.json({
      success: true,
      config: sanitizedConfig,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/config", error as Error, {
      method: "GET",
      path: "/api/config",
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
