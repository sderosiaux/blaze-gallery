"""Writes a result and closes its job in one transaction."""

from __future__ import annotations

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
                    _INSERT,
                    [
                        (
                            job.photo_id,
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
                        for face in faces
                    ],
                )
    return written


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
