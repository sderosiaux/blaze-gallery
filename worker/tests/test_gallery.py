"""Folders out of the gallery (excluded_folders) on Postgres: what a marked folder
covers, and what the queue, the tasks and blaze-people do with its photos."""

from __future__ import annotations

import psycopg
import pytest
from psycopg.types.json import Jsonb

from blaze_worker import jobs
from blaze_worker.enqueue import enqueue_all, enqueue_ids, sample_ids
from blaze_worker.gallery import EXCLUDED_NOTE, excluded
from blaze_worker.people import expand
from blaze_worker.people_store import (
    create_person,
    load_faces,
    person_model,
    rejected_faces,
    set_seeds,
    summarize,
    write_expansion,
)
from blaze_worker.pipeline import Options, Worker
from blaze_worker.tasks import FacesAnalyzer
from blaze_worker.thumbnail import thumbnail_key
from blaze_worker.thumbs import ThumbsAnalyzer, ThumbsLoader

from .test_people_db import LIMITS, Library
from .test_pipeline import FILES, GatedModel
from .test_thumbs_task import Bucket, MemoryStore


def photo_at(conn: psycopg.Connection, key: str, mime: str = "image/jpeg") -> int:
    """A photo whose file is `key`, in the folder its key names."""
    folder = key.rsplit("/", 1)[0]
    folder_id = conn.execute(
        """
        INSERT INTO folders (path, name) VALUES (%s, %s)
        ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING id
        """,
        (folder, folder.rsplit("/", 1)[-1]),
    ).fetchone()[0]
    return conn.execute(
        """
        INSERT INTO photos (folder_id, filename, s3_key, size, mime_type, modified_at, metadata)
        VALUES (%s, %s, %s, 1000, %s, now(), %s) RETURNING id
        """,
        (folder_id, key.rsplit("/", 1)[-1], key, mime, Jsonb({"date_taken": "2015-06-01"})),
    ).fetchone()[0]


def exclude(conn: psycopg.Connection, *paths: str) -> None:
    for path in paths:
        conn.execute("INSERT INTO excluded_folders (path) VALUES (%s)", (path,))


def include(conn: psycopg.Connection, path: str) -> None:
    conn.execute("DELETE FROM excluded_folders WHERE path = %s", (path,))


def out(conn: psycopg.Connection, key: str) -> bool:
    return conn.execute(f"SELECT {excluded('%s::text')}", (key,)).fetchone()[0]


def jobs_by_photo(conn: psycopg.Connection, task: str) -> dict[int, tuple]:
    rows = conn.execute(
        "SELECT photo_id, status, last_error FROM analysis_jobs WHERE task = %s", (task,)
    ).fetchall()
    return {photo_id: (status, error) for photo_id, status, error in rows}


def options(task: str, analyze_excluded: bool = False) -> Options:
    return Options(
        owner="test",
        task=task,
        concurrency=1,
        fetchers=2,
        writers=2,
        lease_seconds=600,
        max_side=400,
        wait_seconds=0,
        analyze_excluded=analyze_excluded,
    )


# -- what a marked folder covers ------------------------------------------------


def test_a_folder_covers_itself_and_everything_below_it_and_nothing_else(conn):
    exclude(conn, "music", "books/coursera")

    assert out(conn, "music/Enya/cover.jpg")
    assert out(conn, "music/a/b/c/deep.png")
    assert out(conn, "books/coursera/week1/slide.png")
    # A name that starts the same is another folder
    assert not out(conn, "musique/cover.jpg")
    assert not out(conn, "music-old/cover.jpg")
    assert not out(conn, "music.jpg")
    assert not out(conn, "books/cover.jpg")
    assert not out(conn, "books/coursera-2/slide.png")
    # Folders are tested by their path and a slash
    assert out(conn, "music/")
    assert out(conn, "music/Enya/")
    assert not out(conn, "musique/")


