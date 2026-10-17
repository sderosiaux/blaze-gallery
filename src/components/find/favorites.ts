import { asString, readJsonObject } from "@/hooks/apiJson";
import type { Photo } from "@/types";

async function toggle(photoId: string): Promise<boolean> {
  const response = await fetch(`/api/photos/${photoId}/favorite`, {
    method: "POST",
  });
  const data = await readJsonObject(response);
  if (!response.ok || !data.success)
    throw new Error(asString(data.error) ?? `HTTP ${response.status}`);
  return Boolean(data.is_favorite);
}

/**
 * The API only toggles. Setting a known state (Undo, a heart on a stale tile)
 * toggles once and, if another tab or the viewer already flipped it, once more.
 */
export async function setFavorite(
  photo: Pick<Photo, "id">,
  wanted: boolean,
): Promise<boolean> {
  const id = String(photo.id);
  const first = await toggle(id);
  return first === wanted ? first : toggle(id);
}
