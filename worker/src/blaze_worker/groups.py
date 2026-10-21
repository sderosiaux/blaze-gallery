"""The groups task: near-duplicates stacked behind the best of them (photo_groups).

Bursts, shots taken again within seconds, edits, resized and exact copies
are different files whose SigLIP2 embeddings (embed task) barely differ.
Two photos are linked when one of these rules holds:

  copy    same size in bytes, same dimensions, cosine >= 0.999 (the sync
          stores no hash; this is the closest the database knows)
  burst   same camera (EXIF make and model), taken the same second and
          cosine >= 0.90, or within 30 s and cosine >= 0.975
  same    cosine >= 0.985 and the same picture: identical once shrunk for
          the same camera more than 30 s apart (IDENTICAL_SHARE), alike once
          shrunk when one of them has no camera date (DIFFERENT_SHARE); a
          change of shape (a crop) passes on its cosine

and never otherwise: two cameras never make a near-duplicate (two people
photographing one view), and screens, documents and images under MIN_SIDE
px only stack as exact copies (pages and flags look alike to the model).
Every member of a stack must be linked to its centre itself, so a slow
series cannot chain into one long stack, and the photos with the most
links claim theirs first, so centres sit in the middle of a burst.

The centre-based grouping and the pixel test come from Orchard
(https://github.com/chaseleantj/orchard, server/groups.py), MIT licence,
Copyright (c) 2026 Chase Lean. Its one threshold (0.9775) was measured on
siglip2-base-patch16-256; on this library and our model it stacks the
Grand Canyon over three hours and the sea over ten minutes, so the camera
and the time taken decide here. Measured 2026-10-20, pairs judged by eye:

  same camera, same second, 0.90..0.95    16/16 the same picture or moment
                            0.85..0.90    11/16
  same camera, 1..10 s,  >= 0.975         16/16    0.96..0.975: 12/16
  same camera, 10..30 s, >= 0.975         31/32    0.96..0.975:  8/16
  no camera date, >= 0.985, pixel test    20/20    without the test: 11/16
  two cameras, >= 0.95                     0/16
  Orchard's file-name rule ("photo (1)")  about half of 191 pairs wrong
                                          (numbered names, not copies)

On the whole library that made 43,334 stacks and put 79,232 photos behind
another (34,589 of them exact copies); none of 40 stacks drawn at random,
nor of 40 drawn in proportion to their size, held a photo of another moment.

A stack is ranked by a score (rank 1: the photo to keep), a weighted sum of
measures (WEIGHTS) read from the 400 px thumbnail and the faces task's rows.

Two ways to run. rebuild(): every embedding at once in numpy, all pairs by
blocks of rows, the table replaced in one transaction and every photo's job
marked done. Grouper: the queued photos (new ones, weekly), each compared
with its nearest neighbours through the HNSW index; it joins a stack whose
centre it is linked to, or forms new stacks with photos in none. One
Grouper at a time (an advisory lock).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import threading
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import numpy as np
import psycopg
from PIL import Image

from . import jobs
from .gallery import EXCLUDED_NOTE, out_of_gallery
from .siglip import DIM, MODEL
from .store import LeaseLost, replace_groups, save_groups
from .tags import Vocabulary, embedded_sql, load_embeddings

log = logging.getLogger("blaze_worker")

TASK = "groups"
VERSION = 1

COPY_COSINE = 0.999
SAME_SECOND_COSINE = 0.90
BURST_SECONDS = 30
BURST_COSINE = 0.975
SAME_COSINE = 0.985
# No rule links two photos below it
FLOOR = SAME_SECOND_COSINE
# The pixel test (Orchard's): grey at LOOK_EDGE px square, the share of
# pixels differing by more than DIFFERENT_LEVEL of 255. Resized copies stay
# under DIFFERENT_SHARE, two moments of one view (waves, a passer-by) go
# over. Frames of a timelapse measure 0.01 to 0.03, so the same camera
# beyond the burst window needs IDENTICAL_SHARE: copies whose clock was
# shifted, black frames.
LOOK_EDGE = 64
DIFFERENT_LEVEL = 32
DIFFERENT_SHARE = 0.03
IDENTICAL_SHARE = 0.005
# Two aspect ratios this close (log of their ratio) are one shape
SAME_SHAPE = 0.02
# Under it (short side, px) the model sees too little: exact copies only
MIN_SIDE = 100
# Screens and documents (db/tags.json): exact copies only
SCREEN_TAG = "ecran_document"

# Sharpness is measured at one size, the thumbnail's long side
SHARP_EDGE = 400
# Clipped: as dark or as bright as a pixel goes
CRUSHED_LEVEL = 5
BLOWN_LEVEL = 250
# A face counts when its box spans this share of the picture both ways
FACE_SIDE = 0.02
# Eyes closed: both measured, the wider one under this (~0.3 open,
# db/schema.sql), the head not looking down (the lids then read closed)
CLOSED_EYES = 0.15
LOOKING_DOWN = -10.0
# A face box this close to the edge is cut by it
EDGE_MARGIN = 0.005

# A member's score within its stack: the sum of weight x measure.
#   sharp       log2 of the Laplacian's variance at SHARP_EDGE (+1: twice as sharp)
#   pixels      log2 of width x height (a copy at half the side: -2)
#   bytes       log2 of the file size (the same pixels, less compression)
#   clipped     share of the picture crushed to black or blown to white
#   faces       faces found (someone who turned away is a face fewer)
#   blinks      faces with their eyes closed
#   cut         faces cut by the picture's edge
#   face_sharp  mean log2 sharpness of the faces (aligned 112 px crops of the original)
#   smile       mean happiness of the faces, 0..1
#   sideways    1 when the faces were found only on the picture turned: it shows on its side
# face_sharp and smile, unknown on a member without faces, take the stack's
# median there, so only members with faces compare on them.
WEIGHTS: dict[str, float] = {
    "sharp": 1.0,
    "pixels": 0.5,
    "bytes": 0.25,
    "clipped": -10.0,
    "faces": 0.5,
    "blinks": -1.5,
    "cut": -1.0,
    "face_sharp": 0.5,
    "smile": 1.0,
    "sideways": -3.0,
}
MEDIAN_FILLED = ("face_sharp", "smile")

# Grouper: neighbours read per new photo (the largest burst holds 87)
NEIGHBOURS = 100
# rebuild: rows of the similarity matrix per block (BLOCK x photos floats)
BLOCK = 1024
# Two Groupers would stack the same photos at once
LOCK = 0x626C617A6567  # "blazeg"


def rules_model() -> str:
    """photo_groups.model and the groups jobs' model: embedding space, rules and weights."""
    rules = [
        COPY_COSINE,
        SAME_SECOND_COSINE,
        BURST_SECONDS,
        BURST_COSINE,
        SAME_COSINE,
        LOOK_EDGE,
        DIFFERENT_LEVEL,
        DIFFERENT_SHARE,
        IDENTICAL_SHARE,
        SAME_SHAPE,
        MIN_SIDE,
        SCREEN_TAG,
        SHARP_EDGE,
        WEIGHTS,
    ]
    digest = hashlib.sha256(json.dumps([MODEL, rules], sort_keys=True).encode()).hexdigest()
    return f"groups v{VERSION} {digest[:8]}"