def test_wildcards_in_a_marked_name_are_plain_characters(conn):
    exclude(conn, "a_b", "100%", "back\\slash")

    assert out(conn, "a_b/x.jpg") and not out(conn, "axb/x.jpg")
    assert out(conn, "100%/x.jpg") and not out(conn, "1000/x.jpg")
    assert out(conn, "back\\slash/x.jpg") and not out(conn, "backslash/x.jpg")


@pytest.mark.parametrize("path", ["", "music/", "/music"])
def test_a_marked_path_names_a_folder_without_slashes_at_its_ends(conn, path):
    with pytest.raises(psycopg.errors.CheckViolation):
        exclude(conn, path)


# -- the queue --------------------------------------------------------------------


def test_photos_out_of_the_gallery_are_never_queued(conn):
    kept = photo_at(conn, "musique/a.jpg")
    left = photo_at(conn, "music/a.jpg")
    exclude(conn, "music")

    assert enqueue_all(conn, "faces") == 1
    assert enqueue_ids(conn, "embed", [kept, left], pinned=True) == 1
    assert set(jobs_by_photo(conn, "faces")) == {kept}
    assert set(jobs_by_photo(conn, "embed")) == {kept}
    assert sample_ids(conn, 50, [], "seed") == [kept]


def test_a_job_claimed_out_of_the_gallery_closes_skipped_and_comes_back_with_its_folder(conn, pool):
    kept = photo_at(conn, "musique/a.jpg")
    left = photo_at(conn, "music/a.jpg")
    svg = photo_at(conn, "musique/b.svg", "image/svg+xml")
    enqueue_all(conn, "faces")
    # Marked after it was queued
    exclude(conn, "music")
    claimed = {job.photo_id: job.excluded for job in jobs.claim(conn, "peek", ["faces"], 10, 60)}
    assert claimed == {kept: False, left: True, svg: False}
    jobs.release(conn, "peek", [j[0] for j in conn.execute("SELECT id FROM analysis_jobs")])

    bucket = Bucket()
    analyzer = FacesAnalyzer(GatedModel(False), FILES, 640)  # type: ignore[arg-type]
    Worker(options("faces"), pool, bucket, [analyzer]).run()  # type: ignore[arg-type]

    states = jobs_by_photo(conn, "faces")
    assert states[left] == ("skipped", EXCLUDED_NOTE)
    assert states[kept][0] == "done" and states[svg][0] == "skipped"
    # Skipped before any download
    assert "music/a.jpg" not in bucket.reads

    # Back in the gallery: --all queues it again, and only it
    include(conn, "music")
    assert enqueue_all(conn, "faces") == 1
    states = jobs_by_photo(conn, "faces")
    assert states[left] == ("queued", None)
    assert states[kept][0] == "done" and states[svg][0] == "skipped"


def trash(conn: psycopg.Connection, *photo_ids: int) -> None:
    conn.execute("UPDATE photos SET trashed_at = now() WHERE id = ANY(%s)", (list(photo_ids),))


def test_a_photo_in_the_corbeille_is_out_of_the_gallery_until_restored(conn, pool):
    kept = photo_at(conn, "trip/a.jpg")
    thrown = photo_at(conn, "trip/b.jpg")
    trash(conn, thrown)
    assert enqueue_all(conn, "faces") == 1
    assert set(jobs_by_photo(conn, "faces")) == {kept}

    # Thrown away once queued: closes skipped, comes back with --all once restored
    conn.execute("UPDATE photos SET trashed_at = NULL WHERE id = %s", (thrown,))
    enqueue_all(conn, "faces")
    trash(conn, thrown)
    bucket = Bucket()
    analyzer = FacesAnalyzer(GatedModel(False), FILES, 640)  # type: ignore[arg-type]
    Worker(options("faces"), pool, bucket, [analyzer]).run()  # type: ignore[arg-type]
    assert jobs_by_photo(conn, "faces")[thrown] == ("skipped", EXCLUDED_NOTE)
    assert "trip/b.jpg" not in bucket.reads
    conn.execute("UPDATE photos SET trashed_at = NULL WHERE id = %s", (thrown,))
    assert enqueue_all(conn, "faces") == 1
    assert jobs_by_photo(conn, "faces")[thrown] == ("queued", None)


