import type { NextRequest } from "next/server";
import { nonEmptyOr } from "./textUtils";

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
    ip: getClientIP(request),
    userAgent: nonEmptyOr(request.headers.get("user-agent"), "unknown"),
    referer: nonEmptyOr(request.headers.get("referer"), undefined),
  };
}

/**
 * Get client IP address from request
 * Shorthand for when only IP is needed
 */
export function getClientIP(request: NextRequest): string {
  return nonEmptyOr(
    request.ip,
    nonEmptyOr(request.headers.get("x-forwarded-for"), "unknown"),
  );
}
