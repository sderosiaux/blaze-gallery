"""Expansion without a database: dates, windows, and the guards against chaining."""

from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from blaze_worker.people import (
    AUTO,
    MANUAL,
    NO_DATE,
    REJECTED,
    SEED,
    Faces,
    Thresholds,
    expand,
    folder_date,
    taken_on,
)

DIM = 64
SUZIE, COUSIN = 1, 2
LIMITS = Thresholds(auto=0.6, review=0.4)


# -- dates ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (
            "pc-fixe/A TRIER/TODO/PHOTOS 2/2011-04-30 Mariage/mariage civil celine stefi 5",
            date(2011, 4, 30),
        ),
        ("pc-fixe/2009-12-27 - Noël @ Armentières", date(2009, 12, 27)),
        ("a/07-12-2008-disneyland", date(2008, 12, 7)),
        ("a/20100416_Anni Dadou", date(2010, 4, 16)),
        ("a/2018-01 ski", date(2018, 1, 1)),
        ("a/2018-01-00 ski", date(2018, 1, 1)),
        ("a/2018-13-01 nope", None),
        ("pc-fixe/Backup Windows Phone", None),
        ("2015-06-01 parent/IMG 2016", date(2015, 6, 1)),
        # icloudpd files photos by year then month: WhatsApp images have no EXIF date
        ("icloud/2026/10", date(2026, 10, 1)),
        ("icloud/2019/3", date(2019, 3, 1)),
        ("icloud/2026/13", None),
        ("photos/10", None),
        ("a/2018-01 ski/05", date(2018, 1, 1)),
    ],
)
def test_folder_date_is_the_deepest_dated_folder(path, expected):
    assert folder_date(path) == expected


def test_exif_wins_unless_the_folder_says_otherwise_by_more_than_six_months():
    folder = date(2011, 4, 30)
    # 223694: camera clock left at 2010-06 at a wedding in April 2011
    assert taken_on(date(2010, 6, 30), folder) == (folder, "folder")
    assert taken_on(date(2011, 5, 2), folder) == (date(2011, 5, 2), "exif")
    assert taken_on(date(2011, 1, 2), None) == (date(2011, 1, 2), "exif")
    assert taken_on(None, folder) == (folder, "folder")
    assert taken_on(None, None) == (None, None)


# -- synthetic faces ----------------------------------------------------------


class Library:
    """Faces built one by one; embeddings drift with time like a growing child."""

    def __init__(self, seed: int = 7) -> None:
        self.rng = np.random.default_rng(seed)
        self.rows: list[dict] = []
        self.photo = 0

    def identity(self) -> tuple[np.ndarray, np.ndarray]:
        a, b = self.rng.normal(size=(2, DIM))
        b -= a * (a @ b) / (a @ a)
        return a / np.linalg.norm(a), b / np.linalg.norm(b)

    @staticmethod
    def at(identity: tuple[np.ndarray, np.ndarray], day: int, years: float = 12) -> np.ndarray:
        """Turns from a to b over the years: similarity across 10 years falls near zero."""
        a, b = identity
        angle = (day / 365) / years * (np.pi / 2)
        return np.cos(angle) * a + np.sin(angle) * b

    def add(
        self,
        vector: np.ndarray,
        day: int | None,
        *,
        noise: float = 0.25,
        eligible: bool = True,
        person: int = 0,
        assignment: str | None = None,
        photo: int | None = None,
    ) -> int:
        if photo is None:
            self.photo += 1
            photo = self.photo
        v = vector + self.rng.normal(scale=noise / np.sqrt(DIM), size=DIM)
        self.rows.append(
            {
                "id": len(self.rows) + 1,
                "photo": photo,
                "day": NO_DATE if day is None else day,
                "v": v / np.linalg.norm(v),
                "eligible": eligible,
                "person": person,
                "assignment": assignment,
            }
        )
        return len(self.rows)

    def set(self, face_id: int, person: int, assignment: str) -> None:
        self.rows[face_id - 1]["person"] = person
        self.rows[face_id - 1]["assignment"] = assignment

    def faces(self) -> Faces:
        return Faces(
            ids=np.array([r["id"] for r in self.rows], dtype=np.int64),
            photo_ids=np.array([r["photo"] for r in self.rows], dtype=np.int64),
            days=np.array([r["day"] for r in self.rows], dtype=np.int32),
            embeddings=np.stack([r["v"] for r in self.rows]).astype(np.float16),
            eligible=np.array([r["eligible"] for r in self.rows], dtype=bool),
            person_ids=np.array([r["person"] for r in self.rows], dtype=np.int64),
            assignments=np.array([r["assignment"] for r in self.rows], dtype=object),
        )