# -- what is known of a photo -------------------------------------------------------


@dataclass(frozen=True)
class Photo:
    id: int
    size: int
    width: int
    height: int
    # EXIF make and model, None without
    camera: str | None
    # When taken, in seconds; only from a camera's date (None without a camera)
    taken: float | None
    # Tagged as a screen or a document
    screen: bool
    thumbnail: str | None
    # The owner's turn (metadata.user_rotation), which the thumbnail shows
    rotation: int = 0

    @property
    def shape(self) -> float:
        """log of the aspect ratio as shown: dimensions are upright, the owner's quarter
        turns swap them."""
        width, height = max(self.width, 1), max(self.height, 1)
        if self.rotation % 180 == 90:
            width, height = height, width
        return math.log(width / height)

    @property
    def plain(self) -> bool:
        """The model can tell it apart: large enough, not a screen."""
        return min(self.width, self.height) >= MIN_SIDE and not self.screen


def taken_at(value: str | None, camera: str | None) -> float | None:
    if not value or camera is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _photos_sql(where: str) -> str:
    return f"""
    SELECT p.id, p.size,
           coalesce((p.metadata -> 'dimensions' ->> 'width')::int, 0),
           coalesce((p.metadata -> 'dimensions' ->> 'height')::int, 0),
           CASE WHEN p.metadata -> 'camera' ->> 'make' IS NOT NULL
                THEN (p.metadata -> 'camera' ->> 'make') || '|'
                     || coalesce(p.metadata -> 'camera' ->> 'model', '') END,
           p.metadata ->> 'date_taken',
           EXISTS (SELECT 1 FROM photo_tags t WHERE t.photo_id = p.id AND t.tag = %(screen_tag)s
                   AND t.score >= %(screen_score)s AND t.vocab_version = %(vocabulary)s),
           p.thumbnail_path,
           coalesce((p.metadata ->> 'user_rotation')::int, 0)
    FROM photos p
    WHERE p.mime_type LIKE 'image/%%' AND NOT {out_of_gallery()}
      AND {embedded_sql("p.id")}
      AND {where}
    ORDER BY p.id
    """


def load_photos(
    conn: psycopg.Connection, vocabulary: Vocabulary, where: str = "true", **params: Any
) -> list[Photo]:
    """The gallery's images with an embedding (photos p) that pass `where`, by id."""
    screen = next(t for t in vocabulary.tags if t.tag == SCREEN_TAG)
    values = {
        "screen_tag": SCREEN_TAG,
        "screen_score": screen.threshold,
        "vocabulary": vocabulary.version,
        **params,
    }
    return [
        Photo(pid, size, width, height, camera, taken_at(taken, camera), screen, thumb, rotation)
        for pid, size, width, height, camera, taken, screen, thumb, rotation in conn.execute(
            _photos_sql(where), values
        ).fetchall()
    ]


# -- which pairs are linked ---------------------------------------------------------

NONE, COPY, BURST, SAME, IDENTICAL, ALIKE = range(6)
LINK = {COPY: "copy", BURST: "burst", SAME: "same"}


