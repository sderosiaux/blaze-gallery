import { positiveId } from "./people";

/** Distinct positive ids from a JSON array of 1 to `max`, else null. */
export function idList(value: unknown, max: number): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max)
    return null;
  const ids = value.map(positiveId);
  return ids.some((id) => id === null) ? null : [...new Set(ids as number[])];
}

/** The JSON object of a request body, else null. */
export async function jsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}
