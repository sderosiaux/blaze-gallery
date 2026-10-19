"""The thumbs task: one download of the original gives the app's thumbnail and the photo's colors.

For HEIC/HEIF, which the app can't decode, the same download also gives the
viewer's 2048 px display rendition (display.py).

Loader (fetch threads): read the photo's thumbnail state, look for its
display rendition when it needs one, download and decode the original once
(thumbnail.load_source, which also cuts the rendition down from the
full-size picture). Analyzer (inference threads): render the 400 px
thumbnail upright with the owner's rotation, measure its colors, upload the
thumbnail unless the app already has it, and the rendition unless already
stored. Result (writer threads): in one transaction write photo_colors,
point photos.thumbnail_path at the upload and close the job.

Of photos, only thumbnail_path and thumbnail_status are ever written, and
only after an upload. A photo whose thumbnail is already generated at the
key the app expects keeps it (its colors are still measured); a rendition
already stored at its key is kept too.

The owner can turn a photo while it is being processed (the app then clears
thumbnail_path and deletes the object): when a thumbnail or a rendition was
uploaded, the write checks user_rotation again under a row lock, and when it
changed, nothing is written and the job goes back to the queue, so the next
attempt uploads the photo turned the new way. A turn after the job is done
queues nothing: see docs/DEPLOYMENT.md.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

from psycopg import Connection
from psycopg_pool import ConnectionPool

from . import colors as color_analysis
from . import display as rendition
from . import jobs
from .decode import Reader
from .store import LeaseLost
from .thumbnail import Source, encode, load_source, render, user_rotation
from .thumbstore import ThumbnailStore

log = logging.getLogger("blaze_worker")

TASK = "thumbs"
# analysis_jobs.model: what produced the thumbnail, the rendition and the colors
JOB_MODEL = (
    f"thumb-400-q80+display-{rendition.DISPLAY_SIDE}-q{rendition.DISPLAY_QUALITY}"
    f"-v{rendition.DISPLAY_VERSION}+{color_analysis.MODEL}"
)


class RotationChanged(Exception):
    """The owner turned the photo after it was rendered: render it again."""


@dataclass(frozen=True)
class PhotoState:
    thumbnail_status: str
    thumbnail_path: str | None
    rotation: int


def read_state(conn: Connection, photo_id: int) -> PhotoState:
    status, path, metadata = conn.execute(
        "SELECT thumbnail_status, thumbnail_path, metadata FROM photos WHERE id = %s",
        (photo_id,),
    ).fetchone()
    return PhotoState(status, path, user_rotation(metadata))


def has_thumbnail(state: PhotoState, path: str) -> bool:
    """Generated where the app looks: anything else (none, skipped_*, a stale path) is redone."""
    return state.thumbnail_status == "generated" and state.thumbnail_path == path


# -- loader ---------------------------------------------------------------------


@dataclass(frozen=True)
class Prepared:
    """A photo ready to render (pipeline.Loaded)."""

    original: Source
    state: PhotoState
    # Where the app looks for this photo's thumbnail
    path: str
    # False: the app already has it at that path, or thumbnails are off
    upload: bool
    # The display rendition: upload (original.display holds it), kept
    # (already stored at display_path), n/a (the app makes its own), off
    display: str = "off"
    display_path: str | None = None

    @property
    def source(self) -> str:
        return self.original.source

    @property
    def bytes_read(self) -> int:
        return self.original.bytes_read

    @property
    def fetch_seconds(self) -> float:
        return self.original.fetch_seconds

    @property
    def decode_seconds(self) -> float:
        return self.original.decode_seconds

    @property
    def size(self) -> tuple[int, int]:
        return self.original.width, self.original.height


class ThumbsLoader:
    """pipeline.Loader for this task. store None: colors only, no thumbnail."""

    def __init__(self, pool: ConnectionPool, store: ThumbnailStore | None) -> None:
        self.pool = pool
        self.store = store

    def __call__(self, reader: Reader, job: jobs.Job) -> Prepared:
        with self.pool.connection() as conn:
            state = read_state(conn, job.photo_id)
        path = self.store.path_for(job.s3_key, job.photo_id) if self.store else ""
        upload = self.store is not None and not has_thumbnail(state, path)
        display, display_path = "off", None
        if self.store is not None:
            display = "n/a"
            if rendition.applies(job.s3_key, job.mime_type):
                display_path = self.store.display_path_for(job.s3_key, job.photo_id, state.rotation)
                display = "kept" if self.store.exists(display_path) else "upload"
        original = load_source(
            reader,
            job.s3_key,
            job.mime_type,
            display=rendition.fit if display == "upload" else None,
        )
        return Prepared(original, state, path, upload, display, display_path)


# -- analyzer and result ----------------------------------------------------------


_UPSERT_COLORS = """
INSERT INTO photo_colors (
  photo_id, hues, palette_hex, palette_share, colorfulness, chroma, luminance,
  monochrome, center_sigma, model
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (photo_id) DO UPDATE SET
  hues = EXCLUDED.hues,
  palette_hex = EXCLUDED.palette_hex,
  palette_share = EXCLUDED.palette_share,
  colorfulness = EXCLUDED.colorfulness,
  chroma = EXCLUDED.chroma,
  luminance = EXCLUDED.luminance,
  monochrome = EXCLUDED.monochrome,
  center_sigma = EXCLUDED.center_sigma,
  model = EXCLUDED.model,
  created_at = now()
"""


def save_thumbs(
    conn: Connection,
    owner: str,
    job: jobs.Job,
    found: color_analysis.Colors,
    sigma: float,
    thumbnail_path: str | None,
    rotation: int,
    stats: dict[str, Any],
    rendition_uploaded: bool = False,
) -> None:
    """Colors, the thumbnail pointer and the job, in one transaction.

    thumbnail_path: set when a thumbnail was uploaded for this rotation.
    rendition_uploaded: a display rendition was uploaded for this rotation.
    Raises LeaseLost (the job is someone else's now) or RotationChanged.
    """
    with conn.transaction():
        if thumbnail_path is not None or rendition_uploaded:
            row = conn.execute(
                "SELECT metadata FROM photos WHERE id = %s FOR UPDATE", (job.photo_id,)
            ).fetchone()
            if row is None or user_rotation(row[0]) != rotation:
                raise RotationChanged(job.photo_id)
        if not jobs.complete(conn, owner, job.id, JOB_MODEL, stats):
            raise LeaseLost(job.id)
        conn.execute(
            _UPSERT_COLORS,
            (
                job.photo_id,
                list(found.hues),
                list(found.palette_hex),
                list(found.palette_share),
                found.colorfulness,
                found.chroma,
                found.luminance,
                found.monochrome,
                sigma,
                color_analysis.MODEL,
            ),
        )
        if thumbnail_path is not None:
            conn.execute(
                "UPDATE photos SET thumbnail_path = %s, thumbnail_status = 'generated' "
                "WHERE id = %s",
                (thumbnail_path, job.photo_id),
            )


@dataclass(frozen=True)
class ThumbsResult:
    found: color_analysis.Colors
    sigma: float
    # Set when a thumbnail was uploaded
    path: str | None
    thumbnail: str  # uploaded | kept | off
    thumb_bytes: int
    thumb_size: tuple[int, int]
    rotation: int
    render_seconds: float
    colors_seconds: float
    upload_seconds: float
    display: str = "off"  # uploaded | kept | n/a | off
    display_bytes: int = 0
    display_size: tuple[int, int] | None = None
    display_seconds: float = 0.0

    @property
    def infer_seconds(self) -> float:
        return (
            self.render_seconds + self.colors_seconds + self.display_seconds + self.upload_seconds
        )

    def stats(self) -> dict[str, Any]:
        return {
            "ms_thumb": round(self.render_seconds * 1000),
            "ms_colors": round(self.colors_seconds * 1000),
            "ms_display": round(self.display_seconds * 1000),
            "ms_upload": round(self.upload_seconds * 1000),
            "thumb": self.thumbnail,
            "thumb_bytes": self.thumb_bytes,
            "thumb_size": list(self.thumb_size),
            "display": self.display,
            **(
                {"display_bytes": self.display_bytes, "display_size": list(self.display_size)}
                if self.display_size
                else {}
            ),
            "user_rotation": self.rotation,
            "chroma_p95": self.found.chroma_p95,
        }

    def save(self, conn: Any, owner: str, job: jobs.Job, stats: dict[str, Any]) -> int:
        """Rows written: the colors, plus the photo's thumbnail pointer when uploaded."""
        try:
            save_thumbs(
                conn,
                owner,
                job,
                self.found,
                self.sigma,
                self.path,
                self.rotation,
                stats,
                rendition_uploaded=self.display == "uploaded",
            )
        except RotationChanged:
            status = jobs.fail(conn, owner, job.id, "user_rotation changed", permanent=False)
            log.info("job %s photo %s: turned meanwhile, %s", job.id, job.photo_id, status)
            return 0
        return 2 if self.path else 1


class ThumbsAnalyzer:
    def __init__(
        self, store: ThumbnailStore | None, sigma: float = color_analysis.CENTER_SIGMA
    ) -> None:
        self.store = store
        self.sigma = sigma

    def analyze(self, job: jobs.Job, picture: Prepared) -> ThumbsResult:
        rotation = picture.state.rotation
        began = time.perf_counter()
        image = render(picture.original, rotation)
        data = encode(image) if picture.upload else None
        rendered = time.perf_counter()
        found = color_analysis.analyze(image, sigma=self.sigma)
        measured = time.perf_counter()
        display = display_data = None
        if picture.display == "upload":
            assert picture.original.display is not None
            display = rendition.render(picture.original.display, rotation)
            display_data = rendition.encode(display)
        displayed = time.perf_counter()
        if data is not None:
            assert self.store is not None
            self.store.put(picture.path, data)
        if display_data is not None:
            assert self.store is not None and picture.display_path is not None
            self.store.put(picture.display_path, display_data)
        uploaded = time.perf_counter()
        return ThumbsResult(
            found=found,
            sigma=self.sigma,
            path=picture.path if data is not None else None,
            thumbnail="uploaded" if data is not None else ("kept" if self.store else "off"),
            thumb_bytes=len(data) if data is not None else 0,
            thumb_size=image.size,
            rotation=rotation,
            render_seconds=rendered - began,
            colors_seconds=measured - rendered,
            upload_seconds=uploaded - displayed,
            display="uploaded" if display_data is not None else picture.display,
            display_bytes=len(display_data) if display_data is not None else 0,
            display_size=display.size if display is not None else None,
            display_seconds=displayed - measured,
        )
