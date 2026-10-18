"""Settings read from the environment, optionally seeded from a .env file.

The worker reads the same variables as the app (DATABASE_URL, BACKBLAZE_*), so
one .env serves both. Values already in the environment win over the file.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

_B2_REGION = re.compile(r"^s3\.([a-z0-9-]+)\.backblazeb2\.com$")


@dataclass(frozen=True)
class StorageSettings:
    endpoint: str
    bucket: str
    access_key: str
    secret_key: str
    region: str


def parse_env_file(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def read_env(env_file: Path | None) -> dict[str, str]:
    env = dict(os.environ)
    if env_file is not None:
        for key, value in parse_env_file(env_file.read_text()).items():
            env.setdefault(key, value)
    return env


def region_for(endpoint: str) -> str:
    """B2 signs with the region in its hostname; anything else gets us-east-1."""
    host = re.sub(r"^https?://", "", endpoint).split("/")[0].split(":")[0]
    match = _B2_REGION.match(host)
    return match.group(1) if match else "us-east-1"


def _require(env: Mapping[str, str], *names: str) -> None:
    missing = [name for name in names if not env.get(name)]
    if missing:
        raise SystemExit(f"missing settings: {', '.join(missing)}")


def database_url(env: Mapping[str, str]) -> str:
    _require(env, "DATABASE_URL")
    return env["DATABASE_URL"]


def storage_settings(env: Mapping[str, str]) -> StorageSettings:
    _require(
        env,
        "BACKBLAZE_ENDPOINT",
        "BACKBLAZE_BUCKET",
        "BACKBLAZE_ACCESS_KEY",
        "BACKBLAZE_SECRET_KEY",
    )
    endpoint = env["BACKBLAZE_ENDPOINT"]
    return StorageSettings(
        endpoint=endpoint,
        bucket=env["BACKBLAZE_BUCKET"],
        access_key=env["BACKBLAZE_ACCESS_KEY"],
        secret_key=env["BACKBLAZE_SECRET_KEY"],
        region=env.get("BACKBLAZE_REGION") or region_for(endpoint),
    )
