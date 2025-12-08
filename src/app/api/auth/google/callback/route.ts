import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  getGoogleUserInfo,
  verifyIdToken,
} from "@/lib/auth/googleOAuth";
import { createUserSession } from "@/lib/auth/userSession";
import {
  validateGoogleUser,
  validateState,
  authRateLimiter,
} from "@/lib/auth/validators";
import { authConfig } from "@/lib/auth/config";

// Force dynamic rendering for auth routes
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // Check if authentication is enabled
    if (!authConfig.enabled) {
      return NextResponse.redirect(
        new URL("/?error=auth_disabled", request.url),
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    // Handle OAuth error responses
    if (error) {
      console.error("OAuth error:", error);
      return NextResponse.redirect(
        new URL(`/?error=oauth_${error}`, request.url),
      );
    }

    // Validate required parameters
    if (!code || !state) {
      return NextResponse.redirect(
        new URL("/?error=invalid_callback", request.url),
      );
    }

    // Rate limiting by IP
    const clientIP =
      request.ip || request.headers.get("x-forwarded-for") || "unknown";
    if (
      !(await authRateLimiter.isAllowed(
        `callback:${clientIP}`,
        5,
        15 * 60 * 1000,
      ))
    ) {
      return NextResponse.redirect(new URL("/?error=rate_limit", request.url));
    }

    // Get stored state and code verifier from cookies
    const storedState = request.cookies.get("oauth_state")?.value;
    const storedCodeVerifier = request.cookies.get(
      "oauth_code_verifier",
    )?.value;

    if (!storedState || !storedCodeVerifier) {
      return NextResponse.redirect(
        new URL("/?error=missing_oauth_data", request.url),
      );
    }

    // Validate state parameter to prevent CSRF attacks
    if (!validateState(state, storedState)) {
      return NextResponse.redirect(
        new URL("/?error=invalid_state", request.url),
      );
    }

    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code, storedCodeVerifier);

    // Verify ID token and get user info
    let userInfoFromToken;
    let userInfoFromApi;

    try {
      userInfoFromToken = await verifyIdToken(tokens.id_token);
    } catch (error) {
      console.error("Failed to verify ID token:", error);
      return NextResponse.redirect(
        new URL("/?error=id_token_verification_failed", request.url),
      );
    }

    try {
      userInfoFromApi = await getGoogleUserInfo(tokens.access_token);
    } catch (error) {
      console.warn(
        "Failed to get user info from API, using ID token info:",
        error,
      );
      userInfoFromApi = null; // We'll use ID token info instead
    }

    // Use ID token info as primary source (more secure)
    const userInfo = userInfoFromToken;

    // Validate user against whitelist and other rules
    const validation = validateGoogleUser(userInfo);
    if (!validation.valid) {
      console.warn("User validation failed:", validation.errors);
      return NextResponse.redirect(
        new URL(
          `/?error=unauthorized&reason=${encodeURIComponent(validation.errors[0])}`,
          request.url,
        ),
      );
    }

    // Create user session in database
    const sessionId = await createUserSession({
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      googleId: userInfo.sub,
    });

    // Create response and set session cookie
    const response = NextResponse.redirect(
      new URL("/?auth=success", request.url),
    );

    response.cookies.set("auth_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: authConfig.sessionDuration,
      path: "/",
    });

    // Clear OAuth temporary cookies
    response.cookies.delete("oauth_state");
    response.cookies.delete("oauth_code_verifier");

    return response;
  } catch (error) {
    console.error("Error in OAuth callback:", error);
    return NextResponse.redirect(
      new URL("/?error=callback_failed", request.url),
    );
  }
}
