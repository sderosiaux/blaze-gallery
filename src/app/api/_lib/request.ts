import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validateOrigin } from "@/lib/auth/validators";

/**
 * A 403 for a write sent from another site's page (validateOrigin: the
 * app's own origin or referer), null when it comes from the app.
 */
export function refusedOrigin(request: Request): NextResponse | null {
  return validateOrigin(request)
    ? null
    : NextResponse.json(
        { success: false, error: "Invalid origin" },
        { status: 403 },
      );
}

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Request JSON body as an object; any other JSON value reads as an empty body. Malformed JSON still throws. */
export async function readJsonObject(
  request: NextRequest,
): Promise<JsonObject> {
  const body: unknown = await request.json();
  return isJsonObject(body) ? body : {};
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Client address for access logs: the socket address, else the forwarded-for header, else "unknown". */
export function clientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return request.ip ? request.ip : forwardedFor ? forwardedFor : "unknown";
}

export function clientUserAgent(request: NextRequest): string {
  const userAgent = request.headers.get("user-agent");
  return userAgent ? userAgent : "unknown";
}

/** True when an optional date query parameter is present but not a parseable date. */
export function isInvalidDateParam(value: string | null): boolean {
  return value !== null && value !== "" && isNaN(Date.parse(value));
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