@dataclass(frozen=True)
class Columns:
    """Photos as arrays, to test many pairs at once."""

    size: np.ndarray
    width: np.ndarray
    height: np.ndarray
    camera: np.ndarray  # one integer per make and model, -1 without
    taken: np.ndarray  # nan without
    shape: np.ndarray
    plain: np.ndarray

    @classmethod
    def of(cls, photos: Sequence[Photo]) -> Columns:
        cameras: dict[str, int] = {}
        return cls(
            size=np.array([p.size for p in photos], np.int64),
            width=np.array([p.width for p in photos], np.int64),
            height=np.array([p.height for p in photos], np.int64),
            camera=np.array(
                [
                    -1 if p.camera is None else cameras.setdefault(p.camera, len(cameras))
                    for p in photos
                ],
                np.int64,
            ),
            taken=np.array([np.nan if p.taken is None else p.taken for p in photos], np.float64),
            shape=np.array([p.shape for p in photos], np.float64),
            plain=np.array([p.plain for p in photos], bool),
        )


def classify(c: Columns, i: np.ndarray, j: np.ndarray, cosine: np.ndarray) -> np.ndarray:
    """Per pair of rows (i[k], j[k]): COPY, BURST, SAME, NONE, or IDENTICAL / ALIKE when a
    pixel test decides (settle)."""
    code = np.full(len(i), NONE, np.int8)
    same_camera = (c.camera[i] >= 0) & (c.camera[i] == c.camera[j])
    two_cameras = (c.camera[i] >= 0) & (c.camera[j] >= 0) & ~same_camera
    with np.errstate(invalid="ignore"):
        gap = np.abs(c.taken[i] - c.taken[j])
        timed = same_camera & ~np.isnan(gap)
        same_second = timed & (gap < 1)
        burst = timed & (gap >= 1) & (gap <= BURST_SECONDS)
        later = timed & (gap > BURST_SECONDS)
    same_shape = np.abs(c.shape[i] - c.shape[j]) <= SAME_SHAPE
    code[same_second & (cosine >= SAME_SECOND_COSINE)] = BURST
    code[burst & (cosine >= BURST_COSINE)] = BURST
    code[later & same_shape & (cosine >= SAME_COSINE)] = IDENTICAL
    untimed = ~timed & ~two_cameras & (cosine >= SAME_COSINE)
    code[untimed & same_shape] = ALIKE
    code[untimed & ~same_shape] = SAME
    code[~(c.plain[i] & c.plain[j])] = NONE
    copy = (
        (c.size[i] == c.size[j])
        & (c.width[i] == c.width[j])
        & (c.height[i] == c.height[j])
        & (cosine >= COPY_COSINE)
    )
    code[copy] = COPY
    return code


def look(data: bytes) -> np.ndarray:
    """A picture in grey at LOOK_EDGE px square, to compare two pixel by pixel."""
    with Image.open(io.BytesIO(data)) as image:
        grey = image.convert("L").resize((LOOK_EDGE, LOOK_EDGE), Image.Resampling.BOX)
    return np.asarray(grey, np.int16)


def different_share(a: np.ndarray, b: np.ndarray) -> float:
    return float((np.abs(a - b) > DIFFERENT_LEVEL).mean())


def settle(code: np.ndarray, shares: np.ndarray) -> np.ndarray:
    """IDENTICAL and ALIKE become SAME or NONE by their pixel share (nan, no thumbnail: NONE)."""
    out = code.copy()
    identical, alike = code == IDENTICAL, code == ALIKE
    with np.errstate(invalid="ignore"):
        out[identical] = np.where(shares[identical] <= IDENTICAL_SHARE, SAME, NONE)
        out[alike] = np.where(shares[alike] <= DIFFERENT_SHARE, SAME, NONE)
    return out


def gather(n: int, i: np.ndarray, j: np.ndarray) -> np.ndarray:
    """For each of n rows, the row of its stack's centre (-1: in none), from links (i[k],
    j[k]) both ways. The rows with the most links claim their free linked rows first; a row
    whose linked rows are all taken stays free for a later centre linked to it."""
    rows = np.concatenate([i, j]).astype(np.int64)
    cols = np.concatenate([j, i]).astype(np.int64)
    order = np.argsort(rows, kind="stable")
    rows, cols = rows[order], cols[order]
    counts = np.bincount(rows, minlength=n)
    ends = np.cumsum(counts)
    centres = np.full(n, -1, np.int64)
    for index in np.argsort(-counts, kind="stable"):
        if counts[index] == 0:
            break
        if centres[index] >= 0:
            continue
        linked = cols[ends[index] - counts[index] : ends[index]]
        free = linked[centres[linked] < 0]
        if len(free):
            centres[index] = index
            centres[free] = index
    return centres


# -- measures and the score ---------------------------------------------------------


class Thumbnails(Protocol):
    def get(self, path: str) -> bytes | None: ...


def picture_measures(data: bytes) -> dict[str, float]:
    """Sharpness and clipped share of a thumbnail."""
    with Image.open(io.BytesIO(data)) as image:
        grey = image.convert("L")
    if max(grey.size) != SHARP_EDGE:
        scale = SHARP_EDGE / max(grey.size)
        grey = grey.resize(
            (max(3, round(grey.width * scale)), max(3, round(grey.height * scale))),
            Image.Resampling.BILINEAR,
        )
    p = np.asarray(grey, np.float32)
    laplacian = p[1:-1, :-2] + p[1:-1, 2:] + p[:-2, 1:-1] + p[2:, 1:-1] - 4 * p[1:-1, 1:-1]
    clipped = float(((p <= CRUSHED_LEVEL) | (p >= BLOWN_LEVEL)).mean())
    return {
        "sharp": round(math.log2(max(float(laplacian.var()), 1.0)), 4),
        "clipped": round(clipped, 4),
    }


