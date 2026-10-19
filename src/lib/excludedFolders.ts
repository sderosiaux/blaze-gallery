import { asArray, isRecord, readJsonObject } from "@/hooks/apiJson";

/**
 * Folders marked « pas une galerie photo » (excluded_folders in
 * db/schema.sql), as the pages ask for them; the SQL is in database.ts.
 */

/** A marked folder, as GET /api/excluded-folders lists it. */
export interface ExcludedFolderEntry {
  path: string;
  created_at: string;
  /** Photos and videos in it and below it */
  photo_count: number;
}

/**
 * A folder path as folders.path holds it, without a slash at either end;
 * null for the root, which cannot be marked.
 */
export function normalizeFolderPath(raw: string): string | null {
  const path = raw.replace(/^\/+|\/+$/g, "");
  return path === "" ? null : path;
}

function toEntry(value: unknown): ExcludedFolderEntry | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  return {
    path: value.path,
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    photo_count: typeof value.photo_count === "number" ? value.photo_count : 0,
  };
}

export async function fetchExcludedFolders(
  signal?: AbortSignal,
): Promise<ExcludedFolderEntry[]> {
  const response = await fetch("/api/excluded-folders", { signal });
  const body = await readJsonObject(response);
  if (!response.ok || body.success !== true)
    throw new Error(`HTTP ${response.status}`);
  return asArray(body.folders)
    .map(toEntry)
    .filter((entry) => entry !== null);
}

/** Marks the folder (`excluded`) or puts it back in the gallery; throws when refused. */
export async function setFolderExcluded(
  path: string,
  excluded: boolean,
): Promise<void> {
  const response = await fetch("/api/excluded-folders", {
    method: excluded ? "POST" : "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const body = await readJsonObject(response);
  if (!response.ok || body.success !== true)
    throw new Error(
      typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
    );
}
