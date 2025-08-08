/**
 * Authentication middleware and utilities
 */

import { NextRequest, NextResponse } from "next/server";
import { logger } from "./logger";
import crypto from "crypto";

export interface AuthConfig {
  apiKeyRequired?: boolean;
  adminKeyRequired?: boolean;
  rateLimitByIp?: boolean;
}

export interface AuthResult {
  isAuthenticated: boolean;
  error?: string;
  userRole?: "user" | "admin";
  identifier?: string;
}

/**
 * Simple API key authentication for demo/development purposes
 * In production, use proper OAuth2/JWT authentication
 */
export function authenticateRequest(
  request: NextRequest,
  config: AuthConfig = {},
): AuthResult {
  try {
    // Skip authentication if not required (for development)
    if (!config.apiKeyRequired && !config.adminKeyRequired) {
      return { isAuthenticated: true };
    }

    const authHeader = request.headers.get("authorization");
    const apiKey = request.headers.get("x-api-key");

    // Check for API key in header or authorization header
    let providedKey: string | null = null;

    if (apiKey) {
      providedKey = apiKey;
    } else if (authHeader?.startsWith("Bearer ")) {
      providedKey = authHeader.slice(7);
    } else if (authHeader?.startsWith("ApiKey ")) {
      providedKey = authHeader.slice(7);
    }

    if (!providedKey) {
      return {
        isAuthenticated: false,
        error:
          "API key required. Provide X-API-Key header or Authorization: Bearer <key>",
      };
    }

    // Get expected keys from environment
    const validApiKey = process.env.API_KEY;
    const validAdminKey = process.env.ADMIN_API_KEY;

    // Check admin key first (if required)
    if (config.adminKeyRequired) {
      if (!validAdminKey) {
        logger.warn("Admin API key not configured but required", {
          component: "Auth",
          endpoint: request.url,
        });
        return {
          isAuthenticated: false,
          error: "Admin authentication not configured",
        };
      }

      if (providedKey === validAdminKey) {
        return {
          isAuthenticated: true,
          userRole: "admin",
          identifier: "admin",
        };
      }

      return {
        isAuthenticated: false,
        error: "Invalid admin API key",
      };
    }

    // Check regular API key
    if (config.apiKeyRequired) {
      if (!validApiKey) {
        logger.warn("API key not configured but required", {
          component: "Auth",
          endpoint: request.url,
        });
        return {
          isAuthenticated: false,
          error: "Authentication not configured",
        };
      }

      // Support both user and admin keys for regular API access
      if (providedKey === validApiKey || providedKey === validAdminKey) {
        return {
          isAuthenticated: true,
          userRole: providedKey === validAdminKey ? "admin" : "user",
          identifier: providedKey === validAdminKey ? "admin" : "user",
        };
      }

      return {
        isAuthenticated: false,
        error: "Invalid API key",
      };
    }

    return { isAuthenticated: true };
  } catch (error) {
    logger.error("Authentication error", {
      component: "Auth",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      isAuthenticated: false,
      error: "Authentication system error",
    };
  }
}

/**
 * Middleware wrapper for API routes
 */
export function withAuth(handler: Function, config: AuthConfig = {}) {
  return async (request: NextRequest, context?: any) => {
    const authResult = authenticateRequest(request, config);

    if (!authResult.isAuthenticated) {
      logger.warn("Authentication failed", {
        component: "Auth",
        method: request.method,
        url: request.url,
        error: authResult.error,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIP(request),
      });

      return NextResponse.json(
        {
          success: false,
          error: authResult.error || "Authentication required",
        },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": 'Bearer realm="API"',
          },
        },
      );
    }

    // Log successful authentication
    logger.info("Request authenticated", {
      component: "Auth",
      method: request.method,
      url: request.url,
      userRole: authResult.userRole || "unknown",
      identifier: authResult.identifier || "unknown",
    });

    // Add auth context to request if needed
    if (context) {
      context.auth = authResult;
    }

    return handler(request, context);
  };
}

/**
 * Rate limiting helpers
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 100,
  windowMs: number = 60000,
): boolean {
  const now = Date.now();
  const key = identifier;

  const current = requestCounts.get(key);

  if (!current || now > current.resetTime) {
    requestCounts.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

/**
 * Get client IP address from request
 */
export function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  // Fallback to connection info (may not be available in all environments)
  return "unknown";
}

/**
 * Generate secure API key
 */
export function generateApiKey(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Hash API key for storage (future use)
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(key: string): boolean {
  return (
    typeof key === "string" &&
    key.length >= 16 &&
    key.length <= 128 &&
    /^[a-zA-Z0-9]+$/.test(key)
  );
}