@dataclass(frozen=True)
class Face:
    box: Sequence[float]
    sharpness: float | None
    eye_left: float | None
    eye_right: float | None
    pitch: float | None
    happiness: float | None
    detect_rotation: int


def face_measures(faces: Iterable[Face], rotation: int) -> dict[str, Any]:
    counted = [f for f in faces if f.box[2] >= FACE_SIDE and f.box[3] >= FACE_SIDE]
    blinks = sum(
        1
        for f in counted
        if f.eye_left is not None
        and f.eye_right is not None
        and max(f.eye_left, f.eye_right) < CLOSED_EYES
        and (f.pitch is None or f.pitch >= LOOKING_DOWN)
    )
    cut = sum(
        1
        for f in counted
        if f.box[0] < EDGE_MARGIN
        or f.box[1] < EDGE_MARGIN
        or f.box[0] + f.box[2] > 1 - EDGE_MARGIN
        or f.box[1] + f.box[3] > 1 - EDGE_MARGIN
    )
    sharp = [math.log2(max(f.sharpness, 1.0)) for f in counted if f.sharpness is not None]
    smiles = [f.happiness for f in counted if f.happiness is not None]
    # Faces found on the picture turned, and not turned back by the owner's hand
    turned = sum(1 for f in counted if (f.detect_rotation - rotation) % 360 != 0)
    return {
        "faces": len(counted),
        "blinks": blinks,
        "cut": cut,
        "face_sharp": round(sum(sharp) / len(sharp), 4) if sharp else None,
        "smile": round(sum(smiles) / len(smiles), 4) if smiles else None,
        "sideways": int(turned * 2 > len(counted) > 0),
    }


def load_faces(conn: psycopg.Connection, photo_ids: Sequence[int]) -> dict[int, list[Face]]:
    out: dict[int, list[Face]] = {}
    for start in range(0, len(photo_ids), 20_000):
        rows = conn.execute(
            """
            SELECT photo_id, box, sharpness, eye_left_open, eye_right_open, pitch,
                   expression_scores[5], detect_rotation
            FROM faces WHERE photo_id = ANY(%s)
            """,
            (list(photo_ids[start : start + 20_000]),),
        ).fetchall()
        for photo_id, *values in rows:
            out.setdefault(photo_id, []).append(Face(*values))
    return out


def measures(
    photo: Photo, picture: Mapping[str, float] | None, faces: list[Face]
) -> dict[str, Any]:
    """What the score reads; picture None when the thumbnail could not be read."""
    return {
        "sharp": picture["sharp"] if picture else 0.0,
        "clipped": picture["clipped"] if picture else 0.0,
        "pixels": round(math.log2(max(photo.width * photo.height, 1)), 4),
        "bytes": round(math.log2(max(photo.size, 1)), 4),
        **face_measures(faces, photo.rotation),
    }


