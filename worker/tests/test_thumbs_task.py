"""The thumbs task end to end on Postgres: colors written, thumbnails uploaded, pointed to."""

from __future__ import annotations

import io
import threading

import pytest
from PIL import Image
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from blaze_worker.enqueue import enqueue_ids
from blaze_worker.pipeline import Options, Worker
from blaze_worker.thumbnail import thumbnail_key
from blaze_worker.thumbs import ThumbsAnalyzer, ThumbsLoader

from .conftest import add_photos


def red_on_blue() -> bytes:
    image = Image.new("RGB", (1200, 900), (40, 90, 200))
    image.paste((210, 25, 30), (300, 225, 900, 675))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=92)
    return out.getvalue()


class Bucket:
    def __init__(self) -> None:
        self.data = red_on_blue()

    def get(self, key: str) -> bytes:
        return self.data

    def get_range(self, key: str, start: int, end: int) -> bytes:
        return self.data[start : end + 1]


class MemoryStore:
    """ThumbnailStore stand-in; on_put runs during the upload (to race it)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.on_put = None
        self._lock = threading.Lock()

    @property
    def location(self) -> str:
        return "memory"

    def path_for(self, s3_key: str, photo_id: int) -> str:
        return thumbnail_key("thumbnails", s3_key, photo_id)

    def put(self, path: str, data: bytes) -> None:
        if self.on_put:
            self.on_put(path)
        with self._lock:
            self.objects[path] = data


@pytest.fixture
def pool(schema):
    with ConnectionPool(
        schema, min_size=1, max_size=8, kwargs={"autocommit": True, "prepare_threshold": None}
    ) as connections:
        yield connections


def run(pool, store) -> Worker:
    options = Options(
        owner="test",
        task="thumbs",
        concurrency=2,
        fetchers=2,
        writers=2,
        lease_seconds=600,
        max_side=400,
        wait_seconds=0,
    )
    analyzers = [ThumbsAnalyzer(store) for _ in range(2)]  # type: ignore[arg-type]
    worker = Worker(options, pool, Bucket(), analyzers, ThumbsLoader(pool, store))  # type: ignore[arg-type]
    worker.run()
    return worker


def photo(conn, photo_id):
    return conn.execute(
        "SELECT s3_key, thumbnail_path, thumbnail_status FROM photos WHERE id = %s", (photo_id,)
    ).fetchone()


def job_stats(conn) -> dict[int, dict]:
    rows = conn.execute(
        "SELECT photo_id, stats FROM analysis_jobs WHERE task = 'thumbs' AND status = 'done'"
    ).fetchall()
    return dict(rows)


def test_uploads_thumbnails_writes_colors_and_keeps_existing_ones(conn, pool):
    jpeg = ("image/jpeg", None)
    fresh, kept, stale, svg = add_photos(conn, [jpeg, jpeg, jpeg, ("image/svg+xml", None)])
    key_kept = photo(conn, kept)[0]
    conn.execute(
        "UPDATE photos SET thumbnail_status = 'generated', thumbnail_path = %s WHERE id = %s",
        (thumbnail_key("thumbnails", key_kept, kept), kept),
    )
    # Generated, but somewhere the app no longer looks: redone
    conn.execute(
        "UPDATE photos SET thumbnail_status = 'generated', thumbnail_path = '/tmp/x' WHERE id = %s",
        (stale,),
    )
    enqueue_ids(conn, "thumbs", [fresh, kept, stale, svg], pinned=False)
    store = MemoryStore()

    worker = run(pool, store)

    assert (worker.counters.done, worker.counters.skipped) == (3, 1)
    # Colors for the three, plus two thumbnail pointers
    assert worker.counters.found == 5
    for photo_id in (fresh, stale):
        key, path, status = photo(conn, photo_id)
        assert status == "generated" and path == thumbnail_key("thumbnails", key, photo_id)
        thumb = Image.open(io.BytesIO(store.objects[path]))
        assert thumb.format == "JPEG" and thumb.size == (400, 300)
    assert photo(conn, kept)[1] == thumbnail_key("thumbnails", key_kept, kept)
    assert len(store.objects) == 2

    rows = conn.execute(
        "SELECT photo_id, hues, palette_hex, monochrome, model FROM photo_colors ORDER BY 1"
    ).fetchall()
    assert [r[0] for r in rows] == [fresh, kept, stale]
    for _, hues, palette, mono, model in rows:
        assert len(hues) == 12 and abs(sum(hues) - 1) < 1e-3
        # The red middle (25% of the frame) weighs more than its area
        assert hues[0] > 0.3 and hues[5] > 0.4
        assert len(palette) >= 2 and not mono and model == "lab-center-v1"
    stats = job_stats(conn)
    assert stats[fresh]["thumb"] == "uploaded" and stats[kept]["thumb"] == "kept"
    assert stats[fresh]["thumb_bytes"] > 0 and "ms_upload" in stats[fresh]
    assert (stats[fresh]["w"], stats[fresh]["h"]) == (1200, 900)


def test_rerun_replaces_the_colors_row(conn, pool):
    (only,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "thumbs", [only], pinned=False)
    run(pool, MemoryStore())
    conn.execute("UPDATE photo_colors SET hues = array_fill(0::real, ARRAY[12])")
    conn.execute("UPDATE analysis_jobs SET status = 'queued', lease_owner = NULL")

    run(pool, MemoryStore())

    hues = conn.execute("SELECT hues FROM photo_colors WHERE photo_id = %s", (only,)).fetchone()[0]
    assert abs(sum(hues) - 1) < 1e-3


def test_a_photo_turned_during_the_upload_is_queued_again_not_pointed_to(conn, pool):
    (turned,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "thumbs", [turned], pinned=False)
    store = MemoryStore()

    def owner_turns_it(path: str) -> None:
        with pool.connection() as other:
            other.execute(
                "UPDATE photos SET metadata = %s WHERE id = %s",
                (Jsonb({"user_rotation": 90}), turned),
            )

    store.on_put = owner_turns_it
    worker = run(pool, store)

    assert worker.counters.found == 0
    assert photo(conn, turned)[2] == "none"
    status, error, not_before = conn.execute(
        "SELECT status, last_error, not_before FROM analysis_jobs WHERE photo_id = %s", (turned,)
    ).fetchone()
    assert status == "queued" and error == "user_rotation changed" and not_before is not None
    assert conn.execute("SELECT count(*) FROM photo_colors").fetchone()[0] == 0


def test_colors_only_never_touches_thumbnails(conn, pool):
    (only,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "thumbs", [only], pinned=False)

    worker = run(pool, None)

    assert worker.counters.done == 1 and worker.counters.found == 1
    assert photo(conn, only)[1:] == (None, "none")
    assert job_stats(conn)[only]["thumb"] == "off"
    assert conn.execute("SELECT count(*) FROM photo_colors").fetchone()[0] == 1
