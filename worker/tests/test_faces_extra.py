"""The faces_extra pass: it adds faces, and nothing the owner decided moves."""

from __future__ import annotations

import numpy as np
import psycopg
import pytest
from pgvector import HalfVector

from blaze_worker import jobs
from blaze_worker.enqueue import enqueue_ids
from blaze_worker.faces import Analysis, DetectedFace, FaceModel, Thresholds
from blaze_worker.people_store import decide
from blaze_worker.pipeline import Options, Worker
from blaze_worker.store import LeaseLost, add_faces, overlap, save_faces
from blaze_worker.tasks import EXTRA_FACES_READY_SQL, ExtraFacesAnalyzer

from .conftest import add_photos
from .test_pipeline import FILES, Bucket

LEASE = 600

# Stored by the faces task (det 640, min_score 0.7)
SUZIE_AUTO = (0.30, 0.20, 0.10, 0.15)
OTHER_MANUAL = (0.50, 0.20, 0.10, 0.15)
REJECTED = (0.70, 0.40, 0.08, 0.12)
UNNAMED = (0.85, 0.60, 0.06, 0.09)
# Found by the extra pass only: photo 117889, Suzie half hidden, det 0.57
NEW = (0.08, 0.57, 0.06, 0.08)


def detected(
    box: tuple[float, float, float, float], score: float = 0.9, rotation: int = 0, seed: int = 1
) -> DetectedFace:
    vector = np.random.default_rng(seed).normal(size=512).astype(np.float32)
    x, y, w, h = box
    return DetectedFace(
        box=box,
        det_score=score,
        # Eyes, nose tip, mouth corners
        landmarks=tuple(
            v
            for fx, fy in ((0.3, 0.4), (0.7, 0.4), (0.5, 0.6), (0.35, 0.8), (0.65, 0.8))
            for v in (x + w * fx, y + h * fy)
        ),
        embedding=vector / np.linalg.norm(vector),
        width_px=round(w * 6000),
        height_px=round(h * 4000),
        sharpness=80.0,
        yaw=12.0,
        pitch=-3.0,
        roll=1.5,
        eye_left_open=0.28,
        eye_right_open=0.31,
        mouth_open=0.02,
        expression="neutral",
        expression_scores=(0.0, 0.0, 0.0, 0.0, 0.1, 0.9, 0.0, 0.0),
        detect_rotation=rotation,
    )


def moved(box: tuple[float, float, float, float], dx: float) -> tuple[float, float, float, float]:
    """The same face found again, its box a little off (IoU ~0.5 for dx = w / 3)."""
    return (box[0] + dx, box[1], box[2], box[3])


class FoundModel:
    """Stands in for FaceModel: returns given faces, records the turn it was asked."""

    def __init__(self, faces: list[DetectedFace]) -> None:
        self.faces = faces
        self.turns: list[int | None] = []

    def analyze(self, picture, turn: int | None = None) -> Analysis:
        self.turns.append(turn)
        return Analysis(self.faces, turn or 0, 1, 0.0, 0.0, 0.0)


def faces_done(conn: psycopg.Connection, photo: int, faces: list[DetectedFace]) -> list[int]:
    """The faces task ran on the photo; its faces' ids in box order."""
    enqueue_ids(conn, "faces", [photo], pinned=False)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert save_faces(conn, "mac", job, "pipeline", FILES.embedding_model, faces, {}) == len(faces)
    return [
        r[0]
        for r in conn.execute(
            "SELECT id FROM faces WHERE photo_id = %s ORDER BY box[1]", (photo,)
        ).fetchall()
    ]


def run_extra(pool, model: FoundModel) -> Worker:
    options = Options(
        owner="extra",
        task="faces_extra",
        concurrency=1,
        fetchers=1,
        writers=1,
        lease_seconds=LEASE,
        max_side=32,
        wait_seconds=0,
        ready_sql=EXTRA_FACES_READY_SQL,
    )
    analyzer = ExtraFacesAnalyzer(model, FILES, 1280, 0.5)  # type: ignore[arg-type]
    worker = Worker(options, pool, Bucket(), [analyzer])
    worker.run()
    return worker


def snapshot(conn: psycopg.Connection) -> dict[str, list[str]]:
    """Every column of every row, as Postgres prints it."""
    queries = {
        "faces": "SELECT f::text FROM faces f ORDER BY id",
        "face_candidates": "SELECT c::text FROM face_candidates c ORDER BY person_id, face_id",
        "people": "SELECT p::text FROM people p ORDER BY id",
        "faces_jobs": "SELECT j::text FROM analysis_jobs j WHERE task = 'faces' ORDER BY id",
    }
    return {name: [r[0] for r in conn.execute(sql).fetchall()] for name, sql in queries.items()}


