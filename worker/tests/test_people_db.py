"""People against a real Postgres: seeds, decisions, and an expansion written twice."""

from __future__ import annotations

import uuid
from datetime import date

import numpy as np
import psycopg
import pytest
from pgvector import HalfVector
from psycopg.types.json import Jsonb

from blaze_worker.people import Thresholds, expand
from blaze_worker.people_store import (
    PeopleError,
    create_person,
    decide,
    find_person,
    load_faces,
    person_model,
    rejected_faces,
    set_seeds,
    sole_faces,
    summarize,
    write_expansion,
)

MODEL = "test/model"
LIMITS = Thresholds(auto=0.6, review=0.4)


class Library:
    def __init__(self, conn: psycopg.Connection) -> None:
        self.conn = conn
        self.rng = np.random.default_rng(5)
        a, b = self.rng.normal(size=(2, 512))
        b -= a * (a @ b) / (a @ a)
        self.her = (a / np.linalg.norm(a), b / np.linalg.norm(b))

    def looks(self, years: float) -> np.ndarray:
        """Her face at an age: turns from a to b over twelve years."""
        a, b = self.her
        angle = years / 12 * (np.pi / 2)
        return np.cos(angle) * a + np.sin(angle) * b

    def stranger(self) -> np.ndarray:
        v = self.rng.normal(size=512)
        return v / np.linalg.norm(v)

    def photo(self, folder: str, taken: str | None) -> int:
        folder_id = self.conn.execute(
            """
            INSERT INTO folders (path, name) VALUES (%s, %s)
            ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name RETURNING id
            """,
            (folder, folder.rsplit("/", 1)[-1]),
        ).fetchone()[0]
        return self.conn.execute(
            """
            INSERT INTO photos (folder_id, filename, s3_key, size, mime_type, modified_at, metadata)
            VALUES (%s, 'p.jpg', %s, 1000, 'image/jpeg', now(), %s) RETURNING id
            """,
            (folder_id, f"t/{uuid.uuid4()}", Jsonb({"date_taken": taken}) if taken else None),
        ).fetchone()[0]

    def face(self, photo: int, vector: np.ndarray, side: int = 200, noise: float = 0.0) -> int:
        v = vector + self.rng.normal(scale=noise / np.sqrt(512), size=512)
        v = (v / np.linalg.norm(v)).astype(np.float32)
        return self.conn.execute(
            """
            INSERT INTO faces (photo_id, box, landmarks, det_score, width_px, height_px,
                               sharpness, yaw, embedding, model)
            VALUES (%s, %s, %s, 0.9, %s, %s, 120, 0, %s, %s) RETURNING id
            """,
            (photo, [0.1, 0.1, 0.2, 0.2], [0.0] * 10, side, side, HalfVector(v), MODEL),
        ).fetchone()[0]


def face_row(conn: psycopg.Connection, face_id: int) -> tuple:
    return conn.execute(
        "SELECT person_id, assignment FROM faces WHERE id = %s", (face_id,)
    ).fetchone()


def candidate(conn: psycopg.Connection, person: int, face_id: int) -> tuple | None:
    return conn.execute(
        """
        SELECT status, decided_by, round(similarity::numeric, 2) FROM face_candidates
        WHERE person_id = %s AND face_id = %s
        """,
        (person, face_id),
    ).fetchone()


def run(conn: psycopg.Connection, person: int, limits: Thresholds = LIMITS):
    loaded = load_faces(conn, person_model(conn, person))
    result = expand(loaded.faces, person, rejected_faces(conn, person), limits)
    return write_expansion(conn, person, loaded.faces, loaded.taken, result)


def test_people_are_found_by_name_or_id_and_names_are_unique(conn):
    suzie = create_person(conn, "Suzie")
    assert suzie.birth_date is None
    assert find_person(conn, "suzie") == suzie
    assert find_person(conn, str(suzie.id)) == suzie
    with pytest.raises(PeopleError):
        create_person(conn, "SUZIE")
    with pytest.raises(PeopleError):
        find_person(conn, "Nobody")


