import { authConfig } from "./config";
import { GoogleTokenResponse, GoogleUserInfo } from "./types";
import { generatePKCE, generateState } from "./validators";

/**
 * Google OAuth URLs
 */
const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * OAuth scopes requested from Google
 */
const OAUTH_SCOPES = ["openid", "email", "profile"];

/**
 * Generate Google OAuth authorization URL with PKCE
 */
export function generateGoogleAuthUrl(): {
  url: string;
  state: string;
  codeVerifier: string;
} {
  if (!authConfig.enabled) {
    throw new Error("Authentication is not enabled");
  }

  if (!authConfig.googleClientId || !authConfig.googleRedirectUri) {
    throw new Error("Google OAuth configuration is incomplete");
  }

  const state = generateState();
  const { codeVerifier, codeChallenge, codeChallengeMethod } = generatePKCE();

  const params = new URLSearchParams({
    client_id: authConfig.googleClientId,
    redirect_uri: authConfig.googleRedirectUri,
    scope: OAUTH_SCOPES.join(" "),
    response_type: "code",
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    access_type: "offline",
    prompt: "consent", // Ensure we get refresh token
  });

  return {
    url: `${GOOGLE_OAUTH_BASE}?${params.toString()}`,
    state,
    codeVerifier,
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<GoogleTokenResponse> {
  if (!authConfig.enabled) {
    throw new Error("Authentication is not enabled");
  }

  if (
    !authConfig.googleClientId ||
    !authConfig.googleClientSecret ||
    !authConfig.googleRedirectUri
  ) {
    throw new Error("Google OAuth configuration is incomplete");
  }

  const params = new URLSearchParams({
    client_id: authConfig.googleClientId,
    client_secret: authConfig.googleClientSecret,
    redirect_uri: authConfig.googleRedirectUri,
    grant_type: "authorization_code",
    code: code,
    code_verifier: codeVerifier,
  });

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Token exchange failed:", error);
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const tokens: GoogleTokenResponse = await response.json();

    // Validate token response
    if (!tokens.access_token || !tokens.id_token) {
      throw new Error("Invalid token response from Google");
    }

    return tokens;
  } catch (error) {
    console.error("Error exchanging code for tokens:", error);
    throw error;
  }
}

/**
 * Get user information from Google
 */
export async function getGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  try {
    const response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.status}`);
    }

    const userInfo: GoogleUserInfo = await response.json();

    // Log the actual response for debugging
    console.log("Google user info response:", {
      id: userInfo.id,
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      email_verified: userInfo.email_verified,
      verified_email: userInfo.verified_email,
      picture: userInfo.picture,
    });

    // Normalize field names - Google API inconsistency
    if (!userInfo.sub && userInfo.id) {
      userInfo.sub = userInfo.id;
    }
    if (!userInfo.email_verified && userInfo.verified_email !== undefined) {
      userInfo.email_verified = userInfo.verified_email;
    }

    // Handle missing name field by constructing from given_name/family_name
    if (!userInfo.name && (userInfo.given_name || userInfo.family_name)) {
      userInfo.name =
        [userInfo.given_name, userInfo.family_name].filter(Boolean).join(" ") ||
        userInfo.email.split("@")[0];
    }

    // Validate required fields
    if (!userInfo.sub || !userInfo.email || !userInfo.name) {
      console.error("Missing required fields in Google user info:", {
        hasSub: !!userInfo.sub,
        hasEmail: !!userInfo.email,
        hasName: !!userInfo.name,
        hasGivenName: !!userInfo.given_name,
        hasFamilyName: !!userInfo.family_name,
        actualResponse: userInfo,
      });
      throw new Error("Incomplete user information from Google");
    }

    return userInfo;
  } catch (error) {
    console.error("Error getting user info:", error);
    throw error;
  }
}

/**
 * Verify Google ID token (additional security layer)
 */
export async function verifyIdToken(idToken: string): Promise<GoogleUserInfo> {
  if (!authConfig.googleClientId) {
    throw new Error("Google client ID not configured");
  }

  try {
    // Google's tokeninfo endpoint for verification
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    );

    if (!response.ok) {
      throw new Error("ID token verification failed");
    }

    const payload = await response.json();

    // Verify the token is for our application
    if (payload.aud !== authConfig.googleClientId) {
      throw new Error("ID token audience mismatch");
    }

    // Verify token hasn't expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new Error("ID token has expired");
    }

    // Extract user info
    const userInfo: GoogleUserInfo = {
      sub: payload.sub,
      email: payload.email,
      email_verified:
        payload.email_verified === "true" || payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
      given_name: payload.given_name,
      family_name: payload.family_name,
    };

    return userInfo;
  } catch (error) {
    console.error("Error verifying ID token:", error);
    throw error;
  }
}

/**
 * Revoke Google tokens (for logout)
 */
export async function revokeGoogleTokens(accessToken: string): Promise<void> {
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${accessToken}`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      console.warn("Failed to revoke Google tokens:", response.status);
      // Don't throw error as local session cleanup is more important
    }
  } catch (error) {
    console.warn("Error revoking Google tokens:", error);
    // Don't throw error as local session cleanup is more important
  }
}