def rank(members: Sequence[tuple[int, Mapping[str, Any]]]) -> list[tuple[int, int, float]]:
    """(photo id, rank, score) of a stack's members, best first. Ties (exact copies score the
    same) go to the larger file, then to the photo the library has held longest (lowest id)."""
    filled = {}
    for name in MEDIAN_FILLED:
        known = sorted(m[name] for _, m in members if m.get(name) is not None)
        filled[name] = known[len(known) // 2] if known else 0.0

    def score(m: Mapping[str, Any]) -> float:
        return round(
            sum(
                weight * float(filled.get(name, 0.0) if m.get(name) is None else m[name])
                for name, weight in WEIGHTS.items()
            ),
            4,
        )

    scored = sorted(
        ((pid, score(m), m.get("bytes", 0.0)) for pid, m in members),
        key=lambda s: (-s[1], -s[2], s[0]),
    )
    return [(pid, place, value) for place, (pid, value, _) in enumerate(scored, start=1)]


class Measurer:
    """Reads thumbnails on `fetchers` threads, for the pixel tests and the measures."""

    def __init__(self, store: Thumbnails, fetchers: int) -> None:
        self.store = store
        self.fetchers = fetchers

    def _each(self, photos: Sequence[Photo], read: Callable[[bytes], Any]) -> dict[int, Any]:
        def one(photo: Photo) -> Any:
            if not photo.thumbnail:
                return None
            try:
                data = self.store.get(photo.thumbnail)
                return read(data) if data else None
            except Exception:  # unreadable: the photo goes without, as if it had none
                log.warning("thumbnail of photo %d unreadable", photo.id, exc_info=True)
                return None

        with ThreadPoolExecutor(self.fetchers) as pool:
            return dict(zip((p.id for p in photos), pool.map(one, photos), strict=True))

    def looks(self, photos: Sequence[Photo]) -> dict[int, np.ndarray | None]:
        return self._each(photos, look)

    def pictures(self, photos: Sequence[Photo]) -> dict[int, dict[str, float] | None]:
        return self._each(photos, picture_measures)


def pixel_shares(
    measurer: Measurer, photos: Sequence[Photo], i: np.ndarray, j: np.ndarray, code: np.ndarray
) -> np.ndarray:
    """The pixel share of the pairs left to test (IDENTICAL, ALIKE); nan elsewhere."""
    shares = np.full(len(i), np.nan)
    todo = np.flatnonzero((code == IDENTICAL) | (code == ALIKE))
    if len(todo) == 0:
        return shares
    needed = sorted({int(x) for k in todo for x in (i[k], j[k])})
    looks = measurer.looks([photos[x] for x in needed])
    for k in todo:
        a, b = looks[photos[int(i[k])].id], looks[photos[int(j[k])].id]
        if a is not None and b is not None:
            shares[k] = different_share(a, b)
    return shares


def measure(
    conn: psycopg.Connection,
    measurer: Measurer,
    photos: Mapping[int, Photo],
    photo_ids: Sequence[int],
) -> dict[int, dict[str, Any]]:
    """Measures of these photos: the picture's part as stored when they have a row (a
    photo's pixels do not change under its id), else from its thumbnail; the faces' part
    always from the faces rows (a later faces pass may have added some)."""
    stored: dict[int, dict[str, Any]] = {}
    for start in range(0, len(photo_ids), 20_000):
        stored.update(
            conn.execute(
                "SELECT photo_id, measures FROM photo_groups WHERE photo_id = ANY(%s)",
                (list(photo_ids[start : start + 20_000]),),
            ).fetchall()
        )
    fresh = measurer.pictures([photos[pid] for pid in photo_ids if pid not in stored])
    faces = load_faces(conn, photo_ids)
    return {
        pid: measures(
            photos[pid],
            {"sharp": stored[pid]["sharp"], "clipped": stored[pid]["clipped"]}
            if pid in stored
            else fresh.get(pid),
            faces.get(pid, []),
        )
        for pid in photo_ids
    }


# -- stacks and their rows ----------------------------------------------------------


@dataclass
class Stack:
    centre: int
    # photo id -> how it is linked to the centre ('centre' for the centre)
    members: dict[int, str] = field(default_factory=dict)


def copy_of(stack: Stack, photos: Mapping[int, Photo]) -> dict[int, int | None]:
    """Each member's photo_groups.copy_of: the lowest id of the members with its size in bytes
    and dimensions (near-duplicates that also match those are the same file), None alone."""
    sets: dict[tuple[int, int, int], list[int]] = {}
    for pid in stack.members:
        p = photos[pid]
        sets.setdefault((p.size, p.width, p.height), []).append(pid)
    out: dict[int, int | None] = {}
    for ids in sets.values():
        for pid in ids:
            out[pid] = min(ids) if len(ids) > 1 else None
    return out


def group_rows(
    stacks: Iterable[Stack],
    photos: Mapping[int, Photo],
    measured: Mapping[int, dict[str, Any]],
    model: str,
) -> list[tuple[Any, ...]]:
    """(photo_id, group_id, rank, score, link, copy_of, measures, model) of every member of
    the stacks of two or more."""
    rows = []
    for stack in stacks:
        if len(stack.members) < 2:
            continue
        copies = copy_of(stack, photos)
        for pid, place, score in rank([(pid, measured[pid]) for pid in stack.members]):
            rows.append(
                (
                    pid,
                    stack.centre,
                    place,
                    score,
                    stack.members[pid],
                    copies[pid],
                    measured[pid],
                    model,
                )
            )
    return rows


def stacks_of(
    photos: Sequence[Photo], i: np.ndarray, j: np.ndarray, code: np.ndarray
) -> list[Stack]:
    """The stacks of two or more made by the links (COPY, BURST, SAME) between rows."""
    linked = np.flatnonzero(np.isin(code, list(LINK)))
    li, lj = i[linked], j[linked]
    kind: dict[tuple[int, int], str] = {}
    for a, b, c in zip(li.tolist(), lj.tolist(), code[linked].tolist(), strict=True):
        kind[(a, b)] = kind[(b, a)] = LINK[c]
    stacks: dict[int, Stack] = {}
    for row, centre in enumerate(gather(len(photos), li, lj).tolist()):
        if centre >= 0:
            stack = stacks.setdefault(centre, Stack(photos[centre].id))
            stack.members[photos[row].id] = "centre" if row == centre else kind[(row, centre)]
    return [s for s in stacks.values() if len(s.members) > 1]


@dataclass
class Summary:
    photos: int = 0
    stacks: int = 0
    members: int = 0
    behind: dict[str, int] = field(default_factory=dict)
    largest: int = 0

    @classmethod
    def of(cls, photos: int, rows: Sequence[tuple[Any, ...]]) -> Summary:
        sizes: dict[int, int] = {}
        behind: dict[str, int] = {}
        for row in rows:
            sizes[row[1]] = sizes.get(row[1], 0) + 1
            if row[4] != "centre":
                behind[row[4]] = behind.get(row[4], 0) + 1
        return cls(photos, len(sizes), len(rows), behind, max(sizes.values(), default=0))

    def line(self) -> str:
        links = ", ".join(f"{k} {v}" for k, v in sorted(self.behind.items()))
        return (
            f"{self.photos} photos read: {self.stacks} stacks of {self.members} photos, "
            f"{self.members - self.stacks} behind another ({links or 'none'}), "
            f"largest {self.largest}"
        )


# -- rebuild ------------------------------------------------------------------------


def load_vectors(conn: psycopg.Connection, photo_ids: Sequence[int]) -> np.ndarray:
    """(photos, DIM) float32 embeddings in the order of photo_ids, normalized."""
    vectors = np.zeros((len(photo_ids), DIM), np.float32)
    position = {pid: k for k, pid in enumerate(photo_ids)}
    for start in range(0, len(photo_ids), 20_000):
        for pid, vector in load_embeddings(conn, photo_ids[start : start + 20_000]).items():
            vectors[position[pid]] = vector
        log.info("embeddings: %d / %d", min(start + 20_000, len(photo_ids)), len(photo_ids))
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-6)


