"""The groups task: which photos link, how stacks form, the score, and what it writes."""

from __future__ import annotations

import io
import logging
import threading

import numpy as np
import pytest
from pgvector import HalfVector
from PIL import Image, ImageDraw
from psycopg.types.json import Jsonb

from blaze_worker import groups
from blaze_worker.enqueue import enqueue_all
from blaze_worker.gallery import EXCLUDED_NOTE
from blaze_worker.groups import (
    ALIKE,
    BRACKET,
    BURST,
    COPY,
    IDENTICAL,
    NONE,
    RAW,
    SAME,
    TASK,
    Aborted,
    Columns,
    Face,
    Grouper,
    Measurer,
    Photo,
    Stack,
    classify,
    face_measures,
    gather,
    in_dated_folder,
    picture_measures,
    place,
    rank,
    rebuild,
    rules_model,
    settle,
    taken_at,
)
from blaze_worker.siglip import DIM, MODEL
from blaze_worker.tags import Vocabulary

from .conftest import add_photos, connect

CAMERA = "NIKON|D7000"


def photo(pid: int, **facts) -> Photo:
    base = {
        "size": 1000 + pid,
        "width": 4000,
        "height": 3000,
        "camera": CAMERA,
        "taken": 1_000_000.0,
        "screen": False,
        "thumbnail": f"thumbnails/{pid}.jpg",
    }
    return Photo(pid, **{**base, **facts})


def code(a: Photo, b: Photo, cosine: float) -> int:
    return int(classify(Columns.of([a, b]), np.array([0]), np.array([1]), np.array([cosine]))[0])


# -- the rules ----------------------------------------------------------------------


def test_one_camera_the_same_second_links_from_090():
    a, b = photo(1), photo(2)
    assert code(a, b, 0.91) == BURST
    assert code(a, b, 0.89) == NONE


def test_one_camera_within_30_seconds_links_from_0975():
    a = photo(1)
    assert code(a, photo(2, taken=1_000_010.0), 0.98) == BURST
    assert code(a, photo(2, taken=1_000_030.0), 0.976) == BURST
    assert code(a, photo(2, taken=1_000_010.0), 0.97) == NONE


def test_one_camera_later_needs_the_identical_picture():
    a = photo(1)
    assert code(a, photo(2, taken=1_000_100.0), 0.99) == IDENTICAL
    # Another shape a minute later: another shot
    assert code(a, photo(2, taken=1_000_100.0, width=3000, height=3000), 0.99) == NONE
    assert code(a, photo(2, taken=1_000_100.0), 0.98) == NONE


def test_a_raw_file_and_its_jpeg_link_as_raw_not_as_a_burst():
    nef = photo(1, raw=True, size=25_000_000)
    assert code(nef, photo(2), 0.95) == RAW
    assert code(photo(1), photo(2), 0.95) == BURST
    # Below the burst's cosine, nothing
    assert code(nef, photo(2), 0.85) == NONE


def test_frames_at_other_exposures_link_as_a_bracket_when_both_say_so():
    assert code(photo(1, exposure_bias=-1.0), photo(2, exposure_bias=1.0), 0.93) == BRACKET
    assert code(photo(1, exposure_bias=0.0), photo(2, exposure_bias=0.0), 0.93) == BURST
    # One unknown: a burst, as before
    assert code(photo(1, exposure_bias=-1.0), photo(2), 0.93) == BURST


def test_only_the_date_of_the_shot_times_a_burst():
    iso = "2020-05-01T10:00:00.000Z"
    assert taken_at(iso, CAMERA, "DateTimeOriginal") == taken_at(iso, CAMERA)
    # Photos probed before the tag was recorded: as before
    assert taken_at(iso, CAMERA, None) is not None
    assert taken_at(iso, CAMERA, "DateTime") is None
    assert taken_at(iso, CAMERA, "DateTimeDigitized") is None
    # Untimed, the pair goes to the pixel test
    assert code(photo(1), photo(2, taken=None), 0.99) == ALIKE


def test_two_cameras_never_link_but_as_exact_copies():
    a, b = photo(1), photo(2, camera="Apple|iPhone 12")
    assert code(a, b, 0.995) == NONE
    assert code(a, photo(2, camera="Apple|iPhone 12", size=a.size), 0.9995) == COPY


