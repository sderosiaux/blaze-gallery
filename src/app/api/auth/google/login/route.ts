import { NextRequest, NextResponse } from "next/server";
import { generateGoogleAuthUrl } from "@/lib/auth/googleOAuth";
import { authConfig } from "@/lib/auth/config";
import { authRateLimiter, validateOrigin } from "@/lib/auth/validators";

// Force dynamic rendering for auth routes
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Check if authentication is enabled
    if (!authConfig.enabled) {
      return NextResponse.json(
        { error: "Authentication is not enabled" },
        { status: 503 },
      );
    }

    // Validate origin for CSRF protection
    if (!validateOrigin(request)) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }

    // Rate limiting by IP
    const clientIP =
      request.ip || request.headers.get("x-forwarded-for") || "unknown";
    if (
      !(await authRateLimiter.isAllowed(`auth:${clientIP}`, 10, 15 * 60 * 1000))
    ) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please try again later." },
        { status: 429 },
      );
    }

    // Generate OAuth URL with PKCE
    const { url, state, codeVerifier } = generateGoogleAuthUrl();

    // Create response with OAuth URL
    const response = NextResponse.json({
      authUrl: url,
      state,
    });

    // Store state and code verifier in secure HTTP-only cookies
    response.cookies.set("oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60, // 10 minutes
      path: "/",
    });

    response.cookies.set("oauth_code_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60, // 10 minutes
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    return NextResponse.json(
      { error: "Failed to initiate authentication" },
      { status: 500 },
    );
  }
}