def all_pairs(vectors: np.ndarray, c: Columns) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Pairs of rows (i < j) some rule could link, with their cosine, BLOCK rows at a time."""
    found: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for start in range(0, len(vectors), BLOCK):
        sims = vectors[start : start + BLOCK] @ vectors.T
        i, j = np.nonzero(sims >= FLOOR)
        keep = j > i + start
        i, j = i[keep], j[keep]
        s = sims[i, j]
        i = i + start
        # Under BURST_COSINE only a pair of one camera's same second can link
        same = (c.camera[i] >= 0) & (c.camera[i] == c.camera[j])
        with np.errstate(invalid="ignore"):
            second = np.abs(c.taken[i] - c.taken[j]) < 1
        keep = (s >= BURST_COSINE) | (same & second)
        found.append((i[keep].astype(np.int32), j[keep].astype(np.int32), s[keep]))
        if (start // BLOCK) % 50 == 0:
            log.info("pairs: %d / %d rows", min(start + BLOCK, len(vectors)), len(vectors))
    if not found:
        return np.zeros(0, np.int32), np.zeros(0, np.int32), np.zeros(0, np.float32)
    return tuple(np.concatenate(part) for part in zip(*found, strict=True))  # type: ignore[return-value]


# What a rebuild must not change: a count that drops aborts it
COUNTERS = ("photos", "photo_embeddings", "faces", "photo_colors", "photo_tags")


def counters(conn: psycopg.Connection) -> dict[str, int]:
    return {name: conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0] for name in COUNTERS}


class Aborted(Exception):
    """The rebuild found what it must not write; nothing was written."""


def rebuild(
    conn: psycopg.Connection,
    measurer: Measurer,
    vocabulary: Vocabulary,
    dry_run: bool,
    folder: str | None = None,
    owner: str = "rebuild",
    allow_shrink: bool = False,
) -> Summary:
    """Stacks the whole gallery, or one folder and what is below it, and writes its rows.

    The whole gallery replaces the table and closes every photo's groups job
    as done, so the next Grouper run only reads photos added since. A
    folder is a first trial: it is refused once the table holds stacks
    elsewhere, and leaves the jobs as they are. Nothing is written when
    dry_run, when a count of COUNTERS dropped during the transaction, or
    when the new rows are under half the old ones (allow_shrink to confirm).
    """
    model = rules_model()
    where, params = "true", {}
    if folder is not None:
        where = (
            "p.folder_id IN (SELECT fo.id FROM folders fo"
            " WHERE fo.path = %(folder)s OR starts_with(fo.path, %(folder)s || '/'))"
        )
        params = {"folder": folder}
    photos = load_photos(conn, vocabulary, where, **params)
    log.info("rebuild: %d photos%s, %s", len(photos), f" under {folder}" if folder else "", model)
    vectors = load_vectors(conn, [p.id for p in photos])
    columns = Columns.of(photos)
    i, j, s = all_pairs(vectors, columns)
    del vectors
    code = classify(columns, i, j, s)
    code = settle(code, pixel_shares(measurer, photos, i, j, code))
    stacks = stacks_of(photos, i, j, code)
    by_id = {p.id: p for p in photos}
    member_ids = [pid for stack in stacks for pid in stack.members]
    log.info("rebuild: %d stacks of %d photos, measuring", len(stacks), len(member_ids))
    rows = group_rows(stacks, by_id, measure(conn, measurer, by_id, member_ids), model)
    summary = Summary.of(len(photos), rows)
    log.info("rebuild: %s", summary.line())
    if dry_run:
        return summary
    scope = [p.id for p in photos]
    with conn.transaction():
        before = counters(conn)
        if folder is None:
            old = conn.execute("SELECT count(*) FROM photo_groups").fetchone()[0]
        else:
            elsewhere = conn.execute(
                "SELECT count(*) FROM photo_groups WHERE NOT (photo_id = ANY(%s))", (scope,)
            ).fetchone()[0]
            if elsewhere:
                raise Aborted(f"--folder is a first trial: {elsewhere} rows outside it")
            old = conn.execute("SELECT count(*) FROM photo_groups").fetchone()[0]
        if old and len(rows) * 2 < old and not allow_shrink:
            raise Aborted(f"{len(rows)} rows would replace {old}: --allow-shrink to confirm")
        replace_groups(conn, rows)
        if folder is None:
            close_jobs(conn, owner, scope, model)
        after = counters(conn)
        dropped = {k: (before[k], after[k]) for k in COUNTERS if after[k] < before[k]}
        if dropped:
            raise Aborted(f"counts dropped (before, after): {dropped}")
    log.info("rebuild: written, %d rows replace %d", len(rows), old)
    return summary


def close_jobs(conn: psycopg.Connection, owner: str, photo_ids: Sequence[int], model: str) -> None:
    """The groups job of every photo a rebuild read, done (a job another worker leases is
    left to it)."""
    for start in range(0, len(photo_ids), 20_000):
        conn.execute(
            """
            INSERT INTO analysis_jobs (photo_id, task, status, model, lease_owner, stats,
                                       started_at, finished_at)
            SELECT id, %(task)s, 'done', %(model)s, %(owner)s, '{"rebuild": true}', now(), now()
            FROM unnest(%(ids)s::bigint[]) AS id
            ON CONFLICT (photo_id, task) DO UPDATE SET
              status = 'done', model = EXCLUDED.model, lease_owner = EXCLUDED.lease_owner,
              lease_expires_at = NULL, not_before = NULL, last_error = NULL,
              stats = EXCLUDED.stats, finished_at = now(), updated_at = now()
            WHERE analysis_jobs.status <> 'leased'
            """,
            {
                "task": TASK,
                "model": model,
                "owner": owner,
                "ids": list(photo_ids[start : start + 20_000]),
            },
        )


# -- incremental --------------------------------------------------------------------


def neighbours(
    conn: psycopg.Connection, photo_ids: Sequence[int], limit: int = NEIGHBOURS
) -> list[tuple[int, int, float]]:
    """(photo, neighbour, cosine) of each photo's nearest neighbours at FLOOR or more."""
    found = []
    with conn.transaction():
        # A WHERE clause on an HNSW scan needs these to return `limit` rows (db/schema.sql)
        conn.execute(f"SET LOCAL hnsw.ef_search = {max(int(limit), 40)}")
        conn.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        for pid in photo_ids:
            rows = conn.execute(
                """
                SELECT e.photo_id, 1 - (e.embedding <=> q.embedding)
                FROM photo_embeddings q,
                     LATERAL (SELECT photo_id, embedding FROM photo_embeddings
                              WHERE model = %(model)s
                              ORDER BY embedding <=> q.embedding LIMIT %(limit)s) e
                WHERE q.photo_id = %(id)s AND q.model = %(model)s AND e.photo_id <> q.photo_id
                """,
                {"id": pid, "model": MODEL, "limit": limit},
            ).fetchall()
            found.extend((pid, other, float(s)) for other, s in rows if s >= FLOOR)
    return found