def test_without_a_camera_date_the_pixels_decide_and_a_crop_stays_out():
    a = photo(1)
    resized = photo(2, camera=None, taken=None, width=1600, height=1200)
    cropped = photo(3, camera=None, taken=None, width=1600, height=1600)
    assert code(a, resized, 0.99) == ALIKE
    # Two shapes: no pixel test can compare them, the cosine alone is not enough
    assert code(a, cropped, 0.999) == NONE
    assert code(a, resized, 0.98) == NONE
    # A camera without a date counts as no date
    assert code(a, photo(4, taken=None, width=1600, height=1200), 0.99) == ALIKE


def test_screens_and_small_images_only_stack_as_exact_copies():
    a = photo(1)
    assert code(a, photo(2, screen=True), 0.99) == NONE
    assert code(photo(1, width=90, height=60), photo(2, width=90, height=60), 0.99) == NONE
    small = photo(3, width=90, height=60)
    assert code(small, photo(4, width=90, height=60, size=small.size), 0.9999) == COPY


def test_exact_copies_link_whatever_their_dates():
    a = photo(1)
    b = photo(2, size=a.size, taken=99.0, camera="Other|Camera")
    assert code(a, b, 0.9995) == COPY
    assert code(a, b, 0.998) == NONE


def test_the_owner_turning_a_photo_changes_its_shape():
    upright = photo(1, width=3000, height=4000)
    turned = photo(2, camera=None, taken=None, rotation=90)
    assert code(upright, turned, 0.99) == ALIKE


def test_pixel_tests_settle_alike_and_identical():
    codes = np.array([ALIKE, ALIKE, IDENTICAL, IDENTICAL, ALIKE, BURST], np.int8)
    shares = np.array([0.02, 0.05, 0.004, 0.02, np.nan, np.nan])
    assert settle(codes, shares).tolist() == [SAME, NONE, SAME, NONE, NONE, BURST]


def test_a_slow_series_does_not_chain():
    # 0-1-2-3-4, each linked to the next only
    centres = gather(5, np.array([0, 1, 2, 3]), np.array([1, 2, 3, 4]))
    stacks: dict[int, set[int]] = {}
    for row, centre in enumerate(centres.tolist()):
        stacks.setdefault(centre, set()).add(row)
    assert sorted(map(sorted, stacks.values())) == [[0, 1, 2], [3, 4]]


def test_the_most_linked_photo_is_the_centre():
    # 2 is linked to all; 0 and 1 to 2 only
    centres = gather(4, np.array([0, 1, 2]), np.array([2, 2, 3]))
    assert centres.tolist() == [2, 2, 2, 2]


def test_a_photo_whose_neighbours_are_taken_can_join_a_later_centre():
    # 0 claims 1, 2, 3; 4 is linked to 1 (taken) and to 5: 4 then claims 5
    centres = gather(6, np.array([0, 0, 0, 1, 4]), np.array([1, 2, 3, 4, 5]))
    assert centres.tolist() == [0, 0, 0, 0, 4, 4]


# -- measures and the score ---------------------------------------------------------


def jpeg(sharp: bool = True, size: tuple[int, int] = (400, 300), level: int = 128) -> bytes:
    image = Image.new("L", size, level)
    if sharp:
        draw = ImageDraw.Draw(image)
        for x in range(0, size[0], 8):
            draw.line([(x, 0), (x, size[1])], fill=0 if level > 127 else 255)
    out = io.BytesIO()
    image.convert("RGB").save(out, "JPEG", quality=95)
    return out.getvalue()


def test_sharpness_is_measured_at_one_size():
    crisp, flat = picture_measures(jpeg(True)), picture_measures(jpeg(False))
    assert crisp["sharp"] > flat["sharp"] + 5
    # A smaller thumbnail is brought to the same edge first: it holds less detail there
    assert picture_measures(jpeg(True, (200, 150)))["sharp"] < crisp["sharp"]
    assert picture_measures(jpeg(False, level=255))["clipped"] == 1.0
    # A sliver of a panorama still measures, as a number
    sliver = picture_measures(jpeg(True, (400, 2)))
    assert sliver["sharp"] == sliver["sharp"] and sliver["sharp"] >= 0


