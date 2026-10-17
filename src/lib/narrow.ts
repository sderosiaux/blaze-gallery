/** Reads `obj[key]` from a value of unknown shape (SDK errors, parsed tags, ...) */
export function prop(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null
    ? (obj as Record<string, unknown>)[key]
    : undefined;
}

/** The first value that is neither missing nor empty; "" counts as absent */
export function nonEmpty(
  ...values: (string | null | undefined)[]
): string | undefined {
  return values.find(
    (value): value is string =>
      value !== undefined && value !== null && value !== "",
  );
}
