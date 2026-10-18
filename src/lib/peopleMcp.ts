import type { PhotoMetadata } from "@/types";
import { getPhoto, query } from "./database";
import { faceCropUrl, isOwned, takenOn, type DateSource } from "./faces";
import {
  faceDetail,
  findPersonByName,
  getPerson,
  listPeople,
  PeopleError,
  personPhotos,
  photoFace,
  photoFaceRows,
  type FaceDetail,
  type PersonPhoto,
  type PersonRow,
  type PhotoFace,
} from "./people";
import { displayUrl, thumbnailUrl } from "./photoUrls";
import { rotatedSize, userRotation } from "./rotation";

/**
 * What the MCP tools answer about people: plain JSON for another program,
 * every field documented in the tool schemas (src/app/api/mcp/route.ts).
 */

export async function mcpListPeople() {
  const people = await listPeople();
  return {
    people: people.map((p) => ({
      person_id: p.id,
      name: p.name,
      birth_date: p.birth_date,
      photo_count: p.photo_count,
      pending_candidates: p.pending_count,
      cover_face_crop_url:
        p.cover_face_id === null ? null : faceCropUrl(p.cover_face_id),
    })),
    count: people.length,
  };
}

export async function resolvePerson(ref: string | number): Promise<PersonRow> {
  const person =
    typeof ref === "number"
      ? await getPerson(ref)
      : /^\d+$/.test(ref.trim())
        ? await getPerson(Number(ref.trim()))
        : await findPersonByName(ref);
  if (!person) throw new PeopleError(`No person "${String(ref)}"`, 404);
  return person;
}

/** photo_descriptions rows (task 'describe'): what the image shows, by photo id. */
async function descriptionsOf(
  photoIds: number[],
): Promise<Map<number, Record<string, unknown>>> {
  if (photoIds.length === 0) return new Map();
  const result = await query<{
    photo_id: number;
    model: string;
    data: Record<string, unknown>;
  }>(
    `SELECT photo_id::int AS photo_id, model, data FROM photo_descriptions
     WHERE photo_id = ANY($1::bigint[])`,
    [photoIds],
  );
  return new Map(
    result.rows.map((row) => [row.photo_id, { ...row.data, model: row.model }]),
  );
}

interface Cursor {
  taken: string | null;
  id: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeCursor(text: string): Cursor | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(text, "base64url").toString("utf8"),
    );
    if (typeof value !== "object" || value === null) return null;
    const { taken, id } = value as Record<string, unknown>;
    if (
      typeof id !== "number" ||
      !(taken === null || typeof taken === "string")
    )
      return null;
    return { taken, id };
  } catch {
    return null;
  }
}

/** Oldest first, undated last: the order of personPhotos. */
function after(photo: PersonPhoto, cursor: Cursor): boolean {
  if (photo.taken === cursor.taken) return photo.id > cursor.id;
  if (cursor.taken === null) return false;
  if (photo.taken === null) return true;
  return photo.taken > cursor.taken;
}

interface PhotoShape {
  photo_id: number;
  filename: string;
  folder_path: string | null;
  taken: string | null;
  date_source: DateSource | null;
  exif_date_taken: string | null;
  gps: { latitude: number; longitude: number } | null;
  width: number | null;
  height: number | null;
  user_rotation: number;
  urls: { thumbnail: string; display: string };
}

function photoShape(
  photo: {
    id: number;
    filename: string;
    metadata?: PhotoMetadata | null;
  },
  folderPath: string | null,
): PhotoShape {
  const metadata = photo.metadata ?? undefined;
  const rotation = userRotation(metadata);
  const dims = metadata?.dimensions
    ? rotatedSize(metadata.dimensions, rotation)
    : null;
  const { taken, source } = takenOn(metadata?.date_taken, folderPath);
  const location = metadata?.location;
  return {
    photo_id: photo.id,
    filename: photo.filename,
    folder_path: folderPath,
    taken,
    date_source: source,
    exif_date_taken: metadata?.date_taken ?? null,
    gps:
      location &&
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude)
        ? { latitude: location.latitude, longitude: location.longitude }
        : null,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    user_rotation: rotation,
    urls: {
      thumbnail: thumbnailUrl(photo.id, undefined, rotation),
      display: displayUrl(photo.id, undefined, rotation),
    },
  };
}