def face(**v) -> Face:
    base = {
        "box": [0.4, 0.3, 0.1, 0.12],
        "sharpness": 200.0,
        "eye_left": 0.3,
        "eye_right": 0.3,
        "pitch": 0.0,
        "happiness": 0.5,
        "detect_rotation": 0,
    }
    return Face(**{**base, **v})


def test_face_measures():
    m = face_measures(
        [
            face(),
            face(eye_left=0.05, eye_right=0.1),
            # Looking down: the lids read closed, not a blink
            face(eye_left=0.05, eye_right=0.05, pitch=-25.0),
            face(box=[0.95, 0.3, 0.08, 0.1]),
            # Too small to count
            face(box=[0.1, 0.1, 0.01, 0.01], eye_left=0.0, eye_right=0.0),
        ],
        rotation=0,
    )
    assert (m["faces"], m["blinks"], m["cut"], m["sideways"]) == (4, 1, 1, 0)
    assert m["smile"] == 0.5 and m["face_sharp"] == pytest.approx(7.6439, abs=1e-3)


def test_faces_found_only_on_the_turned_picture_show_it_sideways():
    assert face_measures([face(detect_rotation=90)], rotation=0)["sideways"] == 1
    # The owner turned it the same way: upright on screen
    assert face_measures([face(detect_rotation=90)], rotation=90)["sideways"] == 0
    assert face_measures([], rotation=0)["sideways"] == 0


def m(**v) -> dict:
    base = {
        "sharp": 10.0,
        "clipped": 0.0,
        "pixels": 23.5,
        "bytes": 21.0,
        "faces": 2,
        "blinks": 0,
        "cut": 0,
        "face_sharp": 7.0,
        "smile": 0.5,
        "sideways": 0,
    }
    return {**base, **v}


def test_closed_eyes_lose_to_a_slightly_blurrier_frame():
    ranked = rank([(1, m(blinks=1, sharp=10.3)), (2, m(sharp=10.0))])
    assert [pid for pid, _, _ in ranked] == [2, 1]
    assert [place for _, place, _ in ranked] == [1, 2]


def test_a_resized_copy_loses_to_the_original():
    ranked = rank([(1, m(pixels=20.5, bytes=18.0)), (2, m())])
    assert ranked[0][0] == 2


def test_exact_copies_go_to_the_photo_held_longest():
    ranked = rank([(7, m()), (3, m()), (5, m())])
    assert [pid for pid, _, _ in ranked] == [3, 5, 7]


def test_exact_copies_go_first_to_the_one_in_a_dated_folder():
    ranked = rank([(3, m(dated_folder=0)), (5, m(dated_folder=1)), (7, m(dated_folder=0))])
    assert [pid for pid, _, _ in ranked] == [5, 3, 7]
    # Only a tie: a sharper frame still goes first
    assert rank([(3, m(sharp=10.5)), (5, m(dated_folder=1))])[0][0] == 3


def test_the_jpeg_of_a_shot_goes_before_its_raw():
    # As asked: the NEF led by 3.4 on its pixels and bytes
    ranked = rank([(1, m(raw=1, pixels=24.5, bytes=25.0)), (2, m(pixels=22.5, bytes=20.4))])
    assert ranked[0][0] == 2


def test_a_dated_folder_is_the_one_right_under_the_top_folder():
    assert in_dated_folder("pc-fixe/2013-04-13 - Voyage @ Japon A TRIER/2013-Japon/a.JPG")
    assert in_dated_folder("pc-fixe/2022-05 - NYC/a.jpg")
    assert not in_dated_folder("pc-fixe/A TRIER/TODO 2 2013/2013-03-28 japonD1/a.JPG")
    assert not in_dated_folder("pc-fixe/Selection US 2022 - 2024/NYC mai 22/a.jpg")
    assert not in_dated_folder("aaaa/Mariage/apero et ami/a.JPG")
    # A file named from a date, not a folder
    assert not in_dated_folder("pc-fixe/2020-01-05 plage.jpg")


def test_a_member_without_faces_is_neither_helped_nor_hurt_by_face_sharpness():
    # The median fills in: only faces found and the picture's own measures differ
    ranked = rank([(1, m(faces=0, face_sharp=None, smile=None)), (2, m(faces=0))])
    assert ranked[0][2] == ranked[1][2]


