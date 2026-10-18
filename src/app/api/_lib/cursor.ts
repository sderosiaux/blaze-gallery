import { isRecord } from "@/hooks/apiJson";

/** Opaque page cursor handed to clients: base64url JSON. */
export function encodeCursor(cursor: object | null): string | null {
  return cursor
    ? Buffer.from(JSON.stringify(cursor)).toString("base64url")
    : null;
}

/** The cursor back, or null when it is not one `read` accepts. */
export function decodeCursor<C>(
  value: string,
  read: (parsed: unknown) => C | null,
): C | null {
  try {
    return read(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** Cursor of a list ranked on the fly (semantic search): how many rows come before the page. */
export interface OffsetCursor {
  offset: number;
}

/** Ranked lists stop being useful long before this. */
const MAX_OFFSET = 10_000;

export function toOffsetCursor(value: unknown): OffsetCursor | null {
  if (!isRecord(value)) return null;
  const { offset } = value;
  return typeof offset === "number" &&
    Number.isInteger(offset) &&
    offset > 0 &&
    offset <= MAX_OFFSET
    ? { offset }
    : null;
}