def test_overlap_is_iou_and_ignores_the_aspect_ratio():
    box = (0.2, 0.2, 0.1, 0.1)
    assert overlap(box, box) == pytest.approx(1.0)
    assert overlap(box, (0.5, 0.5, 0.1, 0.1)) == 0.0
    # Side by side, touching: no area shared
    assert overlap(box, (0.3, 0.2, 0.1, 0.1)) == pytest.approx(0.0, abs=1e-12)
    # Shifted by half its width: 1/2 shared over 3/2
    assert overlap(box, (0.25, 0.2, 0.1, 0.1)) == pytest.approx(1 / 3)
    # Fractions of a 3:2 photo or pixels of it: same IoU
    stretched = [(x * 3, y * 2, w * 3, h * 2) for x, y, w, h in (box, (0.25, 0.2, 0.1, 0.1))]
    assert overlap(*stretched) == pytest.approx(1 / 3)


def test_an_extra_pass_adds_the_new_face_and_changes_nothing_stored(conn, pool):
    (photo,) = add_photos(conn, [("image/jpeg", "2018-07-21T12:00:00.000Z")])
    auto, manual, rejected, _unnamed = faces_done(
        conn,
        photo,
        [detected(b, seed=i) for i, b in enumerate((SUZIE_AUTO, OTHER_MANUAL, REJECTED, UNNAMED))],
    )
    suzie = conn.execute("INSERT INTO people (name) VALUES ('Suzie') RETURNING id").fetchone()[0]
    other = conn.execute("INSERT INTO people (name) VALUES ('Paul') RETURNING id").fetchone()[0]
    # The expansion accepted one face for Suzie on its own...
    conn.execute(
        "UPDATE faces SET person_id = %s, assignment = 'auto' WHERE id = %s", (suzie, auto)
    )
    conn.execute(
        """
        INSERT INTO face_candidates (person_id, face_id, similarity, status, decided_by,
                                     decided_at)
        VALUES (%s, %s, 0.71, 'accepted', 'auto', now())
        """,
        (suzie, auto),
    )
    # ...the owner named another and said "pas elle" to a third
    decide(conn, other, [manual], [], "owner")
    decide(conn, suzie, [], [rejected], "owner")
    before = snapshot(conn)
    assert before["face_candidates"] and len(before["faces"]) == 4

    enqueue_ids(conn, "faces_extra", [photo], pinned=False)
    found = [
        # Two stored faces found again: dropped, whatever their name or lack of one
        detected(moved(SUZIE_AUTO, 0.03), score=0.95, seed=10),
        detected(moved(UNNAMED, -0.01), score=0.62, seed=11),
        # Missed by the faces task
        detected(NEW, score=0.57, seed=12),
    ]
    model = FoundModel(found)
    worker = run_extra(pool, model)

    after = snapshot(conn)
    assert after["face_candidates"] == before["face_candidates"]
    assert after["people"] == before["people"]
    assert after["faces_jobs"] == before["faces_jobs"]
    assert after["faces"][:4] == before["faces"]
    assert len(after["faces"]) == 5
    assert worker.counters.found == 1 and model.turns == [0]

    (job_model, stats) = conn.execute(
        "SELECT model, stats FROM analysis_jobs WHERE task = 'faces_extra' AND status = 'done'"
    ).fetchone()
    (added,) = stats["added_ids"]
    assert job_model == FILES.pipeline_model
    assert (stats["faces_added"], stats["faces_skipped_overlap"]) == (1, 2)
    assert (stats["det"], stats["min_score"]) == (1280, 0.5)

    row = conn.execute(
        """
        SELECT photo_id, box, landmarks, det_score, width_px, height_px, sharpness, yaw,
               eye_left_open, expression, expression_scores, model, person_id, assignment,
               cluster_eligible, detect_rotation, embedding <=> %s
        FROM faces WHERE id = %s
        """,
        (HalfVector(found[2].embedding), added),
    ).fetchone()
    new = found[2]
    assert row[0] == photo
    assert row[1] == pytest.approx(list(NEW))
    assert row[2] == pytest.approx(list(new.landmarks))
    assert row[3:8] == pytest.approx(
        (0.57, new.width_px, new.height_px, new.sharpness, new.yaw), rel=1e-6
    )
    assert row[8] == pytest.approx(new.eye_left_open)
    assert row[9] == "neutral" and row[10] == pytest.approx(list(new.expression_scores))
    # In the faces' embedding space, nobody's yet: the next expansion weighs it
    assert row[11:16] == (FILES.embedding_model, None, None, False, 0)
    assert row[16] < 1e-3


