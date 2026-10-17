import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { suggestFolders } from "@/lib/database";
import { logger } from "@/lib/logger";
import { normalizeTextForSearch } from "@/lib/textUtils";

export const dynamic = "force-dynamic";

const LIMIT = 8;
const MIN_LENGTH = 2;

/**
 * Folders to jump to while typing in the search field: name, path and cover
 * only, one query, no photo search. Fewer than two characters suggest nothing.
 */
export const GET = requireAuth(async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  if (normalizeTextForSearch(q).length < MIN_LENGTH) {
    return NextResponse.json({ success: true, folders: [] });
  }

  try {
    const folders = await suggestFolders(q, LIMIT);
    return NextResponse.json({ success: true, folders });
  } catch (error) {
    logger.apiError("Error suggesting folders", error as Error, {
      method: "GET",
      path: "/api/search/suggest",
    });
    return NextResponse.json(
      { success: false, error: "suggest_failed" },
      { status: 500 },
    );
  }
});
