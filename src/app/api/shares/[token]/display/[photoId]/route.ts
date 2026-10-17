import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { logShareAccess } from "@/lib/database";
import { validateSharedPhotoAccess } from "@/lib/shareHelpers";
import { getRequestContext } from "@/lib/requestContext";
import { displayHeaders, getDisplayRendition } from "@/lib/displayRendition";
import { asQuarterTurn } from "@/lib/rotation";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { token: string; photoId: string };
}

/**
 * Screen-sized rendition for the shared viewer. It stands in for the original
 * the viewer used to load through /view, so it keeps that route's rules: a
 * password-protected share needs its session (2048 px is the photo, not a
 * thumbnail), and each view is logged.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  // Checked here: the shared helper would hand NaN to the database
  if (!/^\d{1,10}$/.test(params.photoId)) {
    return NextResponse.json({ error: "Invalid photo ID" }, { status: 400 });
  }

  try {
    const validation = await validateSharedPhotoAccess(
      request,
      params.token,
      params.photoId,
    );
    if (validation.error) {
      return validation.error;
    }
    const { share, photo } = validation;

    const ctx = getRequestContext(request);
    await logShareAccess(share.id, {
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      access_type: "view",
      success: true,
    });

    // The hand rotation the viewer asked for (?r=, see displayUrl)
    const rotation = asQuarterTurn(
      Number(request.nextUrl.searchParams.get("r")),
    );
    const result = await getDisplayRendition(photo, rotation, request);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status },
      );
    }
    // Same lifetime as shared thumbnails: a share can be revoked
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: displayHeaders(result.buffer, "private, max-age=86400"),
    });
  } catch (error) {
    console.error("[API] Error serving shared display rendition:", error);
    return NextResponse.json(
      { error: "Failed to serve display rendition" },
      { status: 500 },
    );
  }
}
