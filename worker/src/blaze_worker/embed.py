"""The embed task: a SigLIP2 vector per photo, from the app's thumbnail, for search by content.

Loader (fetch threads): read the photo's thumbnail from the thumbnail bucket
(R2), never the original from B2: 400 px is more than the model's 224.
Analyzer (inference threads): the image tower. Result (writer threads): in
one transaction write photo_embeddings and close the job.

A photo is only claimed once its thumbnail is in the thumbnail bucket
(ready_sql, added to the claim): the others stay queued, untouched, until the
thumbs pass reaches them. Deferring them one by one instead would rewrite
most of the queue every few minutes while the thumbs pass is behind. A
thumbnail the app once wrote to its local disk (a path outside the prefix)
does not count: the thumbs pass redoes those.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from pgvector import HalfVector
from psycopg import Connection
from psycopg_pool import ConnectionPool

from . import jobs
from .decode import Reader, Unsupported
from .siglip import MODEL, ImageTower
from .store import LeaseLost
from .thumbstore import ThumbnailStore

TASK = "embed"


def ready_sql(prefix: str) -> str:
    """Claim condition (jobs.claim): the photo's thumbnail is under the bucket's prefix."""
    pattern = re.sub(r"([\\%_])", r"\\\1", prefix.strip("/")).replace("'", "''") + "/%"
    return f"""EXISTS (
  SELECT 1 FROM photos rp
  WHERE rp.id = analysis_jobs.photo_id
    AND rp.thumbnail_status = 'generated' AND rp.thumbnail_path LIKE '{pattern}'
)"""


class ThumbnailMissing(Exception):
    """The photo has no thumbnail (yet, or any more): retried later."""


@dataclass(frozen=True)
class Thumbnail:
    """The app's thumbnail of a photo (pipeline.Loaded)."""

    data: bytes
    path: str
    fetch_seconds: float
    source: str = "thumbnail"
    decode_seconds: float = 0.0

    @property
    def bytes_read(self) -> int:
        return len(self.data)

    @property
    def size(self) -> tuple[int, int]:
        # Not decoded here: the tower decodes it at its own size
        return 0, 0


class EmbedLoader:
    """pipeline.Loader for this task: the reader of originals is never used."""

    def __init__(self, pool: ConnectionPool, store: ThumbnailStore) -> None:
        self.pool = pool
        self.store = store

    def __call__(self, reader: Reader, job: jobs.Job) -> Thumbnail:
        if not job.mime_type.startswith("image/"):
            raise Unsupported(f"unsupported type {job.mime_type}")
        with self.pool.connection() as conn:
            row = conn.execute(
                "SELECT thumbnail_status, thumbnail_path FROM photos WHERE id = %s",
                (job.photo_id,),
            ).fetchone()
        if row is None or row[0] != "generated" or not row[1]:
            raise ThumbnailMissing(f"thumbnail {row[0] if row else 'gone'}")
        began = time.perf_counter()
        data = self.store.get(row[1])
        if data is None:
            raise ThumbnailMissing(f"no object at {row[1]}")
        return Thumbnail(data, row[1], time.perf_counter() - began)


_UPSERT = """
INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES (%s, %s, %s)
ON CONFLICT (photo_id) DO UPDATE SET
  embedding = EXCLUDED.embedding, model = EXCLUDED.model, created_at = now()
"""


def save_embedding(
    conn: Connection, owner: str, job: jobs.Job, vector: np.ndarray, stats: dict[str, Any]
) -> None:
    with conn.transaction():
        if not jobs.complete(conn, owner, job.id, MODEL, stats):
            raise LeaseLost(job.id)
        conn.execute(_UPSERT, (job.photo_id, HalfVector(vector), MODEL))


@dataclass(frozen=True)
class EmbedResult:
    vector: np.ndarray
    infer_seconds: float

    def stats(self) -> dict[str, Any]:
        return {}

    def save(self, conn: Any, owner: str, job: jobs.Job, stats: dict[str, Any]) -> int:
        save_embedding(conn, owner, job, self.vector, stats)
        return 1


class EmbedAnalyzer:
    def __init__(self, tower: ImageTower) -> None:
        self.tower = tower

    def analyze(self, job: jobs.Job, picture: Thumbnail) -> EmbedResult:
        began = time.perf_counter()
        vector = self.tower.embed(picture.data)
        return EmbedResult(vector, time.perf_counter() - began)
