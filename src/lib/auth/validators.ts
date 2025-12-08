import crypto from "crypto";
import { authConfig } from "./config";
import { GoogleUserInfo } from "./types";

/**
 * Validate if an email is in the whitelist
 */
export function isEmailWhitelisted(email: string): boolean {
  if (!authConfig.enabled) {
    return true; // No restrictions when auth is disabled
  }

  const normalizedEmail = email.toLowerCase().trim();
  return authConfig.emailWhitelist.includes(normalizedEmail);
}

/**
 * Validate Google user info
 */
export function validateGoogleUser(userInfo: GoogleUserInfo): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check if email is verified
  if (!userInfo.email_verified) {
    errors.push("Email address is not verified by Google");
  }

  // Check if email is whitelisted
  if (!isEmailWhitelisted(userInfo.email)) {
    errors.push(
      `Email ${userInfo.email} is not authorized to access this application`,
    );
  }

  // Basic validation
  if (!userInfo.email || !userInfo.email.includes("@")) {
    errors.push("Invalid email address");
  }

  if (!userInfo.name || userInfo.name.trim().length === 0) {
    errors.push("Name is required");
  }

  if (!userInfo.sub || userInfo.sub.trim().length === 0) {
    errors.push("Google user ID is required");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate a cryptographically secure random state parameter for OAuth
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generate PKCE challenge and verifier
 */
export function generatePKCE(): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: string;
} {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}

/**
 * Validate OAuth state parameter
 */
export function validateState(
  receivedState: string,
  expectedState: string,
): boolean {
  if (!receivedState || !expectedState) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(receivedState),
    Buffer.from(expectedState),
  );
}

import { DatabaseRateLimiter } from "@/lib/rateLimiter";

// Auth rate limiter: 5 attempts per 15 minutes
export const authRateLimiter = new DatabaseRateLimiter(15 * 60 * 1000, 5);

/**
 * Validate request origin for CSRF protection
 */
export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // In development, allow localhost
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const allowedOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (!allowedOrigin) {
    console.warn("NEXT_PUBLIC_APP_URL not set, origin validation disabled");
    return true;
  }

  // Check origin header
  if (origin && origin === allowedOrigin) {
    return true;
  }

  // Check referer header as fallback
  if (referer && referer.startsWith(allowedOrigin)) {
    return true;
  }

  console.warn("Invalid origin/referer:", { origin, referer, allowedOrigin });
  return false;
}
