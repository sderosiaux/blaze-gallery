"""Queue semantics against a real Postgres: claiming, leases, retries, results."""

from __future__ import annotations

import threading

import numpy as np
import psycopg
import pytest
from pgvector import HalfVector

from blaze_worker import jobs
from blaze_worker.enqueue import PINNED_PRIORITY, enqueue_all, enqueue_ids, sample_ids
from blaze_worker.faces import DetectedFace
from blaze_worker.store import LeaseLost, save_faces

from .conftest import add_photos, connect

LEASE = 600


def queue(conn: psycopg.Connection, count: int, task: str = "faces") -> list[int]:
    ids = add_photos(
        conn, [("image/jpeg", f"20{10 + i % 10}-01-01T00:00:00.000Z") for i in range(count)]
    )
    enqueue_ids(conn, task, ids, pinned=False)
    return ids


def row(conn: psycopg.Connection, job_id: int) -> dict:
    cursor = conn.execute(
        "SELECT status, attempts, lease_owner, last_error, not_before, model, stats "
        "FROM analysis_jobs WHERE id = %s",
        (job_id,),
    )
    names = [c.name for c in cursor.description]
    return dict(zip(names, cursor.fetchone(), strict=True))


def expire(conn: psycopg.Connection, job_id: int) -> None:
    """What a worker that died looks like: its lease ran out."""
    conn.execute(
        "UPDATE analysis_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = %s",
        (job_id,),
    )


def face(score: float = 0.9, side: int = 200, sharpness: float = 120.0, yaw: float = 5.0):
    vector = np.random.default_rng(1).normal(size=512).astype(np.float32)
    return DetectedFace(
        box=(0.1, 0.2, 0.3, 0.4),
        det_score=score,
        landmarks=tuple(float(i) / 10 for i in range(10)),
        embedding=vector / np.linalg.norm(vector),
        width_px=side,
        height_px=side + 20,
        sharpness=sharpness,
        yaw=yaw,
        pitch=0.0,
        roll=0.0,
        eye_left_open=0.3,
        eye_right_open=0.3,
        mouth_open=0.05,
        expression="happiness",
        expression_scores=(0.0, 0.0, 0.0, 0.0, 0.9, 0.1, 0.0, 0.0),
        detect_rotation=0,
    )


# -- claiming ---------------------------------------------------------------


def test_claim_serves_higher_priority_first_and_leases(conn):
    old, new = add_photos(
        conn,
        [("image/jpeg", "2009-05-01T10:00:00.000Z"), ("image/jpeg", "2024-05-01T10:00:00.000Z")],
    )
    enqueue_ids(conn, "faces", [old, new], pinned=False)

    claimed = jobs.claim(conn, "mac", ["faces"], 1, LEASE)

    assert [j.photo_id for j in claimed] == [new]
    state = row(conn, claimed[0].id)
    assert (state["status"], state["attempts"], state["lease_owner"]) == ("leased", 1, "mac")
    assert jobs.claim(conn, "mac", ["faces"], 5, LEASE)[0].photo_id == old
    assert jobs.claim(conn, "mac", ["faces"], 5, LEASE) == []


def test_claim_only_the_requested_tasks(conn):
    ids = add_photos(conn, [("image/jpeg", None)])
    enqueue_ids(conn, "describe", ids, pinned=False)
    assert jobs.claim(conn, "mac", ["faces"], 5, LEASE) == []
    assert len(jobs.claim(conn, "mac", ["describe"], 5, LEASE)) == 1


def test_concurrent_claims_never_share_a_job(schema, conn):
    queue(conn, 120)
    claimed: dict[str, list[int]] = {}

    def worker(name: str) -> None:
        with connect(schema) as own:
            got: list[int] = []
            while batch := jobs.claim(own, name, ["faces"], 3, LEASE):
                got.extend(j.id for j in batch)
            claimed[name] = got

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    every = [job for got in claimed.values() for job in got]
    assert len(every) == 120
    assert len(set(every)) == 120
    # The load was shared, not taken by whoever came first
    assert sum(1 for got in claimed.values() if got) >= 2


