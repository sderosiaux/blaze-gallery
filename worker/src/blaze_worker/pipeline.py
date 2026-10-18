"""Claim -> fetch/decode -> infer -> write, each stage on its own threads.

Downloads and decodes (I/O, GIL released by boto3 and Pillow) overlap with
inference (ONNX Runtime releases the GIL too) and with database writes, which
cost a few round trips to a remote Postgres. Bounded queues between stages
keep at most a few dozen photos in memory.

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
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool

from . import jobs
from .decode import Picture, Undecodable, Unsupported, load_picture
from .faces import Analysis, FaceModel, ModelFiles
from .storage import Originals
from .store import LeaseLost, save_faces

log = logging.getLogger("blaze_worker")

SUPPORTED_TASKS = ("faces",)


@dataclass(frozen=True)
class Options:
    owner: str
    tasks: tuple[str, ...]
    concurrency: int
    fetchers: int
    writers: int
    lease_seconds: int
    max_side: int
    det_size: int
    # 0: exit once the queue is empty; else poll that often
    wait_seconds: float
    reap_every_seconds: float = 60.0


@dataclass
class Counters:
    done: int = 0
    faces: int = 0
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
            f"done={self.done} faces={self.faces} skipped={self.skipped} failed={self.failed} "
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
        originals: Originals,
        files: ModelFiles,
        models: list[FaceModel],
    ) -> None:
        unknown = set(options.tasks) - set(SUPPORTED_TASKS)
        if unknown:
            raise SystemExit(f"unknown tasks: {', '.join(sorted(unknown))}")
        self.options = options
        self.pool = pool
        self.originals = originals
        self.files = files
        self.models = models
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

    def _fetch(self, job: jobs.Job) -> None:
        if self._abort.is_set():
            self._release(job)
            return
        try:
            picture = load_picture(self.originals, job.s3_key, job.mime_type, self.options.max_side)
        except Unsupported as error:
            self.counters.add(skipped=1)
            reason = str(error)
            self._close(
                job,
                lambda conn: jobs.complete(
                    conn, self.options.owner, job.id, None, {}, status="skipped", note=reason
                ),
            )
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

    def _infer_loop(self, model: FaceModel) -> None:
        while True:
            item = self._infer_q.get()
            if item is None:
                return
            job, picture = item
            if self._abort.is_set():
                self._release(job)
                continue
            try:
                analysis = model.analyze(picture)
            except Exception as error:
                log.exception("job %s: inference failed", job.id)
                self._fail(job, f"infer: {type(error).__name__}: {error}", permanent=False)
                continue
            self._record(job, picture, analysis)

    def _record(self, job: jobs.Job, picture: Picture, analysis: Analysis) -> None:
        height, width = picture.full.shape[:2]
        infer = analysis.detect_seconds + analysis.rotate_seconds + analysis.faces_seconds
        stats = {
            "src": picture.source,
            "w": width,
            "h": height,
            "bytes": picture.bytes_read,
            "ms_fetch": round(picture.fetch_seconds * 1000),
            "ms_decode": round(picture.decode_seconds * 1000),
            "ms_detect": round(analysis.detect_seconds * 1000),
            "ms_rotate": round(analysis.rotate_seconds * 1000),
            "ms_faces": round(analysis.faces_seconds * 1000),
            "passes": analysis.detect_passes,
            "rotation": analysis.rotation,
            "det": self.options.det_size,
        }
        counters = self.counters
        counters.add(
            bytes=picture.bytes_read,
            fetch_seconds=picture.fetch_seconds,
            decode_seconds=picture.decode_seconds,
            infer_seconds=infer,
        )

        def write(conn: Any) -> None:
            written = save_faces(
                conn,
                self.options.owner,
                job,
                self.files.pipeline_model,
                self.files.embedding_model,
                analysis.faces,
                stats,
            )
            counters.add(done=1, faces=written)

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
            threading.Thread(target=self._infer_loop, args=(model,), name=f"infer-{i}", daemon=True)
            for i, model in enumerate(self.models)
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
                    claimed = self._db(
                        lambda conn, room=room: jobs.claim(
                            conn,
                            options.owner,
                            options.tasks,
                            min(room, self._batch),
                            options.lease_seconds,
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
                    continue
                if busy:
                    with self._cond:
                        self._cond.wait(timeout=1.0)
                    continue
                if options.wait_seconds <= 0:
                    # Jobs leased by other workers may still come back (their
                    # worker died): stay until they are done or reclaimed.
                    held, expires_in = self._db(lambda conn: jobs.leased(conn, options.tasks))
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
