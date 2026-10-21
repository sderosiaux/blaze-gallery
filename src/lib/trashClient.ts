/** The Corbeille's routes, from the browser (src/app/api/trash, stacks/keep). */
import type { Photo } from "@/types";
import { asArray, asString, readJsonObject } from "@/hooks/apiJson";

export class TrashError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly count?: number,
  ) {
    super(message);
  }
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new TrashError(
      asString(data.error) ?? "La corbeille n’a pas répondu",
      asString(data.code),
      typeof data.count === "number" ? data.count : undefined,
    );
  return data;
}

/** Into the Corbeille; the ids that went (not those already in it). */
export async function sendToTrash(ids: readonly number[]): Promise<number[]> {
  const data = await post("/api/trash", { photo_ids: ids });
  return asArray(data.trashed).map(Number);
}

export async function restoreFromTrash(
  ids: readonly number[] | "all",
): Promise<number> {
  const data = await post(
    "/api/trash/restore",
    ids === "all" ? { all: true } : { photo_ids: ids },
  );
  return Number(data.restored);
}

/**
 * « Garder celle-ci »: `keep` stay, the rest of their stacks go to the
 * Corbeille, if that rest is still `trash`, the photos the owner saw go.
 */
export async function keepInStacks(
  keep: readonly number[],
  trash: readonly number[],
): Promise<number[]> {
  const data = await post("/api/stacks/keep", { keep, trash });
  return asArray(data.trashed).map(Number);
}

/** The photos of a photo's stack the gallery shows, best first. */
export async function stackPhotos(photoId: Photo["id"]): Promise<Photo[]> {
  const response = await fetch(`/api/photos/${String(photoId)}/stack`);
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new TrashError("La pile n’a pas pu être lue");
  return asArray(data.photos) as Photo[];
}

/**
 * What a list shows in a stack's place once `gone` left it: the best of
 * `photos` still there, fronting what is left; null when none is.
 */
export function nextFront(
  photos: readonly Photo[],
  gone: readonly Photo["id"][],
  stackId: number | undefined,
): Photo | null {
  const left = photos.filter(
    (p) => !gone.some((id) => String(id) === String(p.id)),
  );
  const [first] = left;
  if (!first) return null;
  const { stack: _, ...photo } = first;
  return left.length >= 2 && stackId !== undefined
    ? { ...photo, stack: { id: stackId, count: left.length } }
    : photo;
}