def test_an_unread_thumbnail_is_unknown_not_blurred():
    unread = groups.measures(photo(1), None, [])
    assert unread["sharp"] is None and unread["clipped"] is None
    # The stack's median stands in: neither first nor last
    ranked = rank(
        [(1, m(sharp=None, clipped=None)), (2, m(sharp=12.0)), (3, m(sharp=8.0)), (4, m())]
    )
    # Read as the median, 10: with 4, behind 2, before 3
    assert [pid for pid, _, _ in ranked] == [2, 1, 4, 3]


def test_the_rules_and_weights_name_the_model(monkeypatch):
    before = rules_model()
    monkeypatch.setitem(groups.WEIGHTS, "blinks", -2.0)
    assert rules_model() != before and rules_model().startswith("groups v2 ")


# -- incremental placement ----------------------------------------------------------


def both(*pairs: tuple[int, int, str]) -> dict[tuple[int, int], str]:
    out = {}
    for a, b, kind in pairs:
        out[(a, b)] = out[(b, a)] = kind
    return out


def test_a_new_photo_joins_the_stack_whose_centre_it_links_to():
    stored = {10: Stack(10, {10: "centre", 11: "burst"})}
    changed, alone = place(
        [20],
        both((20, 10, "burst"), (20, 11, "burst")),
        {(20, 10): 0.99},
        {10: 10, 11: 10},
        lambda c: Stack(c, dict(stored[c].members)),
    )
    assert changed[10].members == {10: "centre", 11: "burst", 20: "burst"} and alone == []


def test_a_new_photo_linked_to_a_member_only_does_not_join():
    stored = {10: Stack(10, {10: "centre", 11: "burst"})}
    changed, alone = place(
        [20],
        both((20, 11, "burst")),
        {},
        {10: 10, 11: 10},
        lambda c: Stack(c, dict(stored[c].members)),
    )
    assert changed == {} and alone == [20]


def test_new_photos_stack_with_each_other_and_with_photos_in_none():
    changed, alone = place(
        [20, 21, 30],
        both((20, 21, "copy"), (21, 5, "burst"), (20, 5, "burst")),
        {},
        {},
        lambda c: pytest.fail("no stored stack"),
    )
    assert alone == [30]
    (stack,) = changed.values()
    assert set(stack.members) == {5, 20, 21}
    assert list(stack.members.values()).count("centre") == 1


def test_the_closest_centre_wins():
    stored = {10: Stack(10, {10: "centre", 11: "copy"}), 40: Stack(40, {40: "centre", 41: "copy"})}
    changed, _ = place(
        [20],
        both((20, 10, "burst"), (20, 40, "burst")),
        {(20, 10): 0.98, (20, 40): 0.995},
        {10: 10, 11: 10, 40: 40, 41: 40},
        lambda c: Stack(c, dict(stored[c].members)),
    )
    assert list(changed) == [40] and 20 in changed[40].members


# -- on Postgres --------------------------------------------------------------------