export interface PersonPhotosQuery {
  person: string | number;
  from?: string;
  to?: string;
  limit: number;
  cursor?: string;
}

export async function mcpPersonPhotos(q: PersonPhotosQuery) {
  const person = await resolvePerson(q.person);
  const cursor = q.cursor === undefined ? null : decodeCursor(q.cursor);
  if (q.cursor !== undefined && cursor === null)
    throw new PeopleError("cursor is not one this tool returned", 422);
  // "to" as a day includes the whole day
  const to = q.to && q.to.length === 10 ? `${q.to}T23:59:59.999Z` : q.to;
  const all = (await personPhotos(person.id)).filter(
    (p) =>
      (!q.from || (p.taken !== null && p.taken >= q.from)) &&
      (!to || (p.taken !== null && p.taken <= to)),
  );
  const rest = cursor ? all.filter((p) => after(p, cursor)) : all;
  const page = rest.slice(0, q.limit);
  const last = page[page.length - 1];

  const [rows, descriptions] = await Promise.all([
    photoFaceRows(page.map((p) => p.id)),
    descriptionsOf(page.flatMap((p) => [p.id, ...p.copies])),
  ]);
  const byPhoto = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byPhoto.get(row.photo_id) ?? [];
    list.push(row);
    byPhoto.set(row.photo_id, list);
  }

  const photos = page.map((photo) => {
    const faces = byPhoto.get(photo.id) ?? [];
    const own = faces.find((f) => f.face_id === photo.face_id);
    const others = faces.filter((f) => f.face_id !== photo.face_id);
    const named = others.filter(
      (f) => f.person_id !== null && isOwned(f.assignment),
    );
    const face: (FaceDetail & Record<string, unknown>) | null = own
      ? {
          ...faceDetail(own, photo.metadata),
          assignment: photo.assignment,
          similarity: photo.similarity,
          decided_by: photo.decided_by,
        }
      : null;
    return {
      ...photoShape(photo, photo.folder_path),
      face,
      others: {
        named: named.map((f) => ({
          person_id: f.person_id,
          name: f.person_name,
          face_id: f.face_id,
        })),
        unknown_count: others.length - named.length,
      },
      faces_count: faces.length,
      copies: photo.copies,
      // A copy is the same file: its description holds for this one
      description:
        [photo.id, ...photo.copies]
          .map((id) => descriptions.get(id))
          .find((d) => d !== undefined) ?? null,
    };
  });

  return {
    person: {
      person_id: person.id,
      name: person.name,
      birth_date: person.birth_date,
    },
    total: all.length,
    returned: photos.length,
    next_cursor:
      last && rest.length > page.length
        ? encodeCursor({ taken: last.taken, id: last.id })
        : null,
    photos,
  };
}

export async function mcpPhotoFaces(photoId: number) {
  const photo = await getPhoto(photoId);
  if (!photo) throw new PeopleError(`Photo ${String(photoId)} not found`, 404);
  const [rows, folder, job, descriptions] = await Promise.all([
    photoFaceRows([photoId]),
    query<{ path: string }>(
      "SELECT f.path FROM folders f JOIN photos p ON p.folder_id = f.id WHERE p.id = $1",
      [photoId],
    ),
    query<{ status: string }>(
      "SELECT status FROM analysis_jobs WHERE photo_id = $1 AND task = 'faces'",
      [photoId],
    ),
    descriptionsOf([photoId]),
  ]);
  const faces = rows.map((row) => {
    const face: PhotoFace = photoFace(row, photo.metadata);
    return {
      ...face,
      person: face.person
        ? { person_id: face.person.id, name: face.person.name }
        : null,
    };
  });
  return {
    ...photoShape(
      {
        id: Number(photo.id),
        filename: photo.filename,
        metadata: photo.metadata,
      },
      folder.rows[0]?.path ?? null,
    ),
    analyzed: job.rows[0]?.status === "done",
    description: descriptions.get(photoId) ?? null,
    faces,
  };
}
