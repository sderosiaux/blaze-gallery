"""Puts photos in the analysis queue. Only images (mime image/*), newest years first.

Re-running is harmless: a (photo, task) pair already queued or done is left
as it is.
"""

from __future__ import annotations

from collections.abc import Sequence

from psycopg import Connection

# Year taken, 0 when unknown: the queue serves recent years first
_PRIORITY = """
CASE WHEN p.metadata ->> 'date_taken' ~ '^[0-9]{4}'
     THEN substr(p.metadata ->> 'date_taken', 1, 4)::int ELSE 0 END
"""

# Explicitly requested photos go before any year
PINNED_PRIORITY = 100_000

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


def enqueue_all(conn: Connection, task: str) -> int:
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %s, {_PRIORITY} FROM photos p
            WHERE p.mime_type LIKE 'image/%%'
            ON CONFLICT (photo_id, task) DO NOTHING
            """,
            (task,),
        )
    return cursor.rowcount


def enqueue_ids(conn: Connection, task: str, photo_ids: Sequence[int], pinned: bool) -> int:
    """Given photos (images only); pinned ones jump the queue, even if already queued."""
    priority = str(PINNED_PRIORITY) if pinned else _PRIORITY
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %s, {priority} FROM photos p
            WHERE p.id = ANY(%s) AND p.mime_type LIKE 'image/%%'
            ON CONFLICT (photo_id, task) DO UPDATE SET priority = EXCLUDED.priority
              WHERE analysis_jobs.status = 'queued' AND %s
            """,
            (task, list(photo_ids), pinned),
        )
    return cursor.rowcount


def enqueue_again(conn: Connection, task: str, photo_ids: Sequence[int], pinned: bool) -> int:
    """Given photos, queued anew even when done or failed (a new model or prompt).

    A job under lease is left to its worker.
    """
    priority = str(PINNED_PRIORITY) if pinned else _PRIORITY
    with conn.transaction():
        cursor = conn.execute(
            f"""
            INSERT INTO analysis_jobs (photo_id, task, priority)
            SELECT p.id, %s, {priority} FROM photos p
            WHERE p.id = ANY(%s) AND p.mime_type LIKE 'image/%%'
            ON CONFLICT (photo_id, task) DO UPDATE SET
              status = 'queued', priority = EXCLUDED.priority, attempts = 0,
              lease_owner = NULL, lease_expires_at = NULL, not_before = NULL,
              last_error = NULL, model = NULL, stats = NULL,
              started_at = NULL, finished_at = NULL, updated_at = now()
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
            ORDER BY md5(p.id::text || %s)
            LIMIT %s
            """,
            (list(exclude) + ids, seed, want),
        ).fetchall()
        ids.extend(row[0] for row in rows)
    return ids[:size]