class Store:
    """ThumbnailStore stand-in: get only (the groups task never writes a thumbnail)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.lock = threading.Lock()
        self.reads = 0

    def get(self, path: str) -> bytes | None:
        with self.lock:
            self.reads += 1
        return self.objects.get(path)


def unit(rng: np.random.Generator) -> np.ndarray:
    v = rng.normal(size=DIM)
    return v / np.linalg.norm(v)


def near(v: np.ndarray, cosine: float, rng: np.random.Generator) -> np.ndarray:
    """A unit vector at exactly `cosine` from v."""
    u = unit(rng)
    u -= (u @ v) * v
    u /= np.linalg.norm(u)
    return cosine * v + np.sqrt(1 - cosine**2) * u


def setup_library(conn, specs: list[dict]) -> list[int]:
    """Photos with facts, thumbnails and embeddings: specs of {vector, size, taken, camera...}."""
    ids = add_photos(conn, [("image/jpeg", None)] * len(specs))
    for pid, spec in zip(ids, specs, strict=True):
        metadata = {
            "dimensions": {"width": spec.get("width", 4000), "height": spec.get("height", 3000)}
        }
        if spec.get("camera", True):
            metadata["camera"] = {"make": "NIKON", "model": "D7000"}
        if spec.get("taken"):
            metadata["date_taken"] = spec["taken"]
        conn.execute(
            "UPDATE photos SET metadata = %s, size = %s, thumbnail_status = 'generated', "
            "thumbnail_path = %s, s3_key = coalesce(%s, s3_key), mime_type = %s WHERE id = %s",
            (
                Jsonb(metadata),
                spec.get("size", 1000 + pid),
                f"thumbnails/{pid}.jpg",
                spec.get("key"),
                spec.get("mime", "image/jpeg"),
                pid,
            ),
        )
        conn.execute(
            "INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES (%s, %s, %s)",
            (pid, HalfVector(spec["vector"].astype(np.float32)), spec.get("model", MODEL)),
        )
    return ids


def thumbnails(store: Store, ids: list[int], sharp: dict[int, bool] | None = None) -> None:
    for pid in ids:
        store.objects[f"thumbnails/{pid}.jpg"] = jpeg((sharp or {}).get(pid, True))


def a_library(conn, store: Store) -> dict[str, list[int]]:
    """A burst of three, an exact copy pair, a photo two cameras took, and one alone."""
    rng = np.random.default_rng(7)
    burst, copy, alone = unit(rng), unit(rng), unit(rng)
    specs = [
        {"vector": burst, "taken": "2020-05-01T10:00:00.000Z"},
        {"vector": near(burst, 0.985, rng), "taken": "2020-05-01T10:00:05.000Z"},
        {"vector": near(burst, 0.985, rng), "taken": "2020-05-01T10:00:09.000Z"},
        {"vector": copy, "taken": "2019-01-01T00:00:00.000Z", "size": 5555},
        {"vector": copy, "taken": "2019-01-01T00:00:00.000Z", "size": 5555},
        {"vector": alone, "taken": "2018-01-01T00:00:00.000Z"},
    ]
    ids = setup_library(conn, specs)
    thumbnails(store, ids, {ids[0]: False})
    return {"burst": ids[:3], "copy": ids[3:5], "alone": ids[5:]}


def stacks_in(conn) -> dict[int, list[tuple[int, int, str]]]:
    out: dict[int, list] = {}
    for pid, group_id, place_, link in conn.execute(
        "SELECT photo_id, group_id, rank, link FROM photo_groups ORDER BY group_id, rank"
    ).fetchall():
        out.setdefault(group_id, []).append((pid, place_, link))
    return out


def counts(conn) -> tuple:
    return conn.execute(
        "SELECT (SELECT count(*) FROM photo_groups), (SELECT count(*) FROM analysis_jobs)"
    ).fetchone()


def test_a_rebuild_stacks_the_library_and_closes_every_job(conn, schema):
    store = Store()
    library = a_library(conn, store)
    summary = rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert (summary.stacks, summary.members) == (2, 5)
    found = stacks_in(conn)
    by_photo = {pid: (g, r, link) for g, rows in found.items() for pid, r, link in rows}
    burst = library["burst"]
    assert len({by_photo[pid][0] for pid in burst}) == 1
    # The blurred frame is not the one to keep
    assert by_photo[burst[0]][1] != 1
    a, b = library["copy"]
    assert {by_photo[a][2], by_photo[b][2]} == {"centre", "copy"}
    # Exact copies: the one held longest
    assert by_photo[a][1] == 1
    copy_of = dict(conn.execute("SELECT photo_id, copy_of FROM photo_groups").fetchall())
    assert copy_of[a] == copy_of[b] == a and copy_of[burst[1]] is None
    assert library["alone"][0] not in by_photo
    jobs_ = conn.execute(
        "SELECT status, model, count(*) FROM analysis_jobs WHERE task = %s GROUP BY 1, 2", (TASK,)
    ).fetchall()
    assert jobs_ == [("done", rules_model(), 6)]
    measures = conn.execute(
        "SELECT measures FROM photo_groups WHERE photo_id = %s", (a,)
    ).fetchone()[0]
    assert set(measures) == {*groups.WEIGHTS, "dated_folder"}


def test_a_rebuild_keeps_the_copy_of_the_dated_folder_and_the_jpeg_of_a_raw(conn, schema):
    store = Store()
    rng = np.random.default_rng(11)
    copy, shot = unit(rng), unit(rng)
    ids = setup_library(
        conn,
        [
            # Held longest, but sorted away
            {"vector": copy, "size": 7777, "key": "pc-fixe/A TRIER/TODO/a.jpg"},
            {"vector": copy, "size": 7777, "key": "pc-fixe/2013-04-13 - Japon/a.jpg"},
            {
                "vector": shot,
                "taken": "2020-03-01T10:00:00.000Z",
                "size": 32_000_000,
                "mime": "image/x-nikon-nef",
                "width": 6000,
                "height": 4000,
            },
            {
                "vector": near(shot, 0.95, rng),
                "taken": "2020-03-01T10:00:00.000Z",
                "size": 3_700_000,
            },
        ],
    )
    thumbnails(store, ids)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    first = {group: rows[0][0] for group, rows in stacks_in(conn).items()}
    assert sorted(first.values()) == [ids[1], ids[3]]


def test_a_thumbnail_unread_at_one_rebuild_is_measured_at_the_next(conn, schema):
    store = Store()
    library = a_library(conn, store)
    missing = library["burst"][1]
    del store.objects[f"thumbnails/{missing}.jpg"]
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)

    def sharp() -> float | None:
        return conn.execute(
            "SELECT measures->'sharp' FROM photo_groups WHERE photo_id = %s", (missing,)
        ).fetchone()[0]

    assert sharp() is None
    thumbnails(store, [missing])
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert sharp() > 0
    # One stored before as 0.0 and 0.0 (an unread one then) is read again too
    conn.execute(
        'UPDATE photo_groups SET measures = measures || \'{"sharp": 0.0, "clipped": 0.0}\''
        " WHERE photo_id = %s",
        (missing,),
    )
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert sharp() > 0


def test_a_dry_run_writes_nothing(conn, schema):
    store = Store()
    a_library(conn, store)
    summary = rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=True)
    assert summary.stacks == 2
    assert counts(conn) == (0, 0)


def test_a_folder_first_and_only_on_an_empty_table(conn, schema):
    store = Store()
    library = a_library(conn, store)
    other = conn.execute(
        "INSERT INTO folders (path, name) VALUES ('t/sub', 'sub') RETURNING id"
    ).fetchone()[0]
    conn.execute("UPDATE photos SET folder_id = %s WHERE id = ANY(%s)", (other, library["burst"]))
    summary = rebuild(
        lambda: connect(schema),
        Measurer(store, 2),
        Vocabulary.read(),
        dry_run=False,
        folder="t/sub",
    )
    assert (summary.photos, summary.stacks) == (3, 1)
    # The trial leaves the jobs alone
    assert counts(conn) == (3, 0)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    with pytest.raises(Aborted, match="first trial"):
        rebuild(
            lambda: connect(schema),
            Measurer(store, 2),
            Vocabulary.read(),
            dry_run=False,
            folder="t/sub",
        )
    assert counts(conn)[0] == 5


def test_a_rebuild_that_would_lose_half_the_stacks_stops(conn, schema):
    store = Store()
    library = a_library(conn, store)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    conn.execute("DELETE FROM photo_embeddings WHERE photo_id = ANY(%s)", (library["burst"],))
    with pytest.raises(Aborted, match="allow-shrink"):
        rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert counts(conn)[0] == 5
    rebuild(
        lambda: connect(schema),
        Measurer(store, 2),
        Vocabulary.read(),
        dry_run=False,
        allow_shrink=True,
    )
    assert counts(conn)[0] == 2


def test_photos_out_of_the_gallery_are_not_stacked(conn, schema):
    store = Store()
    library = a_library(conn, store)
    conn.execute("UPDATE photos SET s3_key = 'books/' || id WHERE id = ANY(%s)", (library["copy"],))
    conn.execute("INSERT INTO excluded_folders (path) VALUES ('books')")
    summary = rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=True)
    assert (summary.photos, summary.stacks) == (4, 1)


def hold_lease(conn, minutes: int = 10) -> None:
    """Another worker's 'groups' lease, lapsing in `minutes` (negative: lapsed)."""
    conn.execute(
        "INSERT INTO task_leases (task, owner, expires_at)"
        " VALUES ('groups', 'other:1', now() + %s * interval '1 minute')",
        (minutes,),
    )


