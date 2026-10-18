"""Finding a named person's faces across the years, from a few the owner picked.

A child's face changes too much between 1 and 17 for one picture of her to
find the others: ArcFace similarity between two photos of the same child a few
years apart falls to where strangers sit. What holds is recognition across a
short span. So a face is scored against the person's faces taken within 18
months of it (the window), and every face accepted becomes a reference for
its own window: the person is followed from one age to the next.

Following is also how it goes wrong: one wrong face accepted (a cousin, a
blurry stranger) becomes a reference and pulls its own lookalikes in. The
guards, all on the side of missing a face rather than taking a wrong one:

- only faces good enough to define someone (faces.cluster_eligible) become
  references; the owner's own picks always do, whatever their quality;
- a photo holds a person once: its best face only, and none when the person
  is already in it; two faces of one photo both close to her go to review;
- a face about as close to someone else the owner named, or to a face he
  rejected for this person, is not proposed (margin);
- with a birth date, nothing from before the year of birth;
- auto-acceptance needs a similarity measured to be precise (see the
  thresholds in cli.py); below it and above the review floor, the owner
  decides; under the floor, nothing is proposed.

Everything here is in memory and exact (numpy, no index): a library holds a
few hundred thousand faces, a person a few thousand.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime

import numpy as np

# Similarity from which a face is accepted without asking, and from which it
# is proposed to the owner. Measured on Suzie (2026-10, ages 0-12): 114 faces
# checked by eye as they were proposed (copies of one file counted once):
#   >= 0.60: 25 her, 0 not her      >= 0.50: 46 / 1      >= 0.45: 64 / 3
#   >= 0.30: 78 / 5 (the 5: one younger girl at one party, 0.36 to 0.55)
# Auto stays above the highest stranger seen (0.55); a few true faces sit as
# low as 0.20 (babies, sunglasses), so the floor is a queue-size choice.
AUTO_THRESHOLD = 0.60
REVIEW_THRESHOLD = 0.30
# 18 months: how far a reference face reaches
WINDOW_DAYS = 548
# EXIF and folder dates further apart than this: the camera clock was wrong
DATE_DISAGREEMENT_DAYS = 183
# Days value of a photo with no date: farther than any window from everything
NO_DATE = np.int32(-(10**8))
_EPOCH = date(1970, 1, 1)

# faces.assignment
SEED, MANUAL, AUTO, REJECTED = "seed", "manual", "auto", "rejected"
OWNED = frozenset({SEED, MANUAL, AUTO})

# Folder names carry their date in several shapes (same rules as
# src/lib/albums.ts parseAlbumName): "2011-04-30 Mariage", "07-12-2008-x",
# "20100416_Anni", "2018-01 ski". Day "00" means only the month is known.
_SEP = r"[\s_\-.@]*"
_FOLDER_DATE = (
    (re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?=\b|_|\s|$)" + _SEP), (1, 2, 3)),
    (re.compile(r"^(\d{2})-(\d{2})-(\d{4})(?=\b|_|\s|$)" + _SEP), (3, 2, 1)),
    (re.compile(r"^(\d{4})(\d{2})(\d{2})(?=_|\s|-|$)" + _SEP), (1, 2, 3)),
    (re.compile(r"^(\d{4})-(\d{2})(?=\b|_|\s|$)" + _SEP), (1, 2, None)),
)


def _date_of(year: int, month: int, day: int | None) -> date | None:
    if not 1900 <= year <= 2100 or not 1 <= month <= 12:
        return None
    if day is not None and not 1 <= day <= 31:
        return None
    try:
        # Month precision reads as its first day, like the app (parseAlbumName)
        return date(year, month, day or 1)
    except ValueError:
        return None


def segment_date(name: str) -> date | None:
    for pattern, (y, m, d) in _FOLDER_DATE:
        match = pattern.match(name)
        if not match:
            continue
        day = int(match.group(d)) if d is not None else None
        found = _date_of(int(match.group(y)), int(match.group(m)), day or None)
        if found is not None:
            return found
    return None


def folder_date(path: str) -> date | None:
    """Date of the deepest folder whose name starts with one."""
    for name in reversed([p for p in path.split("/") if p]):
        found = segment_date(name)
        if found is not None:
            return found
    return None


def exif_date(value: str | None) -> date | None:
    """metadata.date_taken: EXIF wall-clock time as ISO with a Z suffix."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def taken_on(exif: date | None, folder: date | None) -> tuple[date | None, str | None]:
    """When the photo was taken, and from what: 'exif', 'folder' or None.

    EXIF wins, unless a folder date says otherwise by more than six months: a
    camera whose clock was never set (2010-06 in a "2011-04-30 Mariage"
    folder) is more common than a folder named for the wrong year.
    """
    if exif is not None and (folder is None or abs((exif - folder).days) <= DATE_DISAGREEMENT_DAYS):
        return exif, "exif"
    if folder is not None:
        return folder, "folder"
    return None, None