def test_a_locked_row_is_skipped_not_waited_for(schema, conn):
    queue(conn, 2)
    with connect(schema) as other, other.transaction():
        locked = other.execute(
            "SELECT id FROM analysis_jobs ORDER BY priority DESC, id LIMIT 1 FOR UPDATE"
        ).fetchone()[0]
        claimed = jobs.claim(conn, "mac", ["faces"], 2, LEASE)
        assert [j.id for j in claimed] != [] and locked not in [j.id for j in claimed]


# -- leases -----------------------------------------------------------------


def test_expired_lease_goes_back_to_the_queue_then_fails_when_out_of_attempts(conn):
    queue(conn, 1)
    for attempt in (1, 2, 3):
        (job,) = jobs.claim(conn, f"crashy{attempt}", ["faces"], 1, LEASE)
        assert job.attempts == attempt
        expire(conn, job.id)
        requeued, failed = jobs.requeue_expired(conn)
        expected = (0, 1) if attempt == 3 else (1, 0)
        assert (requeued, failed) == expected

    state = row(conn, job.id)
    assert state["status"] == "failed"
    assert "crashy3" in state["last_error"]
    assert jobs.claim(conn, "mac", ["faces"], 1, LEASE) == []


def test_live_leases_are_not_requeued_and_renewal_reports_lost_ones(conn):
    queue(conn, 2)
    first, second = jobs.claim(conn, "mac", ["faces"], 2, LEASE)
    expire(conn, second.id)
    assert jobs.requeue_expired(conn) == (1, 0)
    assert jobs.renew(conn, "mac", [first.id, second.id], LEASE) == {first.id}
    assert row(conn, first.id)["status"] == "leased"


def test_a_worker_that_lost_its_lease_cannot_write_its_result(conn):
    queue(conn, 1)
    (stale,) = jobs.claim(conn, "slow", ["faces"], 1, LEASE)
    expire(conn, stale.id)
    jobs.requeue_expired(conn)
    (fresh,) = jobs.claim(conn, "fast", ["faces"], 1, LEASE)
    assert fresh.id == stale.id

    with pytest.raises(LeaseLost):
        save_faces(conn, "slow", stale, "m", "emb", [face()], {"ms": 1})
    assert conn.execute("SELECT count(*) FROM faces").fetchone()[0] == 0
    assert jobs.fail(conn, "slow", stale.id, "boom", permanent=False) is None

    assert save_faces(conn, "fast", fresh, "m", "emb", [face()], {"ms": 1}) == 1
    state = row(conn, fresh.id)
    assert (state["status"], state["lease_owner"]) == ("done", "fast")


def test_release_gives_the_job_back_without_counting_an_attempt(conn):
    queue(conn, 1)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert jobs.release(conn, "other", [job.id]) == 0
    assert jobs.release(conn, "mac", [job.id]) == 1
    state = row(conn, job.id)
    assert (state["status"], state["attempts"], state["lease_owner"]) == ("queued", 0, None)


# -- retries ----------------------------------------------------------------


