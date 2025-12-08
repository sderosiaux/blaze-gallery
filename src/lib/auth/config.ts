import { AuthConfig } from "./types";

function getAuthConfig(): AuthConfig {
  const enabled =
    process.env.GOOGLE_AUTH_ENABLED?.trim().replace(/\\n/g, "") === "true";

  return {
    enabled,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/auth/google/callback`,
    emailWhitelist: process.env.AUTH_EMAIL_WHITELIST
      ? process.env.AUTH_EMAIL_WHITELIST.split(",").map((email) =>
          email.trim().toLowerCase(),
        )
      : [],
    sessionSecret: process.env.AUTH_SESSION_SECRET,
    sessionDuration: parseInt(process.env.AUTH_SESSION_DURATION || "86400", 10), // 24 hours default
  };
}

// Validate configuration on startup
export function validateAuthConfig(): { valid: boolean; errors: string[] } {
  const config = getAuthConfig();
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] }; // Valid when disabled
  }

  if (!config.googleClientId) {
    errors.push("GOOGLE_CLIENT_ID is required when authentication is enabled");
  }

  if (!config.googleClientSecret) {
    errors.push(
      "GOOGLE_CLIENT_SECRET is required when authentication is enabled",
    );
  }

  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    errors.push(
      "AUTH_SESSION_SECRET must be at least 32 characters when authentication is enabled",
    );
  }

  if (config.emailWhitelist.length === 0) {
    errors.push(
      "AUTH_EMAIL_WHITELIST cannot be empty when authentication is enabled",
    );
  }

  // Validate redirect URI format
  if (
    config.googleRedirectUri &&
    !config.googleRedirectUri.startsWith("http")
  ) {
    errors.push("GOOGLE_REDIRECT_URI must be a valid HTTP/HTTPS URL");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const authConfig = getAuthConfig();