def ids_of(faces: Faces, proposals) -> set[int]:
    return {int(faces.ids[p.index]) for p in proposals}


def apply(library: Library, faces: Faces, result, person: int) -> None:
    for p in result.accepted:
        library.set(int(faces.ids[p.index]), person, AUTO)


def growing_child(library: Library, years: int = 10, every: int = 45) -> tuple[list[int], tuple]:
    me = library.identity()
    faces = [library.add(library.at(me, day), day) for day in range(0, years * 365, every)]
    return faces, me


# -- expansion ----------------------------------------------------------------


def test_follows_a_child_across_years_from_one_seed():
    library = Library()
    child, identity = growing_child(library)
    library.set(child[0], SUZIE, SEED)
    first = library.faces()
    # The seed alone does not reach her at 9: the window and the chain do
    assert float(library.at(identity, 0) @ library.at(identity, 9 * 365)) < 0.4
    result = expand(first, SUZIE, [], LIMITS)
    assert ids_of(first, result.accepted) == set(child[1:])
    assert result.rounds > 3
    assert not result.pending


def test_window_keeps_faces_years_away_from_matching_directly():
    library = Library()
    me = library.identity()
    seed = library.add(library.at(me, 0), 0, noise=0.0)
    library.set(seed, SUZIE, SEED)
    # The same face, but dated three years later: outside the window, no bridge
    far = library.add(library.at(me, 0), 3 * 365, noise=0.0)
    near = library.add(library.at(me, 0), 300, noise=0.0)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    assert ids_of(faces, result.accepted) == {near}
    assert far not in ids_of(faces, result.accepted + result.pending)


def test_undated_faces_are_never_proposed():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0), SUZIE, SEED)
    undated = library.add(library.at(me, 0), None)
    faces = library.faces()
    assert undated not in ids_of(faces, expand(faces, SUZIE, [], LIMITS).accepted)


def test_bands_auto_review_drop():
    library = Library(seed=3)
    me = library.identity()
    her = library.at(me, 0)
    seed = library.add(her, 0, noise=0.0)
    library.set(seed, SUZIE, SEED)
    # Mixes of her and a stranger each (orthogonal to her and to each other)
    basis, _ = np.linalg.qr(np.column_stack([her, library.rng.normal(size=(DIM, 3))]))
    made = {}
    for target, other in zip((0.9, 0.5, 0.3), basis.T[1:], strict=True):
        v = target * her + np.sqrt(1 - target**2) * other
        made[target] = library.add(v, 10, noise=0.0)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    assert ids_of(faces, result.accepted) == {made[0.9]}
    assert ids_of(faces, result.pending) == {made[0.5]}


def test_a_photo_holds_a_person_once():
    library = Library()
    me = library.identity()
    seed = library.add(library.at(me, 0), 0, photo=100)
    library.set(seed, SUZIE, SEED)
    # Another face of the seed's photo: never her
    twin_in_seed_photo = library.add(library.at(me, 0), 0, photo=100)
    # Two faces of one photo, one clearly closer: only that one
    close = library.add(library.at(me, 0), 20, noise=0.1, photo=200)
    library.add(0.7 * library.at(me, 0) + 0.7 * library.identity()[0], 20, noise=0.0, photo=200)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    proposed = ids_of(faces, result.accepted + result.pending)
    assert twin_in_seed_photo not in proposed
    assert ids_of(faces, result.accepted) == {close}
    assert [faces.photo_ids[p.index] for p in result.pending].count(200) == 0


def test_two_equally_close_faces_of_one_photo_go_to_review():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0, noise=0.0), SUZIE, SEED)
    first = library.add(library.at(me, 0), 30, noise=0.05, photo=300)
    second = library.add(library.at(me, 0), 30, noise=0.05, photo=300)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    assert not result.accepted
    assert ids_of(faces, result.pending) <= {first, second}
    assert len(result.pending) == 1
    assert result.ambiguous == 1