def test_a_second_extra_run_adds_nothing_twice(conn, pool):
    (photo,) = add_photos(conn, [("image/jpeg", None)])
    faces_done(conn, photo, [detected(SUZIE_AUTO)])
    enqueue_ids(conn, "faces_extra", [photo], pinned=False)
    run_extra(pool, FoundModel([detected(NEW, score=0.57)]))
    once = snapshot(conn)["faces"]

    conn.execute("UPDATE analysis_jobs SET status = 'queued' WHERE task = 'faces_extra'")
    run_extra(pool, FoundModel([detected(moved(NEW, 0.01), score=0.6)]))

    assert snapshot(conn)["faces"] == once
    stats = conn.execute("SELECT stats FROM analysis_jobs WHERE task = 'faces_extra'").fetchone()[0]
    assert (stats["faces_added"], stats["faces_skipped_overlap"], stats["added_ids"]) == (0, 1, [])


def test_boxes_compare_as_displayed_whatever_turn_found_them(conn, pool):
    # A photo stored on its side without EXIF orientation: the faces task found
    # its face on the image turned 90 degrees, stored back in displayed fractions
    (photo,) = add_photos(conn, [("image/jpeg", None)])
    faces_done(conn, photo, [detected(REJECTED, rotation=90)])
    enqueue_ids(conn, "faces_extra", [photo], pinned=False)
    model = FoundModel(
        [detected(moved(REJECTED, 0.01), rotation=90), detected(NEW, score=0.55, rotation=90)]
    )

    run_extra(pool, model)

    # Detected on the stored faces' turn, without a search for another
    assert model.turns == [90]
    rotations = conn.execute(
        "SELECT detect_rotation FROM faces WHERE photo_id = %s ORDER BY id", (photo,)
    ).fetchall()
    assert rotations == [(90,), (90,)]


def test_waits_for_the_faces_task_to_be_done_with_the_photo(conn):
    done, pending = add_photos(conn, [("image/jpeg", None), ("image/jpeg", None)])
    faces_done(conn, done, [])
    enqueue_ids(conn, "faces", [pending], pinned=False)
    enqueue_ids(conn, "faces_extra", [done, pending], pinned=False)

    claimed = jobs.claim(conn, "extra", ["faces_extra"], 5, LEASE, EXTRA_FACES_READY_SQL)

    assert [j.photo_id for j in claimed] == [done]


def test_a_lost_lease_adds_nothing(conn):
    (photo,) = add_photos(conn, [("image/jpeg", None)])
    faces_done(conn, photo, [detected(SUZIE_AUTO)])
    enqueue_ids(conn, "faces_extra", [photo], pinned=False)
    (stale,) = jobs.claim(conn, "slow", ["faces_extra"], 1, LEASE)
    conn.execute(
        "UPDATE analysis_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = %s",
        (stale.id,),
    )
    jobs.requeue_expired(conn)
    jobs.claim(conn, "fast", ["faces_extra"], 1, LEASE)

    with pytest.raises(LeaseLost):
        add_faces(conn, "slow", stale, "pipeline", "emb", [detected(NEW)], {})
    assert conn.execute("SELECT count(*) FROM faces").fetchone()[0] == 1


# -- FaceModel.analyze with a known turn (no weights: a stand-in detector) -----


class Detector:
    """Finds nothing; remembers the shape of every image it was given."""

    def __init__(self) -> None:
        self.shapes: list[tuple[int, int]] = []

    def detect(self, image: np.ndarray, input_size=None):
        self.shapes.append(image.shape[:2])
        return np.empty((0, 5), np.float32), np.empty((0, 5, 2), np.float32)


class Picture:
    small = np.zeros((20, 30, 3), np.uint8)
    full = np.zeros((40, 60, 3), np.uint8)


def bare_model() -> tuple[FaceModel, Detector]:
    model = FaceModel.__new__(FaceModel)
    model.detector = Detector()
    model.thresholds = Thresholds(min_score=0.5)
    return model, model.detector


def test_a_known_turn_is_the_only_one_tried():
    model, detector = bare_model()
    analysis = model.analyze(Picture(), turn=90)  # type: ignore[arg-type]
    assert (analysis.rotation, analysis.detect_passes, detector.shapes) == (90, 1, [(30, 20)])

    model, detector = bare_model()
    analysis = model.analyze(Picture(), turn=0)  # type: ignore[arg-type]
    assert (analysis.rotation, analysis.detect_passes, detector.shapes) == (0, 1, [(20, 30)])

    # Without one, no upright face: both turns are tried, as the faces task does
    model, detector = bare_model()
    analysis = model.analyze(Picture())  # type: ignore[arg-type]
    assert (analysis.rotation, analysis.detect_passes) == (0, 3)
