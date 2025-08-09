import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  updateConfig,
  validateConfig,
  testS3Connection,
} from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  validateInput,
  ValidationPatterns,
  CommonValidators,
} from "@/lib/validation";
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
    const config = await getConfig();

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

export async function POST(request: NextRequest) {
  // Authentication check for config updates
  const authResult = authenticateRequest(request, { apiKeyRequired: true });
  if (!authResult.isAuthenticated) {
    return NextResponse.json(
      { success: false, error: authResult.error || "Authentication required" },
      { status: 401 },
    );
  }

  try {
    let body: any;

    // Parse JSON with error handling
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON in request body" },
        { status: 400 },
      );
    }

    const { config: configUpdates, testConnection = false } = body;

    if (!configUpdates || typeof configUpdates !== "object") {
      return NextResponse.json(
        { success: false, error: "Invalid config data - must be an object" },
        { status: 400 },
      );
    }

    // Validate testConnection parameter
    if (testConnection !== undefined && typeof testConnection !== "boolean") {
      return NextResponse.json(
        { success: false, error: "testConnection must be a boolean" },
        { status: 400 },
      );
    }

    // Input validation for config updates
    const validation = validateInput(configUpdates, [
      {
        field: "backblaze_endpoint",
        type: "string",
        maxLength: 255,
        customValidator: CommonValidators.validUrl,
      },
      {
        field: "backblaze_bucket",
        type: "string",
        maxLength: 63,
        minLength: 3,
        pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      },
      {
        field: "backblaze_access_key",
        type: "string",
        maxLength: 255,
        minLength: 10,
      },
      {
        field: "backblaze_secret_key",
        type: "string",
        maxLength: 255,
        minLength: 10,
      },
      {
        field: "thumbnail_max_age_days",
        type: "number",
        min: 1,
        max: 365,
      },
      {
        field: "sync_interval_hours",
        type: "number",
        min: 1,
        max: 168, // 1 week
      },
      {
        field: "auto_metadata_threshold_mb",
        type: "number",
        min: 1,
        max: 100,
      },
      {
        field: "auto_thumbnail_threshold_mb",
        type: "number",
        min: 1,
        max: 100,
      },
    ]);

    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: "Input validation failed",
          validationErrors: validation.errors,
        },
        { status: 400 },
      );
    }

    const currentConfig = await getConfig();
    const newConfig = { ...currentConfig, ...configUpdates };

    const validationErrors = validateConfig(newConfig);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Configuration validation failed",
          validationErrors,
        },
        { status: 400 },
      );
    }

    if (testConnection) {
      const { initializeS3Client, listObjects } = await import("@/lib/s3");

      try {
        // Initialize S3 client for connection test (will reuse if config unchanged)
        initializeS3Client({
          endpoint: newConfig.backblaze_endpoint,
          bucket: newConfig.backblaze_bucket,
          accessKeyId: newConfig.backblaze_access_key,
          secretAccessKey: newConfig.backblaze_secret_key,
        });

        await listObjects(newConfig.backblaze_bucket, "", undefined, 1, 1, request);
      } catch (error) {
        return NextResponse.json(
          {
            success: false,
            error: "S3 connection test failed",
            connectionError:
              error instanceof Error ? error.message : "Unknown error",
          },
          { status: 400 },
        );
      }
    }

    await updateConfig(configUpdates);

    return NextResponse.json({
      success: true,
      message: "Configuration updated successfully",
    });
  } catch (error) {
    logger.apiError("Error in POST /api/config", error as Error, {
      method: "POST",
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