def test_a_seed_by_photo_needs_a_single_face_and_a_photo_holds_a_person_once(conn):
    lib = Library(conn)
    suzie = create_person(conn, "Suzie")
    photo = lib.photo("/2014-11-29 x", "2014-11-29T17:17:15.000Z")
    woman = lib.face(photo, lib.stranger(), side=376)
    child = lib.face(photo, lib.looks(6), side=518)
    # Two faces: refused with both ids, whichever is larger
    with pytest.raises(PeopleError, match=f"face {woman}.*face {child}|face {child}.*face {woman}"):
        sole_faces(conn, [photo])
    alone = lib.photo("/2014-11-30 y", "2014-11-30T10:00:00.000Z")
    only = lib.face(alone, lib.looks(6), side=300)
    assert sole_faces(conn, [alone]) == {alone: only}
    with pytest.raises(PeopleError):
        set_seeds(conn, suzie.id, [woman, child])
    assert set_seeds(conn, suzie.id, [child]) == 1
    assert face_row(conn, child) == (suzie.id, "seed")
    # The owner's "not her" on the other face
    decide(conn, suzie.id, [], [woman], "owner")
    assert face_row(conn, woman) == (suzie.id, "rejected")
    assert candidate(conn, suzie.id, woman) == ("rejected", "owner", None)
    with pytest.raises(PeopleError):
        sole_faces(conn, [lib.photo("/empty", None)])


def test_a_face_named_as_someone_else_is_not_taken_silently(conn):
    lib = Library(conn)
    suzie, cousin = create_person(conn, "Suzie"), create_person(conn, "Léa")
    face = lib.face(lib.photo("/a", "2015-01-01T00:00:00.000Z"), lib.looks(7))
    set_seeds(conn, cousin.id, [face])
    with pytest.raises(PeopleError):
        set_seeds(conn, suzie.id, [face])
    with pytest.raises(PeopleError):
        decide(conn, suzie.id, [face], [], "owner")
    # Rejecting it for Suzie keeps it Léa's
    decide(conn, suzie.id, [], [face], "agent")
    assert face_row(conn, face) == (cousin.id, "seed")
    assert candidate(conn, suzie.id, face) == ("rejected", "agent", None)


def test_accepting_a_face_clears_the_other_proposals_of_its_photo(conn):
    lib = Library(conn)
    suzie = create_person(conn, "Suzie")
    set_seeds(conn, suzie.id, [lib.face(lib.photo("/s", "2015-01-01T00:00:00.000Z"), lib.looks(7))])
    photo = lib.photo("/g", "2015-02-01T00:00:00.000Z")
    her = lib.face(photo, lib.looks(7.1), noise=0.6)
    sister = lib.face(photo, 0.7 * lib.looks(7.1) + 0.7 * lib.stranger())
    conn.execute(
        """
        INSERT INTO face_candidates (person_id, face_id, similarity)
        VALUES (%s, %s, 0.5), (%s, %s, 0.45)
        """,
        (suzie.id, her, suzie.id, sister),
    )
    decide(conn, suzie.id, [her], [], "owner")
    assert face_row(conn, her) == (suzie.id, "manual")
    assert candidate(conn, suzie.id, her)[:2] == ("accepted", "owner")
    assert candidate(conn, suzie.id, sister) is None
    with pytest.raises(PeopleError):
        decide(conn, suzie.id, [sister], [], "owner")


def test_expansion_follows_her_writes_once_and_keeps_the_owners_decisions(conn):
    lib = Library(conn)
    suzie = create_person(conn, "Suzie")
    seed = lib.face(lib.photo("/2009-12-27 Noël", "2009-12-27T17:37:19.000Z"), lib.looks(1.2))
    set_seeds(conn, suzie.id, [seed])
    # One photo every two months from 2010 to 2013, with a stranger in some
    her_faces, strangers = [], []
    for n in range(24):
        year, month = 2010 + n // 6, 1 + 2 * (n % 6)
        photo = lib.photo(f"/{year}", f"{year}-{month:02d}-10T12:00:00.000Z")
        her_faces.append(lib.face(photo, lib.looks(1.2 + n / 6 + 1 / 12), noise=0.3))
        if n % 3 == 0:
            strangers.append(lib.face(photo, lib.stranger()))
    # The wedding: the camera clock says 2010-06, the folder 2011-04-30
    wedding = lib.photo("/A TRIER/2011-04-30 Mariage/civil", "2010-06-30T01:42:50.000Z")
    at_wedding = lib.face(wedding, lib.looks(1.2 + 16 / 12), noise=0.3)
    # A face between her and a stranger: for the owner to decide
    unsure_photo = lib.photo("/2012", "2012-03-01T00:00:00.000Z")
    unsure = lib.face(unsure_photo, 0.5 * lib.looks(3.4) + 0.866 * lib.stranger())

    loaded = load_faces(conn, MODEL)
    index = {int(f): i for i, f in enumerate(loaded.faces.ids)}
    assert loaded.taken[index[at_wedding]] == date(2011, 4, 30)

    accepted, pending, dropped = run(conn, suzie.id)
    assert accepted == len(her_faces) + 1
    assert pending == 1 and dropped == 0
    assert face_row(conn, her_faces[-1]) == (suzie.id, "auto")
    assert candidate(conn, suzie.id, her_faces[-1])[:2] == ("accepted", "auto")
    assert candidate(conn, suzie.id, unsure)[:2] == ("pending", None)
    assert all(face_row(conn, s) == (None, None) for s in strangers)

    # Same data, same answer: nothing new, nothing dropped
    assert run(conn, suzie.id) == (0, 1, 0)

    # The owner says no to the unsure face: never proposed again
    decide(conn, suzie.id, [], [unsure], "owner")
    assert run(conn, suzie.id) == (0, 0, 0)
    assert candidate(conn, suzie.id, unsure)[:2] == ("rejected", "owner")

    summary = summarize(conn, suzie.id)
    assert summary.by_assignment == {"seed": 1, "auto": len(her_faces) + 1}
    assert summary.rejected == 1 and summary.pending == 0
    assert summary.years[2011] == (7, 0)


