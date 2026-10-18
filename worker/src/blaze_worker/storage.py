"""Read-only access to the originals bucket.

Only GetObject is ever called: the worker reads photos, it never writes,
copies or deletes anything in a bucket.
"""

from __future__ import annotations

import boto3
import botocore.session
from botocore.config import Config

from .config import StorageSettings


class Originals:
    """Thread-safe: boto3 clients may be shared across threads."""

    def __init__(self, settings: StorageSettings, max_connections: int) -> None:
        self._bucket = settings.bucket
        # Credentials come from the settings only: an AWS_PROFILE exported for
        # other tools must not be looked up (it fails when ~/.aws lacks it).
        isolated = botocore.session.Session(session_vars={"profile": (None, None, None, None)})
        self._client = boto3.session.Session(botocore_session=isolated).client(
            "s3",
            endpoint_url=settings.endpoint,
            region_name=settings.region,
            aws_access_key_id=settings.access_key,
            aws_secret_access_key=settings.secret_key,
            config=Config(
                max_pool_connections=max_connections,
                retries={"max_attempts": 4, "mode": "adaptive"},
                connect_timeout=15,
                read_timeout=60,
                s3={"addressing_style": "path"},
            ),
        )

    def get(self, key: str) -> bytes:
        response = self._client.get_object(Bucket=self._bucket, Key=key)
        return response["Body"].read()

    def get_range(self, key: str, start: int, end: int) -> bytes:
        """Bytes start..end inclusive; shorter when the object ends first."""
        response = self._client.get_object(
            Bucket=self._bucket, Key=key, Range=f"bytes={start}-{end}"
        )
        return response["Body"].read()