def test_a_rebuild_waits_for_no_grouper(conn, schema):
    store = Store()
    a_library(conn, store)
    hold_lease(conn)
    with pytest.raises(Aborted, match="groups worker is running"):
        rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert counts(conn) == (0, 0)
    # A dry run takes no lease
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=True)
    # A lease whose holder died lapses: the next one takes it, and gives it back
    conn.execute("UPDATE task_leases SET expires_at = now() - interval '1 minute'")
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert counts(conn)[0] > 0
    assert conn.execute("SELECT count(*) FROM task_leases").fetchone()[0] == 0


def test_a_rebuild_does_not_undo_stacks_of_newer_rules(conn, schema):
    store = Store()
    a_library(conn, store)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    conn.execute(f"UPDATE photo_groups SET model = 'groups v{groups.VERSION + 1} 0000abcd'")
    with pytest.raises(Aborted, match="newer than"):
        rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    # Older ones it replaces: that is what a rebuild is for
    conn.execute("UPDATE photo_groups SET model = 'groups v1 0000abcd'")
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert {m for (m,) in conn.execute("SELECT DISTINCT model FROM photo_groups")} == {
        rules_model()
    }


def test_photos_in_the_corbeille_keep_their_stack_for_when_they_come_back(conn, schema):
    store = Store()
    library = a_library(conn, store)
    conn.execute("UPDATE photos SET trashed_at = now() WHERE id = ANY(%s)", (library["copy"][:1],))
    summary = rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=True)
    assert (summary.photos, summary.stacks) == (6, 2)


