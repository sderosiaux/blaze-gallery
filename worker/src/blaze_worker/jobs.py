"""The analysis_jobs queue: claim, renew, finish, give back.

Every function takes a psycopg connection and runs its statement in its own
transaction (or in the caller's, for complete()). The rules live in SQL so
that any number of workers on any number of machines can share one table:

- claim: FOR UPDATE SKIP LOCKED, so two workers never get the same row;
- lease: a claimed row belongs to its owner until lease_expires_at; workers
  renew it while they work; an expired lease is put back in the queue by
  whoever claims next (or marked failed once attempts reaches max_attempts);
- complete/fail/skip only touch a row still leased by the caller, so a worker
  that lost its lease cannot overwrite the newer owner's result.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

# Retry delay after the n-th failed attempt: 1 min, 4 min, 16 min...
BACKOFF_BASE_SECONDS = 60


@dataclass(frozen=True)
class Job:
    id: int
    photo_id: int
    task: str
    attempts: int
    max_attempts: int
    s3_key: str
    mime_type: str
    size: int
    metadata: dict[str, Any] | None


def requeue_expired(conn: Connection) -> tuple[int, int]:
    """Leases whose owner stopped renewing them: queue again, or fail when out of attempts."""
    with conn.transaction():
        rows = conn.execute(
            """
            UPDATE analysis_jobs j SET
              status = CASE WHEN j.attempts >= j.max_attempts THEN 'failed' ELSE 'queued' END,
              last_error = 'lease of ' || coalesce(j.lease_owner, '?') || ' expired',
              lease_owner = CASE WHEN j.attempts >= j.max_attempts THEN j.lease_owner END,
              lease_expires_at = NULL,
              finished_at = CASE WHEN j.attempts >= j.max_attempts THEN now() END,
              updated_at = now()
            FROM (
              SELECT id FROM analysis_jobs
              WHERE status = 'leased' AND lease_expires_at < now()
              FOR UPDATE SKIP LOCKED
            ) expired
            WHERE j.id = expired.id
            RETURNING j.status
            """
        ).fetchall()
    failed = sum(1 for (status,) in rows if status == "failed")
    return len(rows) - failed, failed


def claim(
    conn: Connection,
    owner: str,
    tasks: Sequence[str],
    limit: int,
    lease_seconds: int,
) -> list[Job]:
    with conn.transaction():
        rows = conn.execute(
            """
            WITH picked AS (
              SELECT id FROM analysis_jobs
              WHERE status = 'queued' AND task = ANY(%(tasks)s)
                AND (not_before IS NULL OR not_before <= now())
              ORDER BY priority DESC, id
              LIMIT %(limit)s
              FOR UPDATE SKIP LOCKED
            )
            UPDATE analysis_jobs j SET
              status = 'leased',
              lease_owner = %(owner)s,
              lease_expires_at = now() + make_interval(secs => %(lease)s),
              attempts = j.attempts + 1,
              started_at = now(),
              updated_at = now()
            FROM picked, photos p
            WHERE j.id = picked.id AND p.id = j.photo_id
            RETURNING j.id, j.photo_id, j.task, j.attempts, j.max_attempts,
                      p.s3_key, p.mime_type, p.size, p.metadata, j.priority
            """,
            {"tasks": list(tasks), "limit": limit, "owner": owner, "lease": lease_seconds},
        ).fetchall()
    # RETURNING does not keep the ORDER BY of the CTE
    rows.sort(key=lambda r: (-r[9], r[0]))
    return [Job(*row[:9]) for row in rows]


def renew(conn: Connection, owner: str, job_ids: Sequence[int], lease_seconds: int) -> set[int]:
    """Extends the leases still held; returns their ids (a missing id was lost)."""
    if not job_ids:
        return set()
    with conn.transaction():
        rows = conn.execute(
            """
            UPDATE analysis_jobs SET
              lease_expires_at = now() + make_interval(secs => %(lease)s),
              updated_at = now()
            WHERE id = ANY(%(ids)s) AND status = 'leased' AND lease_owner = %(owner)s
            RETURNING id
            """,
            {"ids": list(job_ids), "owner": owner, "lease": lease_seconds},
        ).fetchall()
    return {row[0] for row in rows}


def complete(
    conn: Connection,
    owner: str,
    job_id: int,
    model: str | None,
    stats: dict[str, Any],
    status: str = "done",
    note: str | None = None,
) -> bool:
    """Marks the job done (or skipped). Runs in the caller's transaction, if any.

    False when the caller no longer holds the lease: the caller must then
    discard its result (roll back whatever it wrote with it).
    """
    if status not in ("done", "skipped"):
        raise ValueError(status)
    row = conn.execute(
        """
        UPDATE analysis_jobs SET
          status = %(status)s, model = %(model)s, stats = %(stats)s, last_error = %(note)s,
          lease_expires_at = NULL, not_before = NULL,
          finished_at = now(), updated_at = now()
        WHERE id = %(id)s AND status = 'leased' AND lease_owner = %(owner)s
        RETURNING id
        """,
        {
            "status": status,
            "model": model,
            "stats": Jsonb(stats),
            "note": note,
            "id": job_id,
            "owner": owner,
        },
    ).fetchone()
    return row is not None


def fail(conn: Connection, owner: str, job_id: int, error: str, permanent: bool) -> str | None:
    """Records a failed attempt; retried later unless permanent or out of attempts.

    Returns the new status (queued or failed), None when the lease was lost.
    """
    with conn.transaction():
        row = conn.execute(
            """
            UPDATE analysis_jobs SET
              status = CASE WHEN %(permanent)s OR attempts >= max_attempts
                            THEN 'failed' ELSE 'queued' END,
              last_error = left(%(error)s, 2000),
              lease_owner = CASE WHEN %(permanent)s OR attempts >= max_attempts
                                 THEN lease_owner END,
              lease_expires_at = NULL,
              not_before = CASE WHEN %(permanent)s OR attempts >= max_attempts THEN NULL
                                ELSE now() + make_interval(
                                  secs => %(base)s * power(4, attempts - 1)) END,
              finished_at = CASE WHEN %(permanent)s OR attempts >= max_attempts
                                 THEN now() END,
              updated_at = now()
            WHERE id = %(id)s AND status = 'leased' AND lease_owner = %(owner)s
            RETURNING status
            """,
            {
                "permanent": permanent,
                "error": error,
                "id": job_id,
                "owner": owner,
                "base": BACKOFF_BASE_SECONDS,
            },
        ).fetchone()
    return row[0] if row else None


def release(conn: Connection, owner: str, job_ids: Sequence[int]) -> int:
    """Gives back leases not worked on (graceful stop): the attempt does not count."""
    if not job_ids:
        return 0
    with conn.transaction():
        cursor = conn.execute(
            """
            UPDATE analysis_jobs SET
              status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
              attempts = greatest(attempts - 1, 0), started_at = NULL, updated_at = now()
            WHERE id = ANY(%(ids)s) AND status = 'leased' AND lease_owner = %(owner)s
            """,
            {"ids": list(job_ids), "owner": owner},
        )
    return cursor.rowcount


def leased(conn: Connection, tasks: Sequence[str]) -> tuple[int, float]:
    """Jobs held under a lease, and seconds until the first lease runs out.

    Asked by a worker holding nothing: every one of them belongs to another
    worker, or to a previous run of this one that died.
    """
    count, expires_in = conn.execute(
        """
        SELECT count(*),
               coalesce(extract(epoch FROM min(lease_expires_at) - now()), 0)::float
        FROM analysis_jobs
        WHERE status = 'leased' AND task = ANY(%s)
        """,
        (list(tasks),),
    ).fetchone()
    return count, expires_in