def test_a_face_as_close_to_someone_else_named_is_not_proposed():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0, noise=0.0), SUZIE, SEED)
    # The cousin looks like her: same base, a different turn
    cousin = (library.at(me, 0) + library.identity()[0] * 0.3) / np.linalg.norm(
        library.at(me, 0) + library.identity()[0] * 0.3
    )
    library.set(library.add(cousin, 0, noise=0.0), COUSIN, MANUAL)
    cousin_again = library.add(cousin, 40, noise=0.0)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    assert cousin_again not in ids_of(faces, result.accepted + result.pending)
    assert result.refused_other == 1


def test_rejected_faces_are_never_proposed_and_push_their_lookalikes_out():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0, noise=0.0), SUZIE, SEED)
    stranger = 0.62 * library.at(me, 0) + 0.78 * library.identity()[0]
    rejected = library.add(stranger, 10, noise=0.0)
    lookalike = library.add(stranger, 12, noise=0.02)
    faces = library.faces()
    first = expand(faces, SUZIE, [], LIMITS)
    assert {rejected, lookalike} & ids_of(faces, first.accepted)
    # Through face_candidates, or through faces.assignment: both count
    for rejection in ([rejected], []):
        if not rejection:
            library.set(rejected, SUZIE, REJECTED)
        faces = library.faces()
        again = expand(faces, SUZIE, rejection, LIMITS)
        assert not {rejected, lookalike} & ids_of(faces, again.accepted + again.pending)
        assert again.refused_rejected == 1


def test_faces_too_poor_to_define_her_are_matched_but_do_not_extend_the_chain():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0, noise=0.0), SUZIE, SEED)
    poor = library.add(library.at(me, 400), 400, noise=0.0, eligible=False)
    # Only reachable through the poor face: 400 + 500 days, too far from the seed
    beyond = library.add(library.at(me, 400), 900, noise=0.0)
    faces = library.faces()
    result = expand(faces, SUZIE, [], LIMITS)
    assert ids_of(faces, result.accepted) == {poor}
    assert beyond not in ids_of(faces, result.accepted + result.pending)


def test_owner_picks_define_her_whatever_their_quality():
    library = Library()
    me = library.identity()
    library.set(library.add(library.at(me, 0), 0, noise=0.0, eligible=False), SUZIE, SEED)
    near = library.add(library.at(me, 0), 100, noise=0.0)
    faces = library.faces()
    assert ids_of(faces, expand(faces, SUZIE, [], LIMITS).accepted) == {near}


def test_running_again_on_the_written_result_changes_nothing():
    library = Library(seed=11)
    child, _ = growing_child(library, years=6)
    library.set(child[0], SUZIE, SEED)
    strangers = [library.add(library.identity()[0], day) for day in range(0, 2000, 100)]
    faces = library.faces()
    first = expand(faces, SUZIE, [], Thresholds(auto=0.6, review=0.1))
    apply(library, faces, first, SUZIE)
    faces = library.faces()
    second = expand(faces, SUZIE, [], Thresholds(auto=0.6, review=0.1))
    assert not second.accepted
    assert ids_of(faces, second.pending) == ids_of(faces, first.pending)
    assert not set(strangers) & ids_of(faces, first.accepted)


def test_nothing_before_the_year_of_birth_once_it_is_known():
    library = Library()
    me = library.identity()
    # Day 0 is 1970-01-01: seed in 1972, a lookalike baby in 1971
    library.set(library.add(library.at(me, 0), 2 * 365, noise=0.0), SUZIE, SEED)
    earlier = library.add(library.at(me, 0), 365 + 200, noise=0.0)
    faces = library.faces()
    assert ids_of(faces, expand(faces, SUZIE, [], LIMITS).accepted) == {earlier}
    born = expand(faces, SUZIE, [], LIMITS, born=date(1972, 3, 1))
    assert not born.accepted and not born.pending


def test_review_floor_cannot_exceed_auto():
    with pytest.raises(ValueError):
        Thresholds(auto=0.4, review=0.5)
