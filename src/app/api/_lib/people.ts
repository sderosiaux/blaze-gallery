import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { PeopleError } from "@/lib/people";

/** A positive database id from a route segment or a JSON value, else null. */
export function positiveId(value: unknown): number | null {
  const n =
    typeof value === "string" && /^\d{1,15}$/.test(value)
      ? Number(value)
      : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function badRequest(error: string): NextResponse {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

/** PeopleError carries its own status; anything else is logged and answered 500. */
export function failure(
  error: unknown,
  context: { method: string; path: string },
): NextResponse {
  if (error instanceof PeopleError) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  }
  logger.apiError(
    `Error in ${context.method} ${context.path}`,
    error as Error,
    context,
  );
  return NextResponse.json(
    { success: false, error: "internal_error" },
    { status: 500 },
  );
}
