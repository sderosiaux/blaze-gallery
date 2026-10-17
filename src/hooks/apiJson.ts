export type JsonObject = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a response body as a JSON object. Anything else (invalid JSON,
 * array, null, scalar) yields an empty object, so callers fall through to
 * their `success` check and treat it as a failed response.
 */
export async function readJsonObject(response: Response): Promise<JsonObject> {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) ? body : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}
