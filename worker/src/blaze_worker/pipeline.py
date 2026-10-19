"""Claim -> fetch/decode -> infer -> write, each stage on its own threads.

Downloads and decodes (I/O, GIL released by boto3 and Pillow) overlap with
inference (ONNX Runtime and MLX release the GIL too) and with database writes,
which cost a few round trips to a remote Postgres. Bounded queues between
stages keep at most a few dozen photos in memory.

One process runs one task: its analyzers (one per inference thread, see
tasks.py) say what the task finds in a photo and how that is written. A
task that reads originals differently (thumbs) brings its own loader.

Stop: the first stop() stops claiming and lets every claimed job finish; the
second one gives back the leases of jobs not yet analyzed and exits as soon
as the jobs being analyzed are written.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

import psycopg
from psycopg_pool import ConnectionPool

from . import jobs
from .decode import Picture, Reader, Undecodable, Unsupported, load_picture
from .gallery import EXCLUDED_NOTE
from .store import LeaseLost

log = logging.getLogger("blaze_worker")


class Result(Protocol):
    """What a model found in one photo, ready to be written."""

    @property
    def infer_seconds(self) -> float: ...

    def stats(self) -> dict[str, Any]:
        """Measurements for analysis_jobs.stats, next to the fetch and decode ones."""
        ...

    def save(self, conn: Any, owner: str, job: jobs.Job, stats: dict[str, Any]) -> int:
        """Writes the result and completes the job in one transaction; rows written.

        Raises LeaseLost when the job is no longer ours.
        """
        ...


class Analyzer(Protocol):
    """A model for the task, used by one inference thread at a time."""

    def analyze(self, job: jobs.Job, picture: Picture) -> Result: ...


class Rejected(Exception):
    """The model's output for this photo is unusable, and a new attempt would repeat it."""


class Loaded(Protocol):
    """An original as the task reads it: decode.Picture, unless the task has its own loader."""

    source: str
    bytes_read: int
    fetch_seconds: float
    decode_seconds: float

    @property
    def size(self) -> tuple[int, int]: ...


# (bucket, job) -> Loaded; raises Unsupported (skipped) or Undecodable (failed for good)
Loader = Callable[[Reader, jobs.Job], Loaded]


@dataclass(frozen=True)
class Options:
    owner: str
    task: str
    concurrency: int
    fetchers: int
    writers: int
    lease_seconds: int
    # Long side of Picture.small, the rendition the analyzers look at
    max_side: int
    # 0: exit once the queue is empty; else poll that often
    wait_seconds: float
    reap_every_seconds: float = 60.0
    # The task's extra claim condition (jobs.claim); with it, a short claim
    # means the rest is not ready yet: wait before asking again
    ready_sql: str | None = None
    # A task whose results make this one's jobs ready (embed follows thumbs):
    # with nothing to claim, wait while it is still making progress
    follow: str | None = None
    follow_poll_seconds: float = 60.0
    # The task still has work on photos out of the gallery (thumbs: their
    # thumbnails); else their jobs close as skipped before any download
    analyze_excluded: bool = False


@dataclass
class Counters:
    done: int = 0
    # Rows written (faces, descriptions)
    found: int = 0
    skipped: int = 0
    failed: int = 0
    released: int = 0
    lost: int = 0
    bytes: int = 0
    fetch_seconds: float = 0.0
    decode_seconds: float = 0.0
    infer_seconds: float = 0.0
    started: float = field(default_factory=time.monotonic)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, **amounts: float) -> None:
        with self._lock:
            for name, amount in amounts.items():
                setattr(self, name, getattr(self, name) + amount)

    def line(self) -> str:
        elapsed = max(time.monotonic() - self.started, 1e-6)
        n = max(self.done, 1)
        return (
            f"done={self.done} found={self.found} skipped={self.skipped} failed={self.failed} "
            f"rate={self.done / elapsed:.2f}/s fetch={self.fetch_seconds / n * 1000:.0f}ms "
            f"decode={self.decode_seconds / n * 1000:.0f}ms "
            f"infer={self.infer_seconds / n * 1000:.0f}ms "
            f"MB/photo={self.bytes / n / 1e6:.2f}"
        )


