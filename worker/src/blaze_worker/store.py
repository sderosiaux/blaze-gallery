"""Writes a result and closes its job in one transaction."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

from pgvector import HalfVector
from psycopg import Connection
from psycopg.types.json import Jsonb

from . import jobs

if TYPE_CHECKING:
    # Not at run time: the describe task would load InsightFace for nothing
    from .faces import DetectedFace


class LeaseLost(Exception):
    """Another worker holds the job now: this result is discarded."""


_INSERT = """
INSERT INTO faces (
  photo_id, box, landmarks, detect_rotation, det_score, width_px, height_px,
  sharpness, yaw, pitch, roll, eye_left_open, eye_right_open, mouth_open,
  expression, expression_scores, embedding, model
) VALUES (
  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
)
"""

# faces_extra: a detection overlapping a stored face this much is that face
OVERLAP_IOU = 0.3


def _values(photo_id: int, face: DetectedFace, embedding_model: str) -> tuple[Any, ...]:
    return (
        photo_id,
        list(face.box),
        list(face.landmarks),
        face.detect_rotation,
        face.det_score,
        face.width_px,
        face.height_px,
        face.sharpness,
        face.yaw,
        face.pitch,
        face.roll,
        face.eye_left_open,
        face.eye_right_open,
        face.mouth_open,
        face.expression,
        list(face.expression_scores),
        HalfVector(face.embedding),
        embedding_model,
    )


def save_faces(
    conn: Connection,
    owner: str,
    job: jobs.Job,
    job_model: str,
    embedding_model: str,
    faces: list[DetectedFace],
    stats: dict[str, Any],
) -> int:
    """Replaces this model's faces of the photo; returns how many were written.

    Faces the owner already named (person_id or assignment set) are never
    replaced: a re-run then keeps them and writes nothing new.
    """
    with conn.transaction():
        named = conn.execute(
            """
            SELECT count(*) FROM faces
            WHERE photo_id = %s AND model = %s
              AND (person_id IS NOT NULL OR assignment IS NOT NULL)
            """,
            (job.photo_id, embedding_model),
        ).fetchone()[0]
        written = 0 if named else len(faces)
        result = {**stats, "faces": written, **({"kept_named": named} if named else {})}
        if not jobs.complete(conn, owner, job.id, job_model, result):
            raise LeaseLost(job.id)
        if named:
            return 0
        conn.execute(
            "DELETE FROM faces WHERE photo_id = %s AND model = %s", (job.photo_id, embedding_model)
        )
        if faces:
            with conn.cursor() as cursor:
                cursor.executemany(
                    _INSERT, [_values(job.photo_id, face, embedding_model) for face in faces]
                )
    return written


def overlap(a: Sequence[float], b: Sequence[float]) -> float:
    """Intersection over union of two [x, y, w, h] boxes."""
    width = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
    height = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    shared = width * height
    return shared / (a[2] * a[3] + b[2] * b[3] - shared)


def add_faces(
    conn: Connection,
    owner: str,
    job: jobs.Job,
    job_model: str,
    embedding_model: str,
    faces: list[DetectedFace],
    stats: dict[str, Any],
) -> int:
    """Adds the faces no stored face of the photo overlaps; returns how many.

    The faces_extra pass: a second look at photos the faces task has done,
    with a more sensitive detector. It never updates or deletes a faces row,
    so whatever the owner decided (person_id, assignment, face_candidates)
    stays as it is. A detection whose box overlaps a stored face's (any
    model, IoU >= OVERLAP_IOU) is that face found again and is dropped. Both
    boxes are in the displayed orientation whatever their detect_rotation,
    and IoU does not change with the photo's aspect ratio, so fractions
    compare as they are. The ids added go in the job's stats: what to delete
    to undo the pass.
    """
    with conn.transaction():
        stored = [
            box
            for (box,) in conn.execute(
                "SELECT box FROM faces WHERE photo_id = %s", (job.photo_id,)
            ).fetchall()
        ]
        new = [f for f in faces if all(overlap(f.box, box) < OVERLAP_IOU for box in stored)]
        added = [
            conn.execute(
                _INSERT + " RETURNING id", _values(job.photo_id, face, embedding_model)
            ).fetchone()[0]
            for face in new
        ]
        result = {
            **stats,
            "faces_added": len(added),
            "faces_skipped_overlap": len(faces) - len(added),
            "added_ids": added,
        }
        if not jobs.complete(conn, owner, job.id, job_model, result):
            raise LeaseLost(job.id)
    return len(added)


def save_tags(
    conn: Connection,
    owner: str,
    claimed: Sequence[jobs.Job],
    rows: Sequence[tuple[int, str, float]],
    version: int,
    model: str,
) -> tuple[int, int]:
    """Replaces the tags of the claimed photos and closes their jobs; (jobs closed, rows written).

    A batch in one transaction. A photo whose job is no longer ours keeps
    the tags it had. Its other rows go, so a tag now under the floor, or no
    longer in the vocabulary, does not stay behind.
    """
    count: dict[int, int] = {}
    for photo_id, _, _ in rows:
        count[photo_id] = count.get(photo_id, 0) + 1
    with conn.transaction():
        held = jobs.complete_many(
            conn, owner, [(j.id, {"tags": count.get(j.photo_id, 0)}) for j in claimed], model
        )
        photos = {j.photo_id for j in claimed if j.id in held}
        kept = [row for row in rows if row[0] in photos]
        conn.execute("DELETE FROM photo_tags WHERE photo_id = ANY(%s)", (list(photos),))
        conn.execute(
            """
            INSERT INTO photo_tags (photo_id, tag, score, vocab_version)
            SELECT r.photo_id, r.tag, r.score, %s
            FROM unnest(%s::bigint[], %s::text[], %s::real[]) AS r(photo_id, tag, score)
            """,
            (version, [r[0] for r in kept], [r[1] for r in kept], [r[2] for r in kept]),
        )
    return len(held), len(kept)


def save_description(
    conn: Connection,
    owner: str,
    job: jobs.Job,
    model: str,
    data: dict[str, Any],
    stats: dict[str, Any],
) -> int:
    """Writes the photo's description, replacing an earlier one (whatever its model)."""
    with conn.transaction():
        if not jobs.complete(conn, owner, job.id, model, stats):
            raise LeaseLost(job.id)
        conn.execute(
            """
            INSERT INTO photo_descriptions (photo_id, model, data) VALUES (%s, %s, %s)
            ON CONFLICT (photo_id) DO UPDATE SET
              model = EXCLUDED.model, data = EXCLUDED.data, created_at = now()
            """,
            (job.photo_id, model, Jsonb(data)),
        )
    return 1