def cosines(
    conn: psycopg.Connection, pairs: Sequence[tuple[int, int]]
) -> dict[tuple[int, int], float]:
    if not pairs:
        return {}
    rows = conn.execute(
        """
        SELECT q.a, q.b, 1 - (a.embedding <=> b.embedding)
        FROM unnest(%s::bigint[], %s::bigint[]) AS q(a, b)
        JOIN photo_embeddings a ON a.photo_id = q.a AND a.model = %s
        JOIN photo_embeddings b ON b.photo_id = q.b AND b.model = %s
        """,
        ([a for a, _ in pairs], [b for _, b in pairs], MODEL, MODEL),
    ).fetchall()
    return {(a, b): float(s) for a, b, s in rows}


def place(
    new_ids: Sequence[int],
    links: Mapping[tuple[int, int], str],
    cosine: Mapping[tuple[int, int], float],
    stacked: Mapping[int, int],
    stacks: Callable[[int], Stack],
) -> tuple[dict[int, Stack], list[int]]:
    """Where the new photos go: (the stacks they change, by centre; those left alone).

    links: the linked pairs, both ways, among the new photos, their
    neighbours and the centres of their neighbours' stacks. stacked: the
    centre of each photo already in a stack. stacks(centre): that stack as
    stored. A new photo joins the stack whose centre it is linked to (the
    closest centre when several); the others form stacks among themselves
    and with the linked photos in no stack, around centres as rebuild()
    picks them.
    """
    changed: dict[int, Stack] = {}
    taken = dict(stacked)
    left = []
    for pid in new_ids:
        if pid in taken:  # already stacked: a job queued again
            continue
        centres = {taken[o] for (a, o) in links if a == pid and o in taken}
        joinable = [(cosine.get((pid, c), 0.0), c) for c in centres if (pid, c) in links]
        if joinable:
            _, centre = max(joinable)
            if centre not in changed:
                changed[centre] = stacks(centre)
            changed[centre].members[pid] = links[(pid, centre)]
            taken[pid] = centre
        else:
            left.append(pid)
    waiting = set(left)
    free = sorted(waiting | {o for (a, o) in links if a in waiting and o not in taken})
    row = {pid: k for k, pid in enumerate(free)}
    pairs = [(row[a], row[b]) for (a, b) in links if a in row and b in row and a < b]
    if pairs:
        centres = gather(
            len(free), np.array([a for a, _ in pairs]), np.array([b for _, b in pairs])
        )
        for k, centre in enumerate(centres.tolist()):
            if centre >= 0:
                c = free[centre]
                stack = changed.setdefault(c, Stack(c))
                stack.members[free[k]] = "centre" if k == centre else links[(free[k], c)]
    alone = [pid for pid in left if not any(pid in s.members for s in changed.values())]
    return changed, alone


@dataclass
class Counters:
    done: int = 0
    stacked: int = 0
    alone: int = 0
    skipped: int = 0
    lost: int = 0
    started: float = 0.0

    def line(self) -> str:
        elapsed = max(time.monotonic() - self.started, 1e-6)
        return (
            f"done={self.done} stacked={self.stacked} alone={self.alone} skipped={self.skipped} "
            f"lost={self.lost} rate={self.done / elapsed:.1f}/s"
        )


