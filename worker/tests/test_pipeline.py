"""The worker loop end to end, with a stand-in model and bucket: draining, stopping."""

from __future__ import annotations

import io
import threading

from PIL import Image

from blaze_worker import jobs
from blaze_worker.enqueue import enqueue_ids
from blaze_worker.faces import Analysis, ModelFiles
from blaze_worker.pipeline import Options, Worker
from blaze_worker.tasks import FacesAnalyzer

from .conftest import add_photos

WAIT = 30  # seconds: an upper bound for events, never a sleep


def tiny_jpeg() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 120, 150)).save(out, "JPEG")
    return out.getvalue()


class Bucket:
    def __init__(self) -> None:
        self.data = tiny_jpeg()

    def get(self, key: str) -> bytes:
        return self.data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        return self.data[start : end + 1]


class GatedModel:
    """Finds no face; with a gate, holds every photo until the gate opens."""

    def __init__(self, gated: bool) -> None:
        self.started = threading.Event()
        self.gate = threading.Event()
        if not gated:
            self.gate.set()

    def analyze(self, picture) -> Analysis:
        self.started.set()
        assert self.gate.wait(WAIT)
        return Analysis([], 0, 1, 0.0, 0.0, 0.0)


FILES = ModelFiles(pack=None, expression=None, embedding_model="emb", pipeline_model="pipe")  # type: ignore[arg-type]


def make_worker(pool, model: GatedModel, fetchers: int = 2) -> Worker:
    options = Options(
        owner="test",
        task="faces",
        concurrency=1,
        fetchers=fetchers,
        writers=2,
        lease_seconds=600,
        max_side=32,
        wait_seconds=0,
    )
    return Worker(options, pool, Bucket(), [FacesAnalyzer(model, FILES, 640)])  # type: ignore[arg-type]


def statuses(conn) -> dict[str, int]:
    return dict(conn.execute("SELECT status, count(*) FROM analysis_jobs GROUP BY 1").fetchall())


def run_in_thread(worker: Worker) -> threading.Thread:
    thread = threading.Thread(target=worker.run)
    thread.start()
    return thread


def test_drains_the_queue_and_exits(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)] * 12 + [("image/svg+xml", None)])
    enqueue_ids(conn, "faces", ids, pinned=False)

    counters = make_worker(pool, GatedModel(gated=False)).run()

    assert statuses(conn) == {"done": 12, "skipped": 1}
    assert (counters.done, counters.skipped) == (12, 1)
    stats = conn.execute(
        "SELECT stats FROM analysis_jobs WHERE status = 'done' LIMIT 1"
    ).fetchone()[0]
    assert stats["faces"] == 0 and stats["src"] == "image"


def test_first_stop_finishes_the_jobs_in_hand(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)] * 40)
    enqueue_ids(conn, "faces", ids, pinned=False)
    model = GatedModel(gated=True)
    worker = make_worker(pool, model)
    thread = run_in_thread(worker)
    assert model.started.wait(WAIT)

    worker.stop()
    model.gate.set()
    thread.join(WAIT)

    assert not thread.is_alive()
    counts = statuses(conn)
    assert "leased" not in counts
    # Everything claimed was finished; the rest was never touched
    assert counts["done"] == worker.counters.done > 0
    assert counts.get("queued", 0) == 40 - counts["done"]
    assert (
        conn.execute(
            "SELECT count(*) FROM analysis_jobs WHERE status = 'queued' AND attempts > 0"
        ).fetchone()[0]
        == 0
    )


def test_second_stop_gives_back_what_was_not_analyzed(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)] * 40)
    enqueue_ids(conn, "faces", ids, pinned=False)
    model = GatedModel(gated=True)
    worker = make_worker(pool, model, fetchers=4)
    thread = run_in_thread(worker)
    assert model.started.wait(WAIT)

    worker.stop()
    worker.stop()
    model.gate.set()
    thread.join(WAIT)

    assert not thread.is_alive()
    counts = statuses(conn)
    assert "leased" not in counts
    # The photo being analyzed was written; the ones waiting went back
    assert counts["done"] >= 1
    assert worker.counters.released >= 1
    assert (
        conn.execute(
            "SELECT count(*) FROM analysis_jobs WHERE status = 'queued' AND attempts > 0"
        ).fetchone()[0]
        == 0
    )


def test_waits_for_jobs_a_dead_worker_held_then_does_them(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)] * 3)
    enqueue_ids(conn, "faces", ids, pinned=False)
    # A worker claimed everything, then died: its leases run out
    dead = jobs.claim(conn, "dead", ["faces"], 3, 600)
    conn.execute("UPDATE analysis_jobs SET lease_expires_at = now() + interval '1 second'")
    assert jobs.leased(conn, ["faces"])[0] == 3

    make_worker(pool, GatedModel(gated=False)).run()

    assert statuses(conn) == {"done": 3}
    owners = {r[0] for r in conn.execute("SELECT lease_owner FROM analysis_jobs").fetchall()}
    assert owners == {"test"} and len(dead) == 3
