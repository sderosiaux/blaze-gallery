import { parseAlbumName } from "./albums";
import { asQuarterTurn, type QuarterTurn } from "./rotation";

/**
 * Faces as the worker stores them (db/schema.sql, table faces): box and
 * landmarks are fractions of the image in its displayed orientation (EXIF
 * applied), before the owner's hand rotation. Everything the app draws or
 * crops is the photo as shown, hand rotation included: turn the box first.
 */

/** [x, y, width, height], fractions of the image. */
export type FaceBox = [number, number, number, number];

/** How a face came to be someone's (faces.assignment). */
export type Assignment = "seed" | "manual" | "auto" | "rejected";

/** The ones that make the face that person's; "rejected" says it is not. */
export const OWNED_ASSIGNMENTS = ["seed", "manual", "auto"] as const;

export function isOwned(assignment: string | null): boolean {
  return (OWNED_ASSIGNMENTS as readonly (string | null)[]).includes(assignment);
}

export function asFaceBox(value: unknown): FaceBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite)
    ? [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0, numbers[3] ?? 0]
    : null;
}

/** The box on the photo turned `rotation` clockwise (formulas in db/schema.sql). */
export function turnBox(box: FaceBox, rotation: QuarterTurn): FaceBox {
  const [x, y, w, h] = box;
  switch (rotation) {
    case 90:
      return [1 - y - h, x, h, w];
    case 180:
      return [1 - x - w, 1 - y - h, w, h];
    case 270:
      return [y, 1 - x - w, h, w];
    default:
      return box;
  }
}

/**
 * Clockwise turn that stands the face up on the photo as shown. The worker
 * found some faces only on the image turned `detectRotation` (a photo stored
 * on its side); the owner's hand rotation may already have done part of it.
 */
export function uprightTurn(
  detectRotation: number,
  userRotation: QuarterTurn,
): QuarterTurn {
  return asQuarterTurn((((detectRotation - userRotation) % 360) + 360) % 360);
}

// -- when a photo was taken --------------------------------------------------

/** EXIF and folder dates further apart than this: the camera clock was wrong. */
const DISAGREEMENT_DAYS = 183;
const DAY_MS = 86_400_000;

export type DateSource = "exif" | "folder";

/** Date of the deepest folder whose name starts with one (same rule as the worker). */
export function folderDate(path: string | null): string | null {
  if (!path) return null;
  const names = path.split("/").filter(Boolean).reverse();
  for (const name of names) {
    const parsed = parseAlbumName(name);
    if (parsed.date) return parsed.date;
  }
  return null;
}

/** Days since 1970-01-01 of an ISO date or timestamp (its date part). */
export function dayOf(iso: string): number {
  return Math.floor(Date.parse(iso.slice(0, 10)) / DAY_MS);
}

/**
 * When the photo was taken. EXIF wins unless the folder name says otherwise
 * by more than six months (a camera whose clock was never set, at a wedding
 * filed as "2011-04-30 Mariage"). Mirrors worker/blaze_worker/people.py
 * taken_on, so the app groups photos by the dates the expansion used.
 */
export function takenOn(
  exifIso: string | null | undefined,
  folderPath: string | null,
): { taken: string | null; source: DateSource | null } {
  const folder = folderDate(folderPath);
  const exif = exifIso && !Number.isNaN(Date.parse(exifIso)) ? exifIso : null;
  if (
    exif &&
    (!folder || Math.abs(dayOf(exif) - dayOf(folder)) <= DISAGREEMENT_DAYS)
  ) {
    return { taken: exif, source: "exif" };
  }
  if (folder) return { taken: folder, source: "folder" };
  return { taken: null, source: null };
}

/** Whole years between a birth date and a day (both ISO), or null. */
export function ageOn(birthDate: string | null, iso: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const day = new Date(iso);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(day.getTime())) return null;
  let age = day.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    day.getUTCMonth() < birth.getUTCMonth() ||
    (day.getUTCMonth() === birth.getUTCMonth() &&
      day.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : null;
}

// -- URLs ---------------------------------------------------------------------

/** A square crop of the face, upright, from the screen-sized rendition. */
export function faceCropUrl(faceId: number | string): string {
  return `/api/faces/${String(faceId)}/crop`;
}
