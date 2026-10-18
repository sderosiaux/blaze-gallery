"""The embed task and the query embedder on Postgres, with a stand-in for the SigLIP2 towers."""

from __future__ import annotations

import http.client
import io
import json
import threading
import time

import numpy as np
import pytest
from PIL import Image

from blaze_worker.embed import EmbedAnalyzer, EmbedLoader, ready_sql
from blaze_worker.embedder import EmbedderServer, TokenBucket
from blaze_worker.enqueue import enqueue_ids
from blaze_worker.pipeline import Options, Worker
from blaze_worker.siglip import DIM, MODEL, clean_text

from .conftest import add_photos


def jpeg(color: tuple[int, int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (400, 300), color).save(out, "JPEG")
    return out.getvalue()


class FakeTower:
    """Mean color spread over the vector: different pictures, different vectors."""

    def embed(self, data: bytes) -> np.ndarray:
        r, g, b = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).mean(axis=(0, 1))
        vector = np.tile(np.array([r + 1, g + 1, b + 1], np.float32), DIM // 3)
        return vector / np.linalg.norm(vector)

    def __call__(self, text: str) -> np.ndarray:
        return self.embed(jpeg((len(text) * 10 % 255, 0, 0)))


class Thumbnails:
    """ThumbnailStore stand-in: get only (the embed task never writes)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.reads: list[str] = []

    def get(self, path: str) -> bytes | None:
        self.reads.append(path)
        return self.objects.get(path)


class NoOriginals:
    def get(self, key: str) -> bytes:
        raise AssertionError(f"read the original {key}")

    def get_range(self, key: str, start: int, end: int) -> bytes:
        raise AssertionError(f"read the original {key}")


def run(pool, store) -> Worker:
    options = Options(
        owner="test",
        task="embed",
        concurrency=2,
        fetchers=2,
        writers=2,
        lease_seconds=600,
        max_side=400,
        wait_seconds=0,
        ready_sql=ready_sql("thumbnails"),
    )
    analyzers = [EmbedAnalyzer(FakeTower()) for _ in range(2)]  # type: ignore[arg-type]
    worker = Worker(options, pool, NoOriginals(), analyzers, EmbedLoader(pool, store))  # type: ignore[arg-type]
    worker.run()
    return worker


def generated(conn, photo_id: int, path: str) -> None:
    conn.execute(
        "UPDATE photos SET thumbnail_status = 'generated', thumbnail_path = %s WHERE id = %s",
        (path, photo_id),
    )


def job(conn, photo_id: int) -> tuple:
    return conn.execute(
        "SELECT status, attempts, model, not_before IS NOT NULL, last_error FROM analysis_jobs "
        "WHERE task = 'embed' AND photo_id = %s",
        (photo_id,),
    ).fetchone()


def test_embeds_from_the_thumbnail_and_leaves_photos_without_one_queued(conn, pool):
    red, blue, waiting, missing, local = add_photos(conn, [("image/jpeg", None)] * 5)
    store = Thumbnails()
    for photo_id, color in ((red, (220, 20, 20)), (blue, (20, 20, 220))):
        generated(conn, photo_id, f"thumbnails/{photo_id}.jpeg")
        store.objects[f"thumbnails/{photo_id}.jpeg"] = jpeg(color)
    # Generated says the app, but the object is not there
    generated(conn, missing, f"thumbnails/{missing}.jpeg")
    # Generated once on the app's disk: the thumbs pass redoes it first
    generated(conn, local, f"/tmp/thumbnails/{local}.jpeg")
    enqueue_ids(conn, "embed", [red, blue, waiting, missing, local], pinned=False)
    before = conn.execute("SELECT md5(array_agg(p ORDER BY id)::text) FROM photos p").fetchone()

    worker = run(pool, store)

    assert worker.counters.done == 2
    rows = dict(
        conn.execute("SELECT photo_id, embedding FROM photo_embeddings ORDER BY 1").fetchall()
    )
    assert set(rows) == {red, blue}
    vectors = {k: np.asarray(v.to_list(), np.float32) for k, v in rows.items()}
    assert all(len(v) == DIM and abs(np.linalg.norm(v) - 1) < 1e-2 for v in vectors.values())
    assert float(vectors[red] @ vectors[blue]) < 0.9
    assert conn.execute("SELECT DISTINCT model FROM photo_embeddings").fetchall() == [(MODEL,)]
    assert job(conn, red)[:3] == ("done", 1, MODEL)
    # No thumbnail yet: never claimed, waits for the thumbs pass
    assert job(conn, waiting) == ("queued", 0, None, False, None)
    assert job(conn, local) == ("queued", 0, None, False, None)
    # Thumbnail object gone: an attempt, retried later
    status, attempts, _, backoff, error = job(conn, missing)
    assert (status, attempts, backoff) == ("queued", 1, True) and "no object" in error
    assert f"thumbnails/{waiting}.jpeg" not in store.reads
    # The task never writes photos
    after = conn.execute("SELECT md5(array_agg(p ORDER BY id)::text) FROM photos p").fetchone()
    assert before == after


def test_a_photo_is_claimed_once_the_thumbs_pass_reaches_it(conn, pool):
    (later,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "embed", [later], pinned=False)
    store = Thumbnails()
    assert run(pool, store).counters.done == 0

    generated(conn, later, "thumbnails/later.jpeg")
    store.objects["thumbnails/later.jpeg"] = jpeg((0, 200, 0))

    assert run(pool, store).counters.done == 1
    assert job(conn, later)[0] == "done"


def test_ready_sql_escapes_the_prefix():
    assert "LIKE 'thumbnails/%'" in ready_sql("/thumbnails/")
    assert "LIKE 'my\\_thumbs/%'" in ready_sql("my_thumbs")
    assert "LIKE 'o''brien/%'" in ready_sql("o'brien")


def test_clean_text_is_open_clip_canonicalize():
    assert clean_text("  Un  Gâteau d'anniversaire ! ") == "un gâteau danniversaire"
    assert clean_text("la plage au coucher du soleil") == "la plage au coucher du soleil"


def test_follow_waits_while_thumbs_runs_then_exits(conn, pool):
    (later,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "embed", [later], pinned=False)
    enqueue_ids(conn, "thumbs", [later], pinned=False)
    # thumbs finished a job a moment ago: it is running
    (done,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "thumbs", [done], pinned=False)
    conn.execute(
        "UPDATE analysis_jobs SET status = 'done', finished_at = now() "
        "WHERE task = 'thumbs' AND photo_id = %s",
        (done,),
    )
    options = Options(
        owner="test",
        task="embed",
        concurrency=1,
        fetchers=1,
        writers=1,
        lease_seconds=600,
        max_side=400,
        wait_seconds=0,
        ready_sql=ready_sql("thumbnails"),
        follow="thumbs",
        follow_poll_seconds=0.2,
    )
    store = Thumbnails()
    worker = Worker(
        options, pool, NoOriginals(), [EmbedAnalyzer(FakeTower())], EmbedLoader(pool, store)
    )  # type: ignore[arg-type]
    running = threading.Thread(target=worker.run)
    running.start()

    # The thumbs pass reaches the photo: embedded without a restart
    time.sleep(0.5)
    assert running.is_alive()
    generated(conn, later, "thumbnails/later.jpeg")
    store.objects["thumbnails/later.jpeg"] = jpeg((0, 0, 200))
    conn.execute(
        "UPDATE analysis_jobs SET status = 'done', finished_at = now() WHERE task = 'thumbs'"
    )

    running.join(timeout=10)
    assert not running.is_alive(), "still waiting once thumbs has nothing left"
    assert worker.counters.done == 1


def test_follow_gives_up_on_a_thumbs_pass_that_stopped(conn, pool):
    (stuck,) = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "embed", [stuck], pinned=False)
    enqueue_ids(conn, "thumbs", [stuck], pinned=False)
    options = Options(
        owner="test",
        task="embed",
        concurrency=1,
        fetchers=1,
        writers=1,
        lease_seconds=600,
        max_side=400,
        wait_seconds=0,
        ready_sql=ready_sql("thumbnails"),
        follow="thumbs",
        follow_poll_seconds=30,
    )
    worker = Worker(
        options, pool, NoOriginals(), [EmbedAnalyzer(FakeTower())], EmbedLoader(pool, Thumbnails())
    )  # type: ignore[arg-type]
    began = time.monotonic()
    worker.run()
    # Queued thumbs but none finished lately: no worker runs it, nothing to wait for
    assert time.monotonic() - began < 5


class FakeTextTower:
    def __init__(self) -> None:
        self.tower = FakeTower()

    def embed(self, text: str) -> np.ndarray:
        return self.tower(text)


TOKEN = "t" * 40


@pytest.fixture
def embedder():
    stopping = threading.Event()
    server = EmbedderServer(("127.0.0.1", 0), FakeTextTower(), TOKEN)
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    yield server
    stopping.set()
    server.shutdown()
    server.server_close()


def call(server, method: str, path: str, body: bytes | None = None, token: str | None = TOKEN):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    return response.status, json.loads(response.read() or b"{}")


def test_embedder_answers_with_the_token_only(embedder):
    assert call(embedder, "GET", "/health", token=None) == (200, {"ok": True, "model": MODEL})
    body = json.dumps({"text": "les chats"}).encode()
    assert call(embedder, "POST", "/embed", body, token=None)[0] == 401
    assert call(embedder, "POST", "/embed", body, token="t" * 39 + "u")[0] == 401
    status, reply = call(embedder, "POST", "/embed", body)
    assert status == 200 and reply["model"] == MODEL and len(reply["embedding"]) == DIM
    assert abs(np.linalg.norm(reply["embedding"]) - 1) < 1e-3


def test_embedder_refuses_big_bodies_long_texts_and_bursts(embedder):
    assert call(embedder, "POST", "/embed", b"x" * 2000)[0] == 413
    assert call(embedder, "POST", "/embed", json.dumps({"text": "a" * 201}).encode())[0] == 400
    assert call(embedder, "POST", "/embed", json.dumps({"text": "  "}).encode())[0] == 400
    assert call(embedder, "POST", "/embed", b"not json")[0] == 400
    assert call(embedder, "GET", "/embed")[0] == 404
    embedder.bucket = TokenBucket(rate=0.001, burst=2)
    body = json.dumps({"text": "plage"}).encode()
    statuses = [call(embedder, "POST", "/embed", body)[0] for _ in range(3)]
    assert statuses == [200, 200, 429]
