import { NextRequest, NextResponse } from "next/server";
import { startup, isStartupReady } from "@/scripts/startup";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Check if startup is already complete
    if (isStartupReady()) {
      return NextResponse.json({
        success: true,
        message: "Startup already completed",
        status: "ready",
      });
    }

    // Run startup
    await startup();

    return NextResponse.json({
      success: true,
      message: "Startup completed successfully",
      status: "ready",
    });
  } catch (error) {
    console.error("Startup failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown startup error",
        status: "failed",
      },
      { status: 500 },
    );
  }
}
