import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRecentlyVisitedFolders } from "@/lib/database";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth/middleware";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

/** Recently visited albums, same folder shape as /api/folders */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return NextResponse.json(
      { success: false, error: `limit must be an integer in 1..${MAX_LIMIT}` },
      { status: 400 },
    );
  }

  try {
    const folders = await getRecentlyVisitedFolders(limit);
    return NextResponse.json({ success: true, folders });
  } catch (error) {
    logger.apiError("Error in GET /api/library/recent", error as Error, {
      method: "GET",
      path: "/api/library/recent",
    });
    return NextResponse.json(
      { success: false, error: "recent_folders_failed" },
      { status: 500 },
    );
  }
});