def test_a_decision_taken_during_an_expansion_wins(conn):
    lib = Library(conn)
    suzie, cousin = create_person(conn, "Suzie"), create_person(conn, "Léa")
    set_seeds(conn, suzie.id, [lib.face(lib.photo("/s", "2015-01-01T00:00:00.000Z"), lib.looks(7))])
    near = lib.face(lib.photo("/n", "2015-03-01T00:00:00.000Z"), lib.looks(7.1), noise=0.2)
    loaded = load_faces(conn, MODEL)
    result = expand(loaded.faces, suzie.id, [], LIMITS)
    assert len(result.accepted) == 1
    # Meanwhile the owner names that face Léa
    set_seeds(conn, cousin.id, [near])
    assert write_expansion(conn, suzie.id, loaded.faces, loaded.taken, result) == (0, 0, 0)
    assert face_row(conn, near) == (cousin.id, "seed")
    assert candidate(conn, suzie.id, near) is None


def test_an_expansion_never_overrides_what_was_decided_while_it_ran(conn):
    lib = Library(conn)
    suzie, cousin = create_person(conn, "Suzie"), create_person(conn, "Léa")
    set_seeds(conn, suzie.id, [lib.face(lib.photo("/s", "2015-01-01T00:00:00.000Z"), lib.looks(7))])
    # A face rejected for Léa earlier: still open to Suzie
    once_lea = lib.face(lib.photo("/a", "2015-02-01T00:00:00.000Z"), lib.looks(7.05), noise=0.2)
    decide(conn, cousin.id, [], [once_lea], "owner")
    # A photo with two faces of her: the expansion takes one
    group = lib.photo("/g", "2015-03-01T00:00:00.000Z")
    first = lib.face(group, lib.looks(7.1), noise=0.2)
    second = lib.face(group, 0.6 * lib.looks(7.1) + 0.8 * lib.stranger())
    loaded = load_faces(conn, MODEL)
    result = expand(loaded.faces, suzie.id, [], LIMITS)
    assert {int(loaded.faces.ids[p.index]) for p in result.accepted} == {once_lea, first}
    # Meanwhile the owner says no to once_lea for Suzie, and yes to the other face of the group
    decide(conn, suzie.id, [second], [once_lea], "owner")
    assert write_expansion(conn, suzie.id, loaded.faces, loaded.taken, result) == (0, 0, 0)
    assert face_row(conn, once_lea) == (cousin.id, "rejected")
    assert candidate(conn, suzie.id, once_lea)[:2] == ("rejected", "owner")
    assert face_row(conn, first) == (None, None)
    assert face_row(conn, second) == (suzie.id, "manual")


def test_a_face_given_to_someone_leaves_the_others_queues(conn):
    lib = Library(conn)
    suzie, cousin = create_person(conn, "Suzie"), create_person(conn, "Léa")
    face = lib.face(lib.photo("/p", "2015-01-01T00:00:00.000Z"), lib.looks(7))
    conn.execute(
        "INSERT INTO face_candidates (person_id, face_id, similarity) VALUES (%s, %s, 0.4)",
        (suzie.id, face),
    )
    decide(conn, cousin.id, [face], [], "owner")
    assert candidate(conn, suzie.id, face) is None


def test_seeding_a_photo_that_already_holds_her_is_refused(conn):
    lib = Library(conn)
    suzie = create_person(conn, "Suzie")
    photo = lib.photo("/p", "2015-01-01T00:00:00.000Z")
    small = lib.face(photo, lib.looks(7), side=120)
    big = lib.face(photo, lib.stranger(), side=400)
    decide(conn, suzie.id, [small], [], "owner")
    with pytest.raises(PeopleError):
        set_seeds(conn, suzie.id, [big])
    # The database refuses it too, whoever writes
    with pytest.raises(psycopg.errors.UniqueViolation):
        conn.execute(
            "UPDATE faces SET person_id = %s, assignment = 'auto' WHERE id = %s",
            (suzie.id, big),
        )
