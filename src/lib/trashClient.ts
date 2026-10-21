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
  ids: readonly number[] | "all" | { lot: string },
): Promise<number> {
  const data = await post(
    "/api/trash/restore",
    ids === "all"
      ? { all: true }
      : "lot" in ids
        ? { lot: ids.lot }
        : { photo_ids: ids },
  );
  return Number(data.restored);
}

/** A photo in the Corbeille beside the photo kept in its place (GET /api/trash/:id/proof, lib/trash.ts TrashProof). */
export interface ProofPhoto {
  id: number;
  filename: string;
  folder_path: string;
  size: number;
  width: number | null;
  height: number | null;
  taken: string | null;
  etag: string | null;
  trashed: boolean;
  metadata: Photo["metadata"];
  thumbnail_url: string;
}

export interface TrashProof {
  photo: ProofPhoto & {
    trashed_at: string;
    trashed_by: "owner" | "auto" | null;
    trash_batch: string | null;
  };
  kept: ProofPhoto | null;
  kept_state: "present" | "trashed" | "gone" | "none";
  same_bytes: boolean | null;
}

export async function fetchProof(id: Photo["id"]): Promise<TrashProof> {
  const response = await fetch(`/api/trash/${String(id)}/proof`);
  const data = await readJsonObject(response);
  if (!response.ok || data.success !== true)
    throw new TrashError(
      asString(data.error) ?? "La photo gardée n’a pas pu être lue",
    );
  return data as unknown as TrashProof;
}

/**
 * « Annuler » after « Restaurer celle-ci »: back in the Corbeille with the
 * marks the server kept; a TrashError says why not.
 */
export async function putBackInTrash(id: Photo["id"]): Promise<void> {
  await post("/api/trash/put-back", { id: Number(id) });
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

/**
 * What keeping each photo of `keep` would throw away (POST
 * /api/stacks/keep/preview): per kept id, the ids going.
 */
export async function previewKeep(
  keep: readonly number[],
): Promise<Map<number, number[]>> {
  const data = await post("/api/stacks/keep/preview", { keep });
  const going = (data.going ?? {}) as Record<string, unknown>;
  return new Map(
    Object.entries(going).map(([id, ids]) => [
      Number(id),
      asArray(ids).map(Number),
    ]),
  );
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
 * What a list's slot shows once `gone` went to the Corbeille: its own
 * photo `front` still, its badge counting `left` (its stack's photos the
 * server now shows; null when unknown: the badge stays as it was), or
 * nothing when `front` itself went. Never another photo of the stack: it
 * may not pass the list's own condition (its folder, its filter, its
 * dates), which only the server knows; the list shows it once reloaded.
 */
export function frontAfter(
  front: Photo,
  gone: readonly Photo["id"][],
  left: readonly Photo[] | null,
): Photo | null {
  const went = (id: Photo["id"]) => gone.some((g) => String(g) === String(id));
  if (went(front.id)) return null;
  const { stack: was, ...alone } = front;
  if (!was || left === null) return front;
  const count = left.filter((p) => !went(p.id)).length;
  return count >= 2 ? { ...alone, stack: { ...was, count } } : alone;
}

/** What « Vider » was confirmed for (EmptyDialog). */
export interface EmptyConfirmed {
  expected: number;
  cutoff: string;
  /** Everything up to `cutoff`, not only what has waited the Corbeille's days */
  all: boolean;
}

/** One request of « Vider »: its status and JSON body. */
export type EmptySend = (body: EmptyConfirmed) => Promise<{
  ok: boolean;
  data: Record<string, unknown>;
}>;

const sendEmpty: EmptySend = async (body) => {
  const response = await fetch("/api/trash/empty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: await readJsonObject(response) };
};

/**
 * « Vider »: a batch per request until none is left. Each request expects
 * exactly what the one before left (the server refuses any other count),
 * the first one what the owner confirmed. `onProgress`: photos erased so
 * far. Throws TrashError when the server refuses or nothing more can go.
 */
export async function emptyTrash(
  confirmed: EmptyConfirmed,
  onProgress: (done: number) => void,
  send: EmptySend = sendEmpty,
): Promise<number> {
  let done = 0;
  let expected = confirmed.expected;
  for (;;) {
    const { ok, data } = await send({ ...confirmed, expected });
    done += Number(data.purged ?? 0);
    onProgress(done);
    if (!ok || data.success !== true)
      throw new TrashError(
        asString(data.error) ?? "La corbeille n’a pas été vidée",
        asString(data.code),
      );
    const remaining = Number(data.remaining);
    if (remaining === 0) return done;
    // Nothing more erased: photos the purge leaves, or another purge's
    if (Number(data.purged) === 0)
      throw new TrashError(
        Number(data.left) > 0
          ? `${Number(data.left) > 1 ? `${Number(data.left)} photos restent` : "1 photo reste"} dans la corbeille : son fichier a été redéposé depuis, ou manque dans le stockage.`
          : "Une autre suppression est en cours. Réessayez dans un moment.",
      );
    expected = remaining;
  }
}
