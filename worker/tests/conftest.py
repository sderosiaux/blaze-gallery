"""A throwaway Postgres with pgvector and the real db/schema.sql.

BLAZE_TEST_DATABASE_URL points at an empty database to use (CI, or a
container started next to the test runner); without it, Testcontainers starts
pgvector/pgvector:pg17 and waits for it to accept connections.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest
from pgvector.psycopg import register_vector
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

SCHEMA = Path(
    os.environ.get("BLAZE_SCHEMA", Path(__file__).resolve().parents[2] / "db" / "schema.sql")
)


def _wait_ready(url: str, timeout: float = 60.0) -> None:
    import time

    deadline = time.monotonic() + timeout
    while True:
        try:
            with psycopg.connect(url, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            return
        except psycopg.OperationalError:
            if time.monotonic() > deadline:
                raise
            # Poll: the server is starting
            time.sleep(0.2)


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("BLAZE_TEST_DATABASE_URL")
    if url:
        _wait_ready(url)
        yield url
        return
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("pgvector/pgvector:pg17", driver=None) as container:
        url = container.get_connection_url()
        _wait_ready(url)
        yield url


@pytest.fixture(scope="session")
def schema(database_url: str) -> str:
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
        conn.execute(SCHEMA.read_text())
        # Applying it twice changes nothing (scripts/migrate.mjs runs it on every start)
        conn.execute(SCHEMA.read_text())
    return database_url


def connect(url: str) -> psycopg.Connection:
    conn = psycopg.connect(url, autocommit=True, prepare_threshold=None)
    register_vector(conn)
    return conn


@pytest.fixture
def conn(schema: str) -> Iterator[psycopg.Connection]:
    with connect(schema) as connection:
        connection.execute(
            "TRUNCATE faces, people, photo_descriptions, analysis_jobs, photos, folders, "
            "excluded_folders RESTART IDENTITY CASCADE"
        )
        yield connection


@pytest.fixture
def pool(schema: str) -> Iterator[ConnectionPool]:
    with ConnectionPool(
        schema,
        min_size=1,
        max_size=6,
        kwargs={"autocommit": True, "prepare_threshold": None},
        configure=register_vector,
    ) as connections:
        yield connections


def add_photos(conn: psycopg.Connection, specs: list[tuple[str, str | None]]) -> list[int]:
    """(mime_type, date_taken ISO or None) -> photo ids, in order."""
    folder = conn.execute(
        "INSERT INTO folders (path, name) VALUES ('/t', 't') "
        "ON CONFLICT (path) DO UPDATE SET name = 't' RETURNING id"
    ).fetchone()[0]
    ids = []
    for n, (mime, taken) in enumerate(specs):
        metadata = {"date_taken": taken} if taken else None
        row = conn.execute(
            """
            INSERT INTO photos (folder_id, filename, s3_key, size, mime_type, modified_at, metadata)
            VALUES (%s, %s, %s, 1000, %s, now(), %s)
            RETURNING id
            """,
            (folder, f"p{n}", f"t/{uuid.uuid4()}", mime, Jsonb(metadata) if metadata else None),
        ).fetchone()
        ids.append(row[0])
    return ids