def test_a_rebuild_leaves_a_lot_of_the_corbeille_whole_and_restorable(conn, schema):
    """The app's marks (src/lib/trash.ts) survive a rebuild, and the lot comes back
    into its stack: the restore is trash.ts restoreLot's statement."""
    store = Store()
    library = a_library(conn, store)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    kept, thrown = library["copy"]
    conn.execute(
        """UPDATE photos SET trashed_at = now(), trashed_by = 'auto',
             trash_batch = 'auto-copies.other-test', trashed_for = %s WHERE id = %s""",
        (kept, thrown),
    )
    marks = "SELECT trashed_at, trashed_by, trash_batch, trashed_for FROM photos WHERE id = %s"
    before = conn.execute(marks, (thrown,)).fetchone()
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    assert conn.execute(marks, (thrown,)).fetchone() == before
    by_photo = {pid: g for g, rows in stacks_in(conn).items() for pid, _, _ in rows}
    assert by_photo[thrown] == by_photo[kept]
    restored = conn.execute(
        """UPDATE photos SET trashed_at = NULL, trashed_by = NULL, trash_batch = NULL,
             trashed_for = NULL
           WHERE trashed_at IS NOT NULL AND trash_batch = %s""",
        ("auto-copies.other-test",),
    ).rowcount
    assert restored == 1
    assert conn.execute(marks, (thrown,)).fetchone() == (None, None, None, None)
    assert {pid: g for g, rows in stacks_in(conn).items() for pid, _, _ in rows}[
        thrown
    ] == by_photo[kept]


def run_grouper(schema: str, store: Store, batch: int = 10) -> Grouper:
    grouper = Grouper(
        lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), "test", batch, 600
    )
    grouper.run()
    return grouper


