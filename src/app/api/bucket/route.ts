import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const config = await getConfig();
    
    return NextResponse.json({
      success: true,
      bucket: config.backblaze_bucket,
    });
  } catch (error) {
    logger.apiError("Error in GET /api/bucket", error as Error, {
      method: "GET",
      path: "/api/bucket",
    });
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        bucket: "Root", // Fallback to "Root" if config fails
      },
      { status: 500 },
    );
  }
}