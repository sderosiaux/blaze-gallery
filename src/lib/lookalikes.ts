import { dayOf } from "./faces";

/**
 * Look-alikes of faces the owner just made someone's, proposed at once in
 * the person's « À trier » queue, without waiting for the worker. The
 * worker's expansion (worker/src/blaze_worker/people.py) stays the
 * authority: it alone accepts a face without asking, and its next run for
 * the person rewrites the whole queue. These are its rules, from the faces
 * just named instead of every face of the person, so they propose a part of
 * what it would.
 *
 * Not applied here: the worker also refuses a face about as close to
 * someone else the owner named. That needs every other person's faces per
 * neighbour, too slow for a request; the worker's next run drops those.
 */

/** people.py REVIEW_THRESHOLD: under this cosine similarity, nothing is proposed. */
export const REVIEW_THRESHOLD = 0.3;
/** people.py AUTO_THRESHOLD: from this cosine similarity a face is the person's without asking. */
export const AUTO_THRESHOLD = 0.6;
/** people.py WINDOW_DAYS: 18 months, how far a reference face reaches. */
export const WINDOW_DAYS = 548;
/** people.py Thresholds.margin: as close to a face rejected for her, minus this, is no. */
export const REJECTED_MARGIN = 0.02;
/** Proposals per face named: the closest ones. */
export const MAX_PROPOSALS = 50;

/** A face just named, and when its photo was taken (ISO, takenOn). */
export interface Reference {
  face_id: number;
  taken: string | null;
}

/** An open face near one of the references. */
export interface Neighbour {
  reference_id: number;
  face_id: number;
  /** One key per file: copies of a photo (same name and size) count once */
  file: string;
  /** Cosine similarity to the reference */
  similarity: number;
  /** ISO date taken (takenOn), null when unknown */
  taken: string | null;
  /** Faces rejected for her at least as close to this one as the reference, minus the margin */
  rejected: { similarity: number; taken: string | null }[];
}

export interface Lookalike {
  face_id: number;
  similarity: number;
  /** The reference it is closest to (face_candidates.best_seed_face_id) */
  best_seed_face_id: number;
  /** Days between this photo and that reference's */
  gap_days: number;
}

const within = (a: string, b: string) =>
  Math.abs(dayOf(a) - dayOf(b)) <= WINDOW_DAYS;

/**
 * What to propose, closest first, at most MAX_PROPOSALS per reference. Like
 * the worker: only dated faces, scored against the references taken within
 * the window of each (best one wins); with a birth date, nothing from before
 * her year of birth; none about as close to a face rejected for her (dated,
 * within the window of the face); one face per file, the closest.
 */
export function chooseLookalikes(
  references: readonly Reference[],
  neighbours: readonly Neighbour[],
  birthDate: string | null,
): Lookalike[] {
  const taken = new Map(references.map((r) => [r.face_id, r.taken]));
  const born = birthDate ? `${birthDate.slice(0, 4)}-01-01` : null;

  type Scored = Neighbour & { day: string; gap_days: number };
  const best = new Map<number, Scored>();
  for (const n of neighbours) {
    const day = n.taken;
    const reference = taken.get(n.reference_id);
    if (n.similarity < REVIEW_THRESHOLD || !day || !reference) continue;
    if (!within(day, reference) || (born && day.slice(0, 10) < born)) continue;
    const kept = best.get(n.face_id);
    if (!kept || n.similarity > kept.similarity)
      best.set(n.face_id, {
        ...n,
        day,
        gap_days: Math.abs(dayOf(day) - dayOf(reference)),
      });
  }

  const perFile = new Map<string, Scored>();
  for (const n of best.values()) {
    const refused = n.rejected.some(
      (r) =>
        r.taken !== null &&
        within(r.taken, n.day) &&
        r.similarity >= n.similarity - REJECTED_MARGIN,
    );
    if (refused) continue;
    const kept = perFile.get(n.file);
    if (
      !kept ||
      n.similarity > kept.similarity ||
      (n.similarity === kept.similarity && n.face_id < kept.face_id)
    )
      perFile.set(n.file, n);
  }

  return [...perFile.values()]
    .sort((a, b) => b.similarity - a.similarity || a.face_id - b.face_id)
    .slice(0, MAX_PROPOSALS * references.length)
    .map((n) => ({
      face_id: n.face_id,
      similarity: n.similarity,
      best_seed_face_id: n.reference_id,
      gap_days: n.gap_days,
    }));
}
