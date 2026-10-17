import type { Photo } from "@/types";
import type { QuarterTurn } from "./rotation";

/**
 * What the grid and the viewer can change on a photo. Passed around as a
 * patch rather than a whole photo, so a favourite and a rotation landing out
 * of order never undo each other.
 */
export interface PhotoPatch {
  is_favorite?: boolean;
  user_rotation?: QuarterTurn;
}

export function applyPhotoPatch<T extends Photo>(
  photo: T,
  patch: PhotoPatch,
): T {
  return {
    ...photo,
    is_favorite: patch.is_favorite ?? photo.is_favorite,
    metadata:
      patch.user_rotation === undefined
        ? photo.metadata
        : { ...photo.metadata, user_rotation: patch.user_rotation },
  };
}