def test_new_photos_join_their_stack_or_form_one(conn, schema):
    store = Store()
    library = a_library(conn, store)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    before = stacks_in(conn)
    rng = np.random.default_rng(11)
    (centre,) = [g for g in before if g in library["burst"]]
    centre_vector = np.array(
        conn.execute("SELECT embedding::text FROM photo_embeddings WHERE photo_id = %s", (centre,))
        .fetchone()[0]
        .strip("[]")
        .split(","),
        float,
    )
    centre_vector /= np.linalg.norm(centre_vector)
    alone_vector = np.array(
        conn.execute(
            "SELECT embedding::text FROM photo_embeddings WHERE photo_id = %s",
            (library["alone"][0],),
        )
        .fetchone()[0]
        .strip("[]")
        .split(","),
        float,
    )
    alone_vector /= np.linalg.norm(alone_vector)
    new = setup_library(
        conn,
        [
            # The burst, 4 s after its first frame
            {"vector": near(centre_vector, 0.99, rng), "taken": "2020-05-01T10:00:04.000Z"},
            # Taken again the second after the photo alone: they stack together
            {"vector": near(alone_vector, 0.99, rng), "taken": "2018-01-01T00:00:01.000Z"},
            {"vector": unit(rng), "taken": "2021-01-01T00:00:00.000Z"},
        ],
    )
    thumbnails(store, new)
    assert enqueue_all(conn, TASK, ready=groups.embedded_sql("p.id")) == 3

    grouper = run_grouper(schema, store)

    after = stacks_in(conn)
    burst_stack = next(rows for g, rows in after.items() if any(p == centre for p, _, _ in rows))
    assert new[0] in {p for p, _, _ in burst_stack} and len(burst_stack) == 4
    pair = next(rows for rows in after.values() if any(p == new[1] for p, _, _ in rows))
    assert {p for p, _, _ in pair} == {new[1], library["alone"][0]}
    assert new[2] not in {p for rows in after.values() for p, _, _ in rows}
    # Ranks stay 1..n in every stack
    for rows in after.values():
        assert [r for _, r, _ in rows] == list(range(1, len(rows) + 1))
    assert (grouper.counters.done, grouper.counters.stacked, grouper.counters.alone) == (3, 2, 1)
    statuses = conn.execute(
        "SELECT photo_id, status, stats FROM analysis_jobs WHERE task = %s AND photo_id = ANY(%s)",
        (TASK, new),
    ).fetchall()
    assert sorted((s[1:] for s in statuses), key=str) == [
        ("done", {"stacked": False}),
        ("done", {"stacked": True}),
        ("done", {"stacked": True}),
    ]
    # Nothing left: a second run claims nothing
    assert run_grouper(schema, store).counters.done == 0


def test_a_photo_out_of_the_gallery_is_skipped(conn, schema):
    store = Store()
    rng = np.random.default_rng(3)
    (pid,) = setup_library(conn, [{"vector": unit(rng), "taken": "2020-01-01T00:00:00.000Z"}])
    enqueue_all(conn, TASK, ready=groups.embedded_sql("p.id"))
    conn.execute("UPDATE photos SET s3_key = 'books/' || id WHERE id = %s", (pid,))
    conn.execute("INSERT INTO excluded_folders (path) VALUES ('books')")
    grouper = run_grouper(schema, store)
    assert grouper.counters.skipped == 1
    assert conn.execute(
        "SELECT status, last_error FROM analysis_jobs WHERE photo_id = %s", (pid,)
    ).fetchone() == ("skipped", EXCLUDED_NOTE)


def test_only_one_grouper_at_a_time(conn, schema):
    store = Store()
    rng = np.random.default_rng(5)
    setup_library(conn, [{"vector": unit(rng), "taken": "2020-01-01T00:00:00.000Z"}])
    enqueue_all(conn, TASK, ready=groups.embedded_sql("p.id"))
    hold_lease(conn)
    assert run_grouper(schema, store).counters.done == 0
    conn.execute("DELETE FROM task_leases")
    assert run_grouper(schema, store).counters.done == 1
    assert conn.execute("SELECT count(*) FROM task_leases").fetchone()[0] == 0


def test_a_grouper_adds_nothing_to_stacks_of_other_rules(conn, schema, caplog):
    store = Store()
    library = a_library(conn, store)
    rebuild(lambda: connect(schema), Measurer(store, 2), Vocabulary.read(), dry_run=False)
    conn.execute("UPDATE photo_groups SET model = 'groups v1 0000abcd'")
    conn.execute(
        "UPDATE analysis_jobs SET status = 'queued' WHERE task = %s AND photo_id = %s",
        (TASK, library["alone"][0]),
    )
    with caplog.at_level(logging.WARNING, logger="blaze_worker"):
        assert run_grouper(schema, store).counters.done == 0
    alerts = [r.getMessage() for r in caplog.records if r.getMessage().startswith("ALERT")]
    assert len(alerts) == 1
    assert "groups v1 0000abcd" in alerts[0] and rules_model() in alerts[0]
    # Its own: it goes on
    conn.execute("UPDATE photo_groups SET model = %s", (rules_model(),))
    assert run_grouper(schema, store).counters.done == 1


def test_only_photos_with_an_embedding_are_queued(conn):
    rng = np.random.default_rng(9)
    (with_vector,) = setup_library(conn, [{"vector": unit(rng)}])
    add_photos(conn, [("image/jpeg", None)])
    assert enqueue_all(conn, TASK, ready=groups.embedded_sql("p.id")) == 1
    assert conn.execute("SELECT photo_id FROM analysis_jobs").fetchall() == [(with_vector,)]