def test_thumbs_makes_the_thumbnail_without_colors_out_of_the_gallery(conn, pool):
    fresh = photo_at(conn, "stepmania/pack/fresh.jpg")
    done = photo_at(conn, "stepmania/pack/done.jpg")
    store = MemoryStore()
    conn.execute(
        "UPDATE photos SET thumbnail_status = 'generated', thumbnail_path = %s WHERE id = %s",
        (thumbnail_key("thumbnails", "stepmania/pack/done.jpg", done), done),
    )
    enqueue_all(conn, "thumbs")
    exclude(conn, "stepmania")
    bucket = Bucket()

    worker = Worker(
        options("thumbs", analyze_excluded=True),
        pool,
        bucket,
        [ThumbsAnalyzer(store)],  # type: ignore[arg-type]
        ThumbsLoader(pool, store),  # type: ignore[arg-type]
    )
    worker.run()

    states = jobs_by_photo(conn, "thumbs")
    # The Bibliothèque still shows it: thumbnail made, colors not measured
    assert states[fresh] == ("done", EXCLUDED_NOTE)
    assert conn.execute(
        "SELECT thumbnail_status FROM photos WHERE id = %s", (fresh,)
    ).fetchone() == ("generated",)
    assert thumbnail_key("thumbnails", "stepmania/pack/fresh.jpg", fresh) in store.objects
    # Its thumbnail made already, nothing to download it for
    assert states[done] == ("skipped", EXCLUDED_NOTE)
    assert bucket.reads == ["stepmania/pack/fresh.jpg"]
    assert conn.execute("SELECT count(*) FROM photo_colors").fetchone()[0] == 0

    # Back in the gallery: both are queued again for their colors
    include(conn, "stepmania")
    assert enqueue_all(conn, "thumbs") == 2


# -- blaze-people -----------------------------------------------------------------


def test_people_never_see_faces_out_of_the_gallery_and_leave_their_rows(conn):
    lib = Library(conn)
    suzie = create_person(conn, "Suzie")
    seed = lib.face(lib.photo("2010", "2010-01-01T00:00:00.000Z"), lib.looks(1))
    set_seeds(conn, suzie.id, [seed])
    near = lib.face(lib.photo("2010/02", "2010-02-01T00:00:00.000Z"), lib.looks(1.1), noise=0.1)
    # Her face in a folder that is not a gallery: same look, but out
    game = lib.photo("games/sprites", "2010-03-01T00:00:00.000Z")
    conn.execute("UPDATE photos SET s3_key = 'games/sprites/her.png' WHERE id = %s", (game,))
    sprite = lib.face(game, lib.looks(1.1), noise=0.1)
    # Proposed before the folder was marked
    conn.execute(
        "INSERT INTO face_candidates (person_id, face_id, similarity) VALUES (%s, %s, 0.5)",
        (suzie.id, sprite),
    )
    exclude(conn, "games")

    loaded = load_faces(conn, person_model(conn, suzie.id))
    assert sprite not in set(loaded.faces.ids.tolist())
    result = expand(loaded.faces, suzie.id, rejected_faces(conn, suzie.id), LIMITS)
    write_expansion(conn, suzie.id, loaded.faces, loaded.taken, result)

    assert conn.execute(
        "SELECT person_id, assignment FROM faces WHERE id = %s", (near,)
    ).fetchone() == (suzie.id, "auto")
    # Neither taken nor dropped: it waits, unseen, for its folder to come back
    assert conn.execute(
        "SELECT person_id, assignment FROM faces WHERE id = %s", (sprite,)
    ).fetchone() == (None, None)
    assert conn.execute(
        "SELECT status FROM face_candidates WHERE person_id = %s AND face_id = %s",
        (suzie.id, sprite),
    ).fetchone() == ("pending",)
    assert summarize(conn, suzie.id).pending == 0

    include(conn, "games")
    assert summarize(conn, suzie.id).pending == 1
