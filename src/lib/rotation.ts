/**
 * A rotation the owner applied by hand, for photos whose file lost its EXIF
 * orientation (a Windows editor rewrote it as "normal" while the pixels lie
 * on their side). Stored in photos.metadata.user_rotation, clockwise, on top
 * of the EXIF orientation; the original file in the bucket is never touched.
 */
export type QuarterTurn = 0 | 90 | 180 | 270;

export function asQuarterTurn(value: unknown): QuarterTurn {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

export function userRotation(
  metadata: { user_rotation?: unknown } | null | undefined,
): QuarterTurn {
  return asQuarterTurn(metadata?.user_rotation);
}

export function turn(
  current: QuarterTurn,
  direction: "cw" | "ccw",
): QuarterTurn {
  return asQuarterTurn((current + (direction === "cw" ? 90 : 270)) % 360);
}

/** Display-oriented size once the hand rotation is applied. */
export function rotatedSize<T extends { width: number; height: number }>(
  size: T,
  rotation: QuarterTurn,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}
