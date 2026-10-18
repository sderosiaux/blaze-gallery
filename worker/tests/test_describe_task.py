"""The describe task through the real queue, with a stand-in model: writes, retries, rotation."""

from __future__ import annotations

from PIL import Image
from psycopg.types.json import Jsonb

from blaze_worker.describe import Description
from blaze_worker.description import InvalidReply
from blaze_worker.enqueue import enqueue_ids
from blaze_worker.pipeline import Options, Worker
from blaze_worker.tasks import DescribeAnalyzer

from .conftest import add_photos
from .test_pipeline import Bucket, statuses

DATA = {
    "caption": "Une enfant joue sur une balançoire dans un jardin.",
    "activity": "jeu sur la balançoire",
    "setting": "outdoor",
    "place_type": "garden",
    "occasion": "everyday",
    "people_count": 1,
    "framing": "full_body",
    "objects": ["balançoire", "toboggan"],
    "mood": "joyful",
}


class FakeDescriber:
    model_name = "fake/vlm@0123456789ab describe-v1"

    def __init__(self, invalid: bool = False) -> None:
        self.invalid = invalid
        self.sizes: list[tuple[int, int]] = []

    def describe(self, image: Image.Image) -> Description:
        self.sizes.append(image.size)
        if self.invalid:
            raise InvalidReply(["mood : 'happy' is not one of [...]"], '{"mood": "happy"}')
        return Description(DATA, 0.01, 2, 900, 100, ("caption doit être en français",))


def run(pool, describer: FakeDescriber) -> None:
    options = Options(
        owner="mac",
        task="describe",
        concurrency=1,
        fetchers=2,
        writers=2,
        lease_seconds=600,
        max_side=768,
        wait_seconds=0,
    )
    Worker(options, pool, Bucket(), [DescribeAnalyzer(describer)]).run()  # type: ignore[arg-type]


def test_a_description_is_written_with_its_job(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None), ("image/svg+xml", None)])
    enqueue_ids(conn, "describe", ids, pinned=True)

    run(pool, FakeDescriber())

    assert statuses(conn) == {"done": 1, "skipped": 1}
    model, data = conn.execute(
        "SELECT model, data FROM photo_descriptions WHERE photo_id = %s", (ids[0],)
    ).fetchone()
    assert (model, data) == (FakeDescriber.model_name, DATA)
    job_model, stats = conn.execute(
        "SELECT model, stats FROM analysis_jobs WHERE photo_id = %s", (ids[0],)
    ).fetchone()
    assert job_model == FakeDescriber.model_name
    assert stats["tries"] == 2 and stats["first_errors"] == ["caption doit être en français"]
    assert stats["tokens_in"] == 900 and "ms_infer" in stats


def test_the_model_sees_the_photo_turned_as_the_owner_turned_it(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None), ("image/jpeg", None)])
    conn.execute(
        "UPDATE photos SET metadata = %s WHERE id = %s", (Jsonb({"user_rotation": 90}), ids[1])
    )
    enqueue_ids(conn, "describe", ids, pinned=True)
    describer = FakeDescriber()

    run(pool, describer)

    # Bucket serves a 64x48 JPEG: upright as stored, then on its side
    assert sorted(describer.sizes) == [(48, 64), (64, 48)]
    rotations = conn.execute(
        "SELECT photo_id, (stats ->> 'user_rotation')::int FROM analysis_jobs ORDER BY photo_id"
    ).fetchall()
    assert rotations == [(ids[0], 0), (ids[1], 90)]


def test_an_invalid_reply_after_the_retry_fails_for_good(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "describe", ids, pinned=True)

    run(pool, FakeDescriber(invalid=True))

    status, attempts, error = conn.execute(
        "SELECT status, attempts, last_error FROM analysis_jobs"
    ).fetchone()
    assert (status, attempts) == ("failed", 1)
    assert error.startswith("rejected: mood") and '{"mood": "happy"}' in error
    assert conn.execute("SELECT count(*) FROM photo_descriptions").fetchone()[0] == 0


def test_a_new_run_replaces_the_description_and_deleting_the_photo_removes_it(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)])
    conn.execute(
        "INSERT INTO photo_descriptions (photo_id, model, data) VALUES (%s, 'old', '{}')",
        (ids[0],),
    )
    enqueue_ids(conn, "describe", ids, pinned=True)

    run(pool, FakeDescriber())

    assert conn.execute("SELECT model FROM photo_descriptions").fetchall() == [
        (FakeDescriber.model_name,)
    ]
    conn.execute("DELETE FROM photos WHERE id = %s", (ids[0],))
    assert conn.execute("SELECT count(*) FROM photo_descriptions").fetchone()[0] == 0


def test_a_describe_worker_leaves_the_faces_queue_alone(conn, pool):
    ids = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "faces", ids, pinned=True)

    run(pool, FakeDescriber())

    assert statuses(conn) == {"queued": 1}
