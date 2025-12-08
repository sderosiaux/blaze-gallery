import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth/config";

// Force dynamic rendering for auth routes
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      enabled: authConfig.enabled,
    });
  } catch (error) {
    console.error("Error getting auth config:", error);
    return NextResponse.json({ enabled: false });
  }
}