class Worker:
    def __init__(
        self,
        options: Options,
        pool: ConnectionPool,
        originals: Reader,
        analyzers: list[Analyzer],
        load: Loader | None = None,
    ) -> None:
        if len(analyzers) != options.concurrency:
            raise ValueError("one analyzer per inference thread")
        self.options = options
        self.pool = pool
        self.originals = originals
        self.analyzers = analyzers
        self.load: Loader = load or (
            lambda reader, job: load_picture(reader, job.s3_key, job.mime_type, options.max_side)
        )
        self.counters = Counters()

        self._inflight: dict[int, jobs.Job] = {}
        self._cond = threading.Condition()
        self._stopping = threading.Event()
        self._abort = threading.Event()
        self._infer_q: queue.Queue[tuple[jobs.Job, Picture] | None] = queue.Queue(
            maxsize=options.concurrency * 2
        )
        self._capacity = options.fetchers * 2 + options.concurrency * 3
        self._batch = max(4, options.fetchers)

    # -- control ----------------------------------------------------------

    def stop(self) -> None:
        if self._stopping.is_set():
            log.warning("second stop: giving back leases of jobs not yet analyzed")
            self._abort.set()
        else:
            log.info("stopping: no new claims, finishing the jobs in hand")
            self._stopping.set()
        with self._cond:
            self._cond.notify_all()

    # -- stages -----------------------------------------------------------

    def _finish(self, job_id: int) -> None:
        with self._cond:
            self._inflight.pop(job_id, None)
            self._cond.notify_all()

    def _db(self, action: Callable[[Any], Any]) -> Any:
        with self.pool.connection() as conn:
            return action(conn)

    def _release(self, job: jobs.Job) -> None:
        try:
            count = self._db(lambda conn: jobs.release(conn, self.options.owner, [job.id]))
            self.counters.add(released=count)
        finally:
            self._finish(job.id)

    def _close(self, job: jobs.Job, write: Callable[[Any], None]) -> None:
        """Runs a write for the job on a writer thread, then forgets the job."""

        def run() -> None:
            try:
                self._db(write)
            except LeaseLost:
                self.counters.add(lost=1)
                log.warning("job %s: lease lost, result discarded", job.id)
            except Exception:
                # The lease expires and the job comes back to the queue
                log.exception("job %s: could not record the result", job.id)
            finally:
                self._finish(job.id)

        self._writers.submit(run)

    def _fail(self, job: jobs.Job, error: str, permanent: bool) -> None:
        log.warning("job %s photo %s: %s", job.id, job.photo_id, error)

        def write(conn: Any) -> None:
            status = jobs.fail(conn, self.options.owner, job.id, error, permanent)
            if status == "failed":
                self.counters.add(failed=1)

        self._close(job, write)

    def _skip(self, job: jobs.Job, reason: str) -> None:
        self.counters.add(skipped=1)
        self._close(
            job,
            lambda conn: jobs.complete(
                conn, self.options.owner, job.id, None, {}, status="skipped", note=reason
            ),
        )

    def _fetch(self, job: jobs.Job) -> None:
        if self._abort.is_set():
            self._release(job)
            return
        if job.excluded and not self.options.analyze_excluded:
            self._skip(job, EXCLUDED_NOTE)
            return
        try:
            picture = self.load(self.originals, job)
        except Unsupported as error:
            self._skip(job, str(error))
            return
        except Undecodable as error:
            self._fail(job, f"undecodable: {error}", permanent=True)
            return
        except Exception as error:
            self._fail(job, f"fetch: {type(error).__name__}: {error}", permanent=False)
            return
        while not self._abort.is_set():
            try:
                self._infer_q.put((job, picture), timeout=0.5)
                return
            except queue.Full:
                continue
        self._release(job)

    def _infer_loop(self, analyzer: Analyzer) -> None:
        while True:
            item = self._infer_q.get()
            if item is None:
                return
            job, picture = item
            if self._abort.is_set():
                self._release(job)
                continue
            try:
                result = analyzer.analyze(job, picture)
            except Rejected as error:
                self._fail(job, f"rejected: {error}", permanent=True)
                continue
            except Exception as error:
                log.exception("job %s: inference failed", job.id)
                self._fail(job, f"infer: {type(error).__name__}: {error}", permanent=False)
                continue
            self._record(job, picture, result)

    def _record(self, job: jobs.Job, picture: Picture, result: Result) -> None:
        width, height = picture.size
        stats = {
            "src": picture.source,
            "w": width,
            "h": height,
            "bytes": picture.bytes_read,
            "ms_fetch": round(picture.fetch_seconds * 1000),
            "ms_decode": round(picture.decode_seconds * 1000),
            "ms_infer": round(result.infer_seconds * 1000),
            **result.stats(),
        }
        counters = self.counters
        counters.add(
            bytes=picture.bytes_read,
            fetch_seconds=picture.fetch_seconds,
            decode_seconds=picture.decode_seconds,
            infer_seconds=result.infer_seconds,
        )

        def write(conn: Any) -> None:
            written = result.save(conn, self.options.owner, job, stats)
            counters.add(done=1, found=written)

        self._close(job, write)

    def _heartbeat(self) -> None:
        interval = self.options.lease_seconds / 3
        while not self._done.wait(interval):
            with self._cond:
                ids = list(self._inflight)
            if not ids:
                continue
            try:
                held = self._db(
                    lambda conn, ids=ids: jobs.renew(
                        conn, self.options.owner, ids, self.options.lease_seconds
                    )
                )
                lost = set(ids) - held
                if lost:
                    log.warning("leases lost for jobs %s", sorted(lost))
            except Exception:
                log.exception("lease renewal failed")

    def _progress(self) -> None:
        while not self._done.wait(30):
            log.info("%s inflight=%d", self.counters.line(), len(self._inflight))

    # -- main loop --------------------------------------------------------

    def run(self) -> Counters:
        options = self.options
        self._done = threading.Event()
        self._writers = ThreadPoolExecutor(options.writers, thread_name_prefix="write")
        fetchers = ThreadPoolExecutor(options.fetchers, thread_name_prefix="fetch")
        inference = [
            threading.Thread(
                target=self._infer_loop, args=(analyzer,), name=f"infer-{i}", daemon=True
            )
            for i, analyzer in enumerate(self.analyzers)
        ]
        background = [
            threading.Thread(target=self._heartbeat, name="heartbeat", daemon=True),
            threading.Thread(target=self._progress, name="progress", daemon=True),
        ]
        for thread in inference + background:
            thread.start()

        last_reap = 0.0
        try:
            while not self._stopping.is_set():
                with self._cond:
                    room = self._capacity - len(self._inflight)
                    busy = bool(self._inflight)
                if room < self._batch // 2 + 1:
                    with self._cond:
                        self._cond.wait(timeout=1.0)
                    continue
                try:
                    if time.monotonic() - last_reap > options.reap_every_seconds:
                        requeued, failed = self._db(jobs.requeue_expired)
                        if requeued or failed:
                            log.info("expired leases: %d requeued, %d failed", requeued, failed)
                        last_reap = time.monotonic()
                    asked = min(room, self._batch)
                    claimed = self._db(
                        lambda conn, asked=asked: jobs.claim(
                            conn,
                            options.owner,
                            [options.task],
                            asked,
                            options.lease_seconds,
                            options.ready_sql,
                        )
                    )
                except psycopg.OperationalError:
                    # Database unreachable for a moment: what is in hand goes on
                    log.exception("claim failed, retrying")
                    self._stopping.wait(5)
                    continue
                if claimed:
                    with self._cond:
                        for job in claimed:
                            self._inflight[job.id] = job
                    for job in claimed:
                        fetchers.submit(self._fetch, job)
                    if options.ready_sql and len(claimed) < asked:
                        # Each claim scans the rows not ready yet: not in a loop
                        self._stopping.wait(min(options.wait_seconds, 10.0))
                    continue
                if busy:
                    with self._cond:
                        self._cond.wait(timeout=1.0)
                    continue
                if options.follow and self._db(lambda conn: jobs.progressing(conn, options.follow)):
                    log.info("nothing ready, %s still running: waiting", options.follow)
                    self._stopping.wait(options.follow_poll_seconds)
                    continue
                if options.wait_seconds <= 0:
                    # Jobs leased by other workers may still come back (their
                    # worker died): stay until they are done or reclaimed.
                    held, expires_in = self._db(lambda conn: jobs.leased(conn, [options.task]))
                    if not held:
                        log.info("queue empty")
                        break
                    log.info(
                        "queue empty, %d jobs still leased (other or crashed workers): waiting",
                        held,
                    )
                    last_reap = 0.0
                    self._stopping.wait(min(max(expires_in, 1.0), 30.0))
                    continue
                self._stopping.wait(options.wait_seconds)

            # Finish what was claimed (or, after a second stop, give it back)
            with self._cond:
                while self._inflight:
                    self._cond.wait(timeout=1.0)
        finally:
            fetchers.shutdown(wait=True)
            for _ in inference:
                self._infer_q.put(None)
            for thread in inference:
                thread.join()
            self._writers.shutdown(wait=True)
            leftover = list(self._inflight)
            if leftover:
                self.counters.add(
                    released=self._db(lambda conn: jobs.release(conn, options.owner, leftover))
                )
            self._done.set()
        log.info("finished: %s", self.counters.line())
        return self.counters