class Grouper:
    """Claims queued photos, stacks them with their neighbours, writes a batch at once.

    Holds one connection while it works and exits once the queue is empty;
    nothing waits on the database between runs.
    """

    def __init__(
        self,
        connect: Callable[[], psycopg.Connection],
        measurer: Measurer,
        vocabulary: Vocabulary,
        owner: str,
        batch: int,
        lease_seconds: int,
    ) -> None:
        self.connect = connect
        self.measurer = measurer
        self.vocabulary = vocabulary
        self.owner = owner
        self.batch = batch
        self.lease_seconds = lease_seconds
        self.model = rules_model()
        self.counters = Counters()
        self._stopping = threading.Event()

    def stop(self) -> None:
        log.info("stopping: the batch in hand is written, then exit")
        self._stopping.set()

    def _facts(self, conn: psycopg.Connection, ids: Iterable[int]) -> dict[int, Photo]:
        wanted = sorted(set(ids))
        return {
            p.id: p for p in load_photos(conn, self.vocabulary, "p.id = ANY(%(ids)s)", ids=wanted)
        }

    def _links(
        self, photos: Mapping[int, Photo], pairs: Sequence[tuple[int, int, float]]
    ) -> dict[tuple[int, int], str]:
        kept = [(a, b, s) for a, b, s in pairs if a in photos and b in photos]
        if not kept:
            return {}
        order = sorted({x for a, b, _ in kept for x in (a, b)})
        row = {pid: k for k, pid in enumerate(order)}
        listed = [photos[pid] for pid in order]
        i = np.array([row[a] for a, _, _ in kept])
        j = np.array([row[b] for _, b, _ in kept])
        columns = Columns.of(listed)
        code = classify(columns, i, j, np.array([s for _, _, s in kept], np.float32))
        code = settle(code, pixel_shares(self.measurer, listed, i, j, code))
        links = {}
        for (a, b, _), c in zip(kept, code.tolist(), strict=True):
            if c in LINK:
                links[(a, b)] = links[(b, a)] = LINK[c]
        return links

    def group(self, conn: psycopg.Connection, claimed: list[jobs.Job]) -> None:
        out = [j for j in claimed if j.excluded]
        if out:
            with conn.transaction():
                closed = jobs.complete_many(
                    conn, self.owner, [(j.id, {}) for j in out], None, "skipped", EXCLUDED_NOTE
                )
            self.counters.skipped += len(closed)
        wanted = [j for j in claimed if not j.excluded]
        if not wanted:
            return
        new_ids = [j.photo_id for j in wanted]
        near = neighbours(conn, new_ids)
        photos = self._facts(conn, [x for a, b, _ in near for x in (a, b)] + new_ids)
        stacked = dict(
            conn.execute(
                "SELECT photo_id, group_id FROM photo_groups WHERE photo_id = ANY(%s)",
                (list(photos),),
            ).fetchall()
        )
        # A member is linked to its centre: the cosine to the centres of the neighbours' stacks
        to_centres = sorted(
            {(a, stacked[b]) for a, b, _ in near if b in stacked and stacked[b] != a}
        )
        photos.update(self._facts(conn, {c for _, c in to_centres} - set(photos)))
        centre_cos = cosines(conn, to_centres)
        pairs = [*near, *((a, b, s) for (a, b), s in centre_cos.items())]
        cosine = {(a, b): s for a, b, s in pairs} | {(b, a): s for a, b, s in pairs}

        def stored(centre: int) -> Stack:
            rows = conn.execute(
                "SELECT photo_id, link FROM photo_groups WHERE group_id = %s", (centre,)
            ).fetchall()
            return Stack(centre, dict(rows))

        changed, alone = place(new_ids, self._links(photos, pairs), cosine, stacked, stored)
        # A member gone from the gallery since it was stacked has no facts: it leaves
        photos.update(
            self._facts(conn, {m for s in changed.values() for m in s.members} - set(photos))
        )
        for stack in changed.values():
            for pid in [pid for pid in stack.members if pid not in photos]:
                del stack.members[pid]
        member_ids = sorted({m for s in changed.values() for m in s.members})
        rows = group_rows(
            changed.values(), photos, measure(conn, self.measurer, photos, member_ids), self.model
        )
        in_stacks = {r[0] for r in rows}
        results = [(j.id, {"stacked": j.photo_id in in_stacks}) for j in wanted]
        try:
            save_groups(conn, self.owner, results, list(changed), rows, self.model)
        except LeaseLost:
            self.counters.lost += len(wanted)
            log.warning("a job of the batch was taken over: the batch is dropped")
            return
        self.counters.done += len(wanted)
        self.counters.stacked += sum(1 for pid in new_ids if pid in in_stacks)
        self.counters.alone += len(alone)

    def run(self) -> Counters:
        self.counters.started = time.monotonic()
        log.info("groups: batch %d, lease %d s, %s", self.batch, self.lease_seconds, self.model)
        with self.connect() as conn:
            if not conn.execute("SELECT pg_try_advisory_lock(%s)", (LOCK,)).fetchone()[0]:
                log.info("another groups worker holds the lock: exit")
                return self.counters
            requeued, failed = jobs.requeue_expired(conn)
            if requeued or failed:
                log.info("expired leases: %d requeued, %d failed", requeued, failed)
            while not self._stopping.is_set():
                claimed = jobs.claim(
                    conn,
                    self.owner,
                    [TASK],
                    self.batch,
                    self.lease_seconds,
                    embedded_sql("analysis_jobs.photo_id"),
                )
                if not claimed:
                    log.info("queue empty")
                    break
                self.group(conn, claimed)
                log.info("%s", self.counters.line())
        log.info("finished: %s", self.counters.line())
        return self.counters