def test_transient_failure_backs_off_then_retries_until_max_attempts(conn):
    queue(conn, 1)
    for attempt in (1, 2, 3):
        (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
        status = jobs.fail(conn, "mac", job.id, f"network {attempt}", permanent=False)
        if attempt < 3:
            assert status == "queued"
            assert row(conn, job.id)["not_before"] is not None
            # Backing off: not claimable yet
            assert jobs.claim(conn, "mac", ["faces"], 1, LEASE) == []
            conn.execute("UPDATE analysis_jobs SET not_before = now() - interval '1 second'")
        else:
            assert status == "failed"
    state = row(conn, job.id)
    assert (state["status"], state["attempts"], state["last_error"]) == ("failed", 3, "network 3")


def test_permanent_failure_is_not_retried(conn):
    queue(conn, 1)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert jobs.fail(conn, "mac", job.id, "undecodable", permanent=True) == "failed"
    assert row(conn, job.id)["attempts"] == 1


def test_skipped_job_is_closed_with_its_reason(conn):
    ids = add_photos(conn, [("image/svg+xml", None)])
    enqueue_ids(conn, "faces", ids, pinned=False)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert jobs.complete(conn, "mac", job.id, None, {}, status="skipped", note="unsupported")
    state = row(conn, job.id)
    assert (state["status"], state["last_error"]) == ("skipped", "unsupported")


# -- results ----------------------------------------------------------------


def test_faces_are_written_with_the_job_and_replaced_on_a_rerun(conn):
    queue(conn, 1)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    faces = [face(), face(score=0.75, side=60), face(sharpness=10), face(yaw=70)]
    assert save_faces(conn, "mac", job, "pipeline", "emb-1", faces, {"ms_detect": 3}) == 4

    state = row(conn, job.id)
    assert (state["status"], state["model"], state["stats"]["faces"]) == ("done", "pipeline", 4)
    eligible = [
        r[0] for r in conn.execute("SELECT cluster_eligible FROM faces ORDER BY id").fetchall()
    ]
    assert eligible == [True, False, False, False]
    distance = conn.execute(
        "SELECT embedding <=> %s FROM faces ORDER BY id LIMIT 1", (HalfVector(faces[0].embedding),)
    ).fetchone()[0]
    # halfvec keeps ~3 significant digits
    assert distance < 1e-3

    conn.execute("UPDATE analysis_jobs SET status = 'queued'")
    (again,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert save_faces(conn, "mac", again, "pipeline", "emb-1", [face()], {}) == 1
    assert conn.execute("SELECT count(*) FROM faces").fetchone()[0] == 1


def test_a_rerun_never_drops_faces_the_owner_named(conn):
    queue(conn, 1)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    save_faces(conn, "mac", job, "pipeline", "emb-1", [face(), face()], {})
    person = conn.execute("INSERT INTO people (name) VALUES (NULL) RETURNING id").fetchone()[0]
    conn.execute(
        "UPDATE faces SET person_id = %s, assignment = 'manual' "
        "WHERE id = (SELECT min(id) FROM faces)",
        (person,),
    )
    conn.execute("UPDATE analysis_jobs SET status = 'queued'")
    (again,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert save_faces(conn, "mac", again, "pipeline", "emb-1", [face()], {}) == 0
    assert conn.execute("SELECT count(*) FROM faces").fetchone()[0] == 2
    assert row(conn, again.id)["stats"]["kept_named"] == 1


def test_deleting_a_photo_removes_its_jobs_and_faces(conn):
    (photo,) = queue(conn, 1)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    save_faces(conn, "mac", job, "pipeline", "emb-1", [face()], {})
    conn.execute("DELETE FROM photos WHERE id = %s", (photo,))
    assert conn.execute("SELECT count(*) FROM faces").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM analysis_jobs").fetchone()[0] == 0


# -- enqueue ----------------------------------------------------------------


def test_enqueue_all_takes_images_only_and_keeps_existing_jobs(conn):
    jpeg, _video, undated, svg = add_photos(
        conn,
        [
            ("image/jpeg", "2019-07-14T12:00:00.000Z"),
            ("video/mp4", "2020-01-01T00:00:00.000Z"),
            ("image/png", None),
            ("image/svg+xml", None),
        ],
    )
    assert enqueue_all(conn, "faces") == 3
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert job.photo_id == jpeg
    assert enqueue_all(conn, "faces") == 0
    assert row(conn, job.id)["status"] == "leased"
    priorities = dict(conn.execute("SELECT photo_id, priority FROM analysis_jobs").fetchall())
    assert priorities == {jpeg: 2019, undated: 0, svg: 0}


def test_pinned_photos_jump_the_queue(conn):
    ids = queue(conn, 3)
    enqueue_ids(conn, "faces", [ids[0]], pinned=True)
    (job,) = jobs.claim(conn, "mac", ["faces"], 1, LEASE)
    assert (job.photo_id, row(conn, job.id)["status"]) == (ids[0], "leased")
    assert (
        conn.execute(
            "SELECT priority FROM analysis_jobs WHERE photo_id = %s", (ids[0],)
        ).fetchone()[0]
        == PINNED_PRIORITY
    )


def test_sample_is_deterministic_and_excludes_pinned(conn):
    ids = add_photos(
        conn, [("image/jpeg", f"20{10 + i % 15}-01-01T00:00:00.000Z") for i in range(40)]
    )
    first = sample_ids(conn, 10, [ids[0]], "seed")
    assert first == sample_ids(conn, 10, [ids[0]], "seed")
    assert ids[0] not in first
    assert len(set(first)) == len(first)
