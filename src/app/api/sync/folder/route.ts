import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createSyncJob } from "@/lib/database";
import { logger } from "@/lib/logger";
import { SyncJobType, SyncJobResponse } from "@/types/common";
import { validateInput, CommonValidators } from "@/lib/validation";
import { authenticateRequest } from "@/lib/auth";

export const POST = requireAuth(async function POST(request: NextRequest) {
  // Authentication check for sync operations
  const authResult = authenticateRequest(request, { apiKeyRequired: true });
  if (!authResult.isAuthenticated) {
    const errorResponse: SyncJobResponse = {
      success: false,
      error: authResult.error || "Authentication required",
    };
    return NextResponse.json(errorResponse, { status: 401 });
  }

  try {
    let body: any;

    // Parse JSON with error handling
    try {
      body = await request.json();
    } catch (error) {
      const errorResponse: SyncJobResponse = {
        success: false,
        error: "Invalid JSON in request body",
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const { folderPath, type } = body;

    // Comprehensive input validation
    const validation = validateInput(body, [
      {
        field: "folderPath",
        required: true,
        type: "string",
        maxLength: 1024,
        customValidator: (value) => {
          if (typeof value !== "string") return "must be a string";
          // Prevent path traversal attacks
          if (
            value.includes("..") ||
            value.includes("//") ||
            value.startsWith("/")
          ) {
            return "contains invalid path characters";
          }
          // Allow empty string for root folder
          if (value !== "" && !/^[a-zA-Z0-9_. /-]*$/.test(value)) {
            return "contains invalid characters";
          }
          return null;
        },
      },
      {
        field: "type",
        type: "string",
        allowedValues: ["folder_scan", "metadata_scan"],
      },
    ]);

    if (!validation.isValid) {
      const errorResponse: SyncJobResponse = {
        success: false,
        error: `Input validation failed: ${validation.errors.join(", ")}`,
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const syncType = type || "metadata_scan";

    logger.apiRequest("Creating folder sync job", {
      method: "POST",
      path: "/api/sync/folder",
    });

    const job = await createSyncJob({
      type: syncType as SyncJobType,
      folder_path: folderPath,
    });

    const response: SyncJobResponse = {
      success: true,
      data: job,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.apiError("Error in POST /api/sync/folder", error as Error, {
      method: "POST",
      path: "/api/sync/folder",
    });
    const errorResponse: SyncJobResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
});
