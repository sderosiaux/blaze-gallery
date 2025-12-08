import { NextRequest } from "next/server";

/**
 * Context extracted from incoming requests
 */
export interface RequestContext {
  ip: string;
  userAgent: string;
  referer?: string;
}

/**
 * Extract common context from a Next.js request
 * Used for logging, rate limiting, and analytics
 */
export function getRequestContext(request: NextRequest): RequestContext {
  return {
    ip: request.ip || request.headers.get("x-forwarded-for") || "unknown",
    userAgent: request.headers.get("user-agent") || "unknown",
    referer: request.headers.get("referer") || undefined,
  };
}

/**
 * Get client IP address from request
 * Shorthand for when only IP is needed
 */
export function getClientIP(request: NextRequest): string {
  return request.ip || request.headers.get("x-forwarded-for") || "unknown";
}