def day_number(value: date | None) -> np.int32:
    return NO_DATE if value is None else np.int32((value - _EPOCH).days)


@dataclass(frozen=True)
class Faces:
    """Every face of one embedding model, as parallel arrays (index = row)."""

    ids: np.ndarray  # int64
    photo_ids: np.ndarray  # int64
    days: np.ndarray  # int32, NO_DATE when the photo has no date
    embeddings: np.ndarray  # (n, d), L2-normalized; float16 keeps 300k faces in 300 MB
    eligible: np.ndarray  # bool: faces.cluster_eligible
    person_ids: np.ndarray  # int64, 0 when nobody
    assignments: np.ndarray  # object: faces.assignment or None

    def __len__(self) -> int:
        return int(self.ids.shape[0])

    def index_of(self, face_ids: Iterable[int]) -> np.ndarray:
        lookup = {int(face_id): i for i, face_id in enumerate(self.ids)}
        return np.array([lookup[int(f)] for f in face_ids if int(f) in lookup], dtype=np.int64)


@dataclass(frozen=True)
class Thresholds:
    auto: float
    review: float
    margin: float = 0.02
    window_days: int = WINDOW_DAYS

    def __post_init__(self) -> None:
        if not self.review <= self.auto:
            raise ValueError("the review floor must not exceed the auto-accept threshold")


@dataclass(frozen=True)
class Proposal:
    index: int  # row in Faces
    similarity: float
    source: int  # row of the reference face it is closest to
    auto: bool
    round: int


@dataclass
class Expansion:
    accepted: list[Proposal] = field(default_factory=list)
    pending: list[Proposal] = field(default_factory=list)
    rounds: int = 0
    # Above the review floor, not proposed: closer to someone else / to a rejected face
    refused_other: int = 0
    refused_rejected: int = 0
    # Above the auto threshold, sent to review: another face of the photo is as close
    ambiguous: int = 0
    # The refused faces, for an audit: (row, similarity to the person, to the
    # closest competitor, "other" | "rejected")
    refused: list[tuple[int, float, float, str]] = field(default_factory=list)


def best_within(
    faces: Faces,
    sources: np.ndarray,
    window_days: int,
    best: np.ndarray,
    best_source: np.ndarray,
    chunk: int = 8192,
) -> None:
    """Raises best[i] to the highest similarity between face i and a source
    taken within the window (best_source[i]: that source). In place."""
    if sources.size == 0:
        return
    references = faces.embeddings[sources].astype(np.float32)
    reference_days = faces.days[sources].astype(np.int64)
    for start in range(0, len(faces), chunk):
        stop = min(start + chunk, len(faces))
        block = faces.embeddings[start:stop].astype(np.float32)
        sims = block @ references.T
        gaps = np.abs(faces.days[start:stop, None].astype(np.int64) - reference_days[None, :])
        sims[gaps > window_days] = -np.inf
        top = sims.argmax(axis=1)
        values = sims[np.arange(stop - start), top]
        better = values > best[start:stop]
        best[start:stop][better] = values[better]
        best_source[start:stop][better] = sources[top[better]]


def _empty_scores(n: int) -> tuple[np.ndarray, np.ndarray]:
    return np.full(n, -np.inf, dtype=np.float32), np.full(n, -1, dtype=np.int64)


