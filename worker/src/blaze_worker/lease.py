"""One holder at a time for a worker task (task_leases, db/schema.sql).

Taken when free or lapsed, renewed by a thread while the work goes on,
checked inside the transaction that writes, given back at the end. Every
call is one statement on a fresh connection: the pooler may hand each to
another server connection, which a lease does not mind.
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable

import psycopg

log = logging.getLogger("blaze_worker")


class LeaseHeld(Exception):
    """Another holder has the lease, or this one lost it."""


class Lease:
    def __init__(
        self,
        connect: Callable[[], psycopg.Connection],
        task: str,
        owner: str,
        seconds: int = 600,
    ) -> None:
        self.connect = connect
        self.task = task
        # Two runs under one --owner are still two holders
        self.owner = f"{owner}:{uuid.uuid4().hex[:8]}"
        self.seconds = seconds
        self._stop = threading.Event()
        self._renewer: threading.Thread | None = None

    def take(self) -> None:
        """The lease, or LeaseHeld with whoever has it."""
        with self.connect() as conn:
            got = conn.execute(
                """
                INSERT INTO task_leases (task, owner, expires_at)
                VALUES (%(task)s, %(owner)s, now() + %(seconds)s * interval '1 second')
                ON CONFLICT (task) DO UPDATE
                  SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at
                  WHERE task_leases.expires_at < now()
                RETURNING owner
                """,
                {"task": self.task, "owner": self.owner, "seconds": self.seconds},
            ).fetchone()
            if got is None:
                holder = conn.execute(
                    "SELECT owner, expires_at FROM task_leases WHERE task = %s", (self.task,)
                ).fetchone()
                raise LeaseHeld(f"{self.task} is held by {holder[0]} until {holder[1]}")
        self._stop.clear()
        self._renewer = threading.Thread(target=self._renew_until_stopped, daemon=True)
        self._renewer.start()

    def renew(self, conn: psycopg.Connection) -> bool:
        return (
            conn.execute(
                "UPDATE task_leases SET expires_at = now() + %s * interval '1 second'"
                " WHERE task = %s AND owner = %s RETURNING 1",
                (self.seconds, self.task, self.owner),
            ).fetchone()
            is not None
        )

    def _renew_until_stopped(self) -> None:
        while not self._stop.wait(self.seconds / 4):
            try:
                with self.connect() as conn:
                    if not self.renew(conn):
                        log.warning("lease %s lost: the write will refuse", self.task)
                        return
            except psycopg.Error:
                # The next renewal or the write's check tells
                log.warning("lease %s: renewal failed", self.task, exc_info=True)

    def check(self, conn: psycopg.Connection) -> None:
        """In the writing transaction: still ours and not lapsed, held until it commits."""
        held = conn.execute(
            "SELECT 1 FROM task_leases WHERE task = %s AND owner = %s AND expires_at > now()"
            " FOR UPDATE",
            (self.task, self.owner),
        ).fetchone()
        if held is None:
            raise LeaseHeld(f"the {self.task} lease was lost: nothing written")

    def release(self) -> None:
        self._stop.set()
        if self._renewer is not None:
            self._renewer.join(timeout=5)
        try:
            with self.connect() as conn:
                conn.execute(
                    "DELETE FROM task_leases WHERE task = %s AND owner = %s",
                    (self.task, self.owner),
                )
        except psycopg.Error:
            # It lapses by itself
            log.warning("lease %s: not given back", self.task, exc_info=True)