_GROUP_ROWS = """
INSERT INTO photo_groups (photo_id, group_id, rank, score, link, copy_of, measures, model)
SELECT * FROM unnest(%s::bigint[], %s::bigint[], %s::int[], %s::real[], %s::text[],
                     %s::bigint[], %s::jsonb[], %s::text[])
"""


def _insert_groups(conn: Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    """rows: (photo_id, group_id, rank, score, link, copy_of, measures, model)."""
    for start in range(0, len(rows), 5000):
        part = rows[start : start + 5000]
        columns = [list(column) for column in zip(*part, strict=True)]
        columns[6] = [Jsonb(m) for m in columns[6]]
        conn.execute(_GROUP_ROWS, columns)


def save_groups(
    conn: Connection,
    owner: str,
    results: Sequence[tuple[int, dict[str, Any]]],
    centres: Sequence[int],
    rows: Sequence[tuple[Any, ...]],
    model: str,
    guard: Callable[[Connection], None] | None = None,
) -> None:
    """Replaces the stacks around `centres` with `rows` and closes the batch's jobs, at once.

    The stacks a batch changes depend on every photo of it: when any job is
    no longer ours, nothing is written (LeaseLost) and the batch comes back
    to the queue with the expired leases. `guard` runs first in the
    transaction (the Grouper's lease and lock) and raises to write nothing.
    """
    with conn.transaction():
        if guard is not None:
            guard(conn)
        held = jobs.complete_many(conn, owner, results, model)
        if len(held) < len(results):
            raise LeaseLost(sorted({job_id for job_id, _ in results} - held))
        conn.execute("DELETE FROM photo_groups WHERE group_id = ANY(%s)", (list(centres),))
        _insert_groups(conn, rows)


def replace_groups(conn: Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    """Every stack replaced by `rows` (a rebuild); in the caller's transaction."""
    conn.execute("DELETE FROM photo_groups")
    _insert_groups(conn, rows)
