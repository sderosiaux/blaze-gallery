import { NextRequest, NextResponse } from "next/server";
import { validateUserSession } from "@/lib/auth/userSession";
import { authConfig } from "@/lib/auth/config";

// Force dynamic rendering for auth routes
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // If authentication is disabled, allow access (bypass auth)
    if (!authConfig.enabled) {
      return NextResponse.json({
        isAuthenticated: true,
        user: { name: "Guest", email: "guest@local" },
      });
    }

    // Get session cookie
    const sessionCookie = request.cookies.get("auth_session")?.value;

    if (!sessionCookie) {
      return NextResponse.json({
        isAuthenticated: false,
        user: null,
      });
    }

    // Validate session from database
    const session = await validateUserSession(sessionCookie);

    if (!session) {
      // Clear invalid session cookie
      const response = NextResponse.json({
        isAuthenticated: false,
        user: null,
      });

      response.cookies.delete("auth_session");
      return response;
    }

    // Return session data (excluding sensitive fields)
    return NextResponse.json({
      isAuthenticated: true,
      user: {
        id: session.id,
        email: session.email,
        name: session.name,
        picture: session.picture,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      },
    });
  } catch (error) {
    console.error("Error validating session:", error);
    return NextResponse.json(
      { error: "Failed to validate session" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Get session cookie
    const sessionCookie = request.cookies.get("auth_session")?.value;

    if (sessionCookie) {
      const { revokeUserSession } = await import("@/lib/auth/userSession");
      await revokeUserSession(sessionCookie);
    }

    // Clear session cookie
    const response = NextResponse.json({
      success: true,
      message: "Session cleared",
    });

    response.cookies.delete("auth_session");
    return response;
  } catch (error) {
    console.error("Error clearing session:", error);
    return NextResponse.json(
      { error: "Failed to clear session" },
      { status: 500 },
    );
  }
}
