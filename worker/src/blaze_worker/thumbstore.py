"""Where the app keeps its thumbnails: an R2/S3 bucket, or a directory.

Read from the app's settings (THUMBNAIL_STORAGE, THUMBNAIL_S3_*,
THUMBNAILS_PATH). Unlike the app, there is no fallback to the originals
bucket: when the THUMBNAIL_S3_* set is incomplete the app would write next to
the originals in B2, and the worker refuses to write there.

Writes are thumbnail objects only, under the thumbnail prefix: PutObject
with the app's Content-Type and Cache-Control.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import boto3
import botocore.session
from botocore.config import Config

from .thumbnail import (
    CACHE_CONTROL,
    CONTENT_TYPE,
    local_thumbnail_path,
    normalize_prefix,
    thumbnail_key,
)


@dataclass(frozen=True)
class ThumbnailSettings:
    mode: str  # s3 | local
    prefix: str
    endpoint: str | None = None
    bucket: str | None = None
    access_key: str | None = None
    secret_key: str | None = None
    directory: str | None = None


def thumbnail_settings(env: Mapping[str, str]) -> ThumbnailSettings:
    mode = (env.get("THUMBNAIL_STORAGE") or "local").strip().lower()
    prefix = normalize_prefix(env.get("THUMBNAIL_S3_PREFIX") or "thumbnails")
    if mode == "s3":
        names = (
            "THUMBNAIL_S3_ENDPOINT",
            "THUMBNAIL_S3_BUCKET",
            "THUMBNAIL_S3_ACCESS_KEY",
            "THUMBNAIL_S3_SECRET_KEY",
        )
        missing = [name for name in names if not env.get(name)]
        if missing:
            raise SystemExit(
                "thumbnails: THUMBNAIL_STORAGE=s3 needs its own bucket "
                f"(missing {', '.join(missing)}); the worker never writes to the originals bucket"
            )
        return ThumbnailSettings(
            mode="s3",
            prefix=prefix,
            endpoint=env["THUMBNAIL_S3_ENDPOINT"],
            bucket=env["THUMBNAIL_S3_BUCKET"],
            access_key=env["THUMBNAIL_S3_ACCESS_KEY"],
            secret_key=env["THUMBNAIL_S3_SECRET_KEY"],
        )
    directory = env.get("THUMBNAILS_PATH")
    if not directory:
        # The app defaults to <its working directory>/data/thumbnails, which
        # the worker cannot guess
        raise SystemExit("thumbnails: local storage needs THUMBNAILS_PATH, as the app sees it")
    return ThumbnailSettings(mode="local", prefix=prefix, directory=directory)


class ThumbnailStore:
    """Thread-safe (boto3 clients may be shared across threads)."""

    def __init__(self, settings: ThumbnailSettings, max_connections: int) -> None:
        self.settings = settings
        self._client = None
        if settings.mode == "s3":
            isolated = botocore.session.Session(session_vars={"profile": (None, None, None, None)})
            self._client = boto3.session.Session(botocore_session=isolated).client(
                "s3",
                endpoint_url=settings.endpoint,
                # The app signs for R2 with region "auto"
                region_name="auto",
                aws_access_key_id=settings.access_key,
                aws_secret_access_key=settings.secret_key,
                config=Config(
                    max_pool_connections=max_connections,
                    retries={"max_attempts": 4, "mode": "adaptive"},
                    connect_timeout=15,
                    read_timeout=60,
                ),
            )

    @property
    def location(self) -> str:
        s = self.settings
        return f"s3://{s.bucket}/{s.prefix}" if s.mode == "s3" else str(s.directory)

    def path_for(self, s3_key: str, photo_id: int) -> str:
        """What the app stores in photos.thumbnail_path for this photo."""
        if self.settings.mode == "s3":
            return thumbnail_key(self.settings.prefix, s3_key, photo_id)
        return local_thumbnail_path(str(self.settings.directory), photo_id)

    def put(self, path: str, data: bytes) -> None:
        if self._client is not None:
            if not path.startswith(self.settings.prefix + "/"):
                raise ValueError(f"refusing to write outside the thumbnail prefix: {path}")
            self._client.put_object(
                Bucket=self.settings.bucket,
                Key=path,
                Body=data,
                ContentType=CONTENT_TYPE,
                CacheControl=CACHE_CONTROL,
            )
            return
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(f".{target.name}.{os.getpid()}.part")
        partial.write_bytes(data)
        partial.replace(target)

    def get(self, path: str) -> bytes | None:
        if self._client is not None:
            try:
                response = self._client.get_object(Bucket=self.settings.bucket, Key=path)
            except self._client.exceptions.NoSuchKey:
                return None
            return response["Body"].read()
        target = Path(path)
        return target.read_bytes() if target.exists() else None

    def head(self, path: str) -> dict[str, str | int] | None:
        """Content type, cache control and size of a stored thumbnail (s3 only)."""
        if self._client is None:
            return None
        try:
            response = self._client.head_object(Bucket=self.settings.bucket, Key=path)
        except self._client.exceptions.ClientError:
            return None
        return {
            "ContentType": response.get("ContentType", ""),
            "CacheControl": response.get("CacheControl", ""),
            "ContentLength": response.get("ContentLength", 0),
        }
