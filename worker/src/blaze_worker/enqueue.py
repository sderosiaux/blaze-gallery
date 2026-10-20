"""Puts photos in the analysis queue. Only images (mime image/*) of the gallery, newest years first.

Photos in folders out of the gallery (gallery.py) are never queued, even
by id. Re-running is harmless: a (photo, task) pair already queued or done
is left as it is, except a job closed because its folder was out of the
gallery, which --all queues again once the folder is back.
"""

from __future__ import annotations

from collections.abc import Sequence

from psycopg import Connection

from .gallery import EXCLUDED_NOTE, out_of_gallery

# Year taken, 0 when unknown: the queue serves recent years first
_PRIORITY = """
CASE WHEN p.metadata ->> 'date_taken' ~ '^[0-9]{4}'
     THEN substr(p.metadata ->> 'date_taken', 1, 4)::int ELSE 0 END
"""

# Explicitly requested photos go before any year
PINNED_PRIORITY = 100_000

# Images of the gallery (photos p)
_WANTED = f"p.mime_type LIKE 'image/%%' AND NOT {out_of_gallery()}"

# A job queued anew: nothing of the previous runs is kept
_RESET = """
status = 'queued', priority = EXCLUDED.priority, attempts = 0,
lease_owner = NULL, lease_expires_at = NULL, not_before = NULL,
last_error = NULL, model = NULL, stats = NULL,
started_at = NULL, finished_at = NULL, updated_at = now()
"""

# A spread of what the library holds, for measuring before running it all
_SAMPLE_STRATA: tuple[tuple[str, str, int], ...] = (
    ("jpeg 2020+", "p.mime_type = 'image/jpeg' AND {year} >= 2020", 170),
    ("jpeg 2010-2019", "p.mime_type = 'image/jpeg' AND {year} BETWEEN 2010 AND 2019", 160),
    ("jpeg before 2010", "p.mime_type = 'image/jpeg' AND {year} BETWEEN 1 AND 2009", 60),
    ("jpeg undated", "p.mime_type = 'image/jpeg' AND {year} = 0", 30),
    ("png", "p.mime_type = 'image/png'", 20),
    ("heic", "p.mime_type = 'image/heic'", 10),
    ("nef", "p.mime_type = 'image/x-nikon-nef'", 30),
    ("dng", "p.mime_type = 'image/x-adobe-dng'", 10),
    ("gif", "p.mime_type = 'image/gif'", 2),
    ("bmp", "p.mime_type = 'image/bmp'", 1),
    ("svg", "p.mime_type = 'image/svg+xml'", 1),
)


def _ready(ready: str | None) -> str:
    # Its LIKE wildcards are not placeholders
    return f"AND {ready.replace('%', '%%')}" if ready else ""


def enqueue_all(
    conn: Connection, task: str, model: str | None = None, ready: str | None = None
) -> int:
    """Every image of the gallery not queued yet; returns how many were queued.

    model: the task's current one (tags: the vocabulary's); a job done with
    another model is queued again. ready: a condition on photos p a photo
    must also meet to be queued (tags: it has an embedding).
    """
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %(task)s, {_PRIORITY} FROM photos p
            WHERE {_WANTED} {_ready(ready)}
            ON CONFLICT (photo_id, task) DO UPDATE SET {_RESET}
              WHERE (analysis_jobs.last_error = %(note)s
                     AND analysis_jobs.status IN ('skipped', 'done'))
                 OR (analysis_jobs.status = 'done'
                     AND analysis_jobs.model IS DISTINCT FROM %(model)s::text
                     AND %(model)s::text IS NOT NULL)
            """,
            {"task": task, "note": EXCLUDED_NOTE, "model": model},
        )
    return cursor.rowcount


def enqueue_ids(
    conn: Connection, task: str, photo_ids: Sequence[int], pinned: bool, ready: str | None = None
) -> int:
    """Given photos (images of the gallery only); pinned ones jump the queue, even if queued."""
    priority = str(PINNED_PRIORITY) if pinned else _PRIORITY
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %s, {priority} FROM photos p
            WHERE p.id = ANY(%s) AND {_WANTED} {_ready(ready)}
            ON CONFLICT (photo_id, task) DO UPDATE SET priority = EXCLUDED.priority
              WHERE analysis_jobs.status = 'queued' AND %s
            """,
            (task, list(photo_ids), pinned),
        )
    return cursor.rowcount


def enqueue_again(
    conn: Connection, task: str, photo_ids: Sequence[int], pinned: bool, ready: str | None = None
) -> int:
    """Given photos, queued anew even when done or failed (a new model or prompt).

    Images of the gallery only. A job under lease is left to its worker.
    """
    priority = str(PINNED_PRIORITY) if pinned else _PRIORITY
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %s, {priority} FROM photos p
            WHERE p.id = ANY(%s) AND {_WANTED} {_ready(ready)}
            ON CONFLICT (photo_id, task) DO UPDATE SET {_RESET}
              WHERE analysis_jobs.status <> 'leased'
            """,
            (task, list(photo_ids)),
        )
    return cursor.rowcount


def sample_ids(conn: Connection, size: int, exclude: Sequence[int], seed: str) -> list[int]:
    """A fixed spread of formats and years, scaled to `size` (same seed, same photos)."""
    total = sum(count for _, _, count in _SAMPLE_STRATA)
    ids: list[int] = []
    for _, condition, count in _SAMPLE_STRATA:
        want = max(1, round(count * size / total))
        rows = conn.execute(
            f"""
            SELECT p.id FROM photos p
            WHERE {condition.format(year=_PRIORITY)} AND NOT (p.id = ANY(%s))
              AND NOT {out_of_gallery()}
            ORDER BY md5(p.id::text || %s)
            LIMIT %s
            """,
            (list(exclude) + ids, seed, want),
        ).fetchall()
        ids.extend(row[0] for row in rows)
    return ids[:size]