def expand(
    faces: Faces,
    person_id: int,
    rejected_face_ids: Iterable[int],
    thresholds: Thresholds,
    born: date | None = None,
    max_rounds: int = 200,
) -> Expansion:
    """New faces of `person_id`: accepted ones (auto) and ones for the owner to decide.

    Reads the faces as they are (owner's seed/manual picks, earlier auto
    accepts, rejections) and changes nothing: the caller writes the result.
    Running it again on the written result proposes nothing new. With a
    birth date, nothing taken before that year is proposed (a baby cousin
    born earlier is the classic wrong match).
    """
    n = len(faces)
    dated = faces.days != NO_DATE
    too_early = (
        faces.days < day_number(date(born.year, 1, 1))
        if born is not None
        else np.zeros(n, dtype=bool)
    )
    owned = np.array([a in OWNED for a in faces.assignments], dtype=bool)
    mine = owned & (faces.person_ids == person_id)
    defines = mine & dated & (faces.eligible | (faces.assignments != AUTO))

    others = owned & (faces.person_ids != person_id) & (faces.person_ids != 0)
    other_defines = others & dated & (faces.eligible | (faces.assignments != AUTO))
    other_best, _ = _empty_scores(n)
    best_within(
        faces,
        np.flatnonzero(other_defines),
        thresholds.window_days,
        other_best,
        np.full(n, -1, dtype=np.int64),
    )

    rejected = np.zeros(n, dtype=bool)
    rejected[faces.index_of(rejected_face_ids)] = True
    rejected |= (faces.assignments == REJECTED) & (faces.person_ids == person_id)
    rejected_best, _ = _empty_scores(n)
    best_within(
        faces,
        np.flatnonzero(rejected & dated),
        thresholds.window_days,
        rejected_best,
        np.full(n, -1, dtype=np.int64),
    )

    # A photo holds a person once
    photo_taken = set(faces.photo_ids[mine].tolist())
    blocked = owned | rejected | ~dated | too_early
    blocked |= np.isin(faces.photo_ids, list(photo_taken))

    best, best_source = _empty_scores(n)
    frontier = np.flatnonzero(defines)
    result = Expansion()
    margin = thresholds.margin

    def proposals() -> tuple[list[int], set[int], np.ndarray, np.ndarray]:
        open_ = ~blocked & (best >= thresholds.review)
        refused_other = open_ & (other_best >= best - margin)
        refused_rejected = open_ & ~refused_other & (rejected_best >= best - margin)
        allowed = np.flatnonzero(open_ & ~refused_other & ~refused_rejected)
        # Best face of each photo; ambiguous when the next one is as close
        allowed = allowed[np.lexsort((-best[allowed], faces.photo_ids[allowed]))]
        winners: list[int] = []
        ambiguous: set[int] = set()
        for i in allowed.tolist():
            if not winners or faces.photo_ids[i] != faces.photo_ids[winners[-1]]:
                winners.append(i)
            elif best[i] >= best[winners[-1]] - margin:
                ambiguous.add(winners[-1])
        return winners, ambiguous, refused_other, refused_rejected

    while True:
        result.rounds += 1
        best_within(faces, frontier, thresholds.window_days, best, best_source)
        winners, ambiguous, refused_other, refused_rejected = proposals()
        new = [i for i in winners if best[i] >= thresholds.auto and i not in ambiguous]
        if not new or result.rounds >= max_rounds:
            break
        result.accepted.extend(
            Proposal(i, float(best[i]), int(best_source[i]), True, result.rounds) for i in new
        )
        accepted = np.array(new, dtype=np.int64)
        blocked |= np.isin(faces.photo_ids, faces.photo_ids[accepted])
        frontier = accepted[faces.eligible[accepted]]

    result.refused_other = int(refused_other.sum())
    result.refused_rejected = int(refused_rejected.sum())
    result.refused = [
        (int(i), float(best[i]), float(other_best[i]), "other")
        for i in np.flatnonzero(refused_other)
    ] + [
        (int(i), float(best[i]), float(rejected_best[i]), "rejected")
        for i in np.flatnonzero(refused_rejected)
    ]
    result.ambiguous = sum(1 for i in ambiguous if best[i] >= thresholds.auto)
    # Past max_rounds, what would have been accepted waits for the owner too
    result.pending = [
        Proposal(i, float(best[i]), int(best_source[i]), False, result.rounds) for i in winners
    ]
    return result
