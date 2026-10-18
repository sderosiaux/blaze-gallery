"""People in the database: naming, seeding, labelling, and writing an expansion.

The rules of who a face is (see db/schema.sql, faces and face_candidates):
faces.person_id + faces.assignment are the truth; face_candidates is the
review queue and remembers every decision, so a face the owner rejected is
never proposed again for that person. The app's review routes follow the
same rules (src/lib/people.ts).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date

import numpy as np
from psycopg import Connection

from .people import (
    Expansion,
    Faces,
    Proposal,
    day_number,
    exif_date,
    folder_date,
    taken_on,
)

DECIDERS = ("owner", "auto", "agent")


class PeopleError(Exception):
    """A request that contradicts what the database holds (shown to the user)."""


@dataclass(frozen=True)
class Person:
    id: int
    name: str | None
    birth_date: date | None


def find_person(conn: Connection, ref: str) -> Person:
    """By id, or by exact name (case-insensitive) when unique."""
    if ref.isdigit():
        rows = conn.execute(
            "SELECT id, name, birth_date FROM people WHERE id = %s", (int(ref),)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name, birth_date FROM people WHERE lower(name) = lower(%s) ORDER BY id",
            (ref,),
        ).fetchall()
    if not rows:
        raise PeopleError(f"no person {ref!r}")
    if len(rows) > 1:
        ids = ", ".join(str(r[0]) for r in rows)
        raise PeopleError(f"several people named {ref!r} (ids {ids}): use an id")
    return Person(*rows[0])


def create_person(conn: Connection, name: str) -> Person:
    """A new named person; birth_date stays unknown until the owner gives it."""
    name = name.strip()
    if not name:
        raise PeopleError("a person needs a name")
    existing = conn.execute(
        "SELECT id FROM people WHERE lower(name) = lower(%s)", (name,)
    ).fetchone()
    if existing:
        raise PeopleError(f"{name!r} exists already (id {existing[0]})")
    row = conn.execute(
        "INSERT INTO people (name) VALUES (%s) RETURNING id, name, birth_date", (name,)
    ).fetchone()
    return Person(*row)


def largest_faces(conn: Connection, photo_ids: Sequence[int]) -> dict[int, int]:
    """photo id -> its largest face (the owner's "the child, the biggest face")."""
    rows = conn.execute(
        """
        SELECT DISTINCT ON (photo_id) photo_id, id FROM faces
        WHERE photo_id = ANY(%s)
        ORDER BY photo_id, width_px * height_px DESC, id
        """,
        (list(photo_ids),),
    ).fetchall()
    found = dict(rows)
    missing = [p for p in photo_ids if p not in found]
    if missing:
        raise PeopleError(f"no face found on photo(s) {', '.join(map(str, missing))}")
    return found


def _taken_elsewhere(conn: Connection, person_id: int, face_ids: Sequence[int]) -> list[str]:
    rows = conn.execute(
        """
        SELECT f.id, coalesce(p.name, '#' || p.id) FROM faces f JOIN people p ON p.id = f.person_id
        WHERE f.id = ANY(%s) AND f.person_id <> %s AND f.assignment IN ('seed', 'manual', 'auto')
        """,
        (list(face_ids), person_id),
    ).fetchall()
    return [f"face {face_id} is {name}" for face_id, name in rows]


def set_seeds(conn: Connection, person_id: int, face_ids: Sequence[int]) -> int:
    """The owner's example faces of a person: they define her, whatever their quality."""
    conflicts = _taken_elsewhere(conn, person_id, face_ids)
    if conflicts:
        raise PeopleError("; ".join(conflicts))
    with conn.transaction():
        found = conn.execute(
            "SELECT count(*) FROM faces WHERE id = ANY(%s)", (list(face_ids),)
        ).fetchone()[0]
        if found != len(set(face_ids)):
            raise PeopleError("unknown face id(s)")
        photos = conn.execute(
            """
            SELECT photo_id FROM faces WHERE id = ANY(%s)
            GROUP BY photo_id HAVING count(*) > 1
            """,
            (list(face_ids),),
        ).fetchall()
        if photos:
            raise PeopleError(
                f"two seed faces on photo {photos[0][0]}: a photo holds a person once"
            )
        cursor = conn.execute(
            "UPDATE faces SET person_id = %s, assignment = 'seed' WHERE id = ANY(%s)",
            (person_id, list(face_ids)),
        )
        conn.execute(
            """
            UPDATE face_candidates SET status = 'accepted', decided_by = 'owner',
              decided_at = now(), updated_at = now()
            WHERE person_id = %s AND face_id = ANY(%s) AND status <> 'accepted'
            """,
            (person_id, list(face_ids)),
        )
    return cursor.rowcount


def decide(
    conn: Connection,
    person_id: int,
    accept: Sequence[int],
    reject: Sequence[int],
    by: str,
) -> tuple[int, int]:
    """Yes/no on faces for a person, as the review screen records them.

    Accept: the face becomes the person's (manual), its candidate row accepted.
    Reject: the candidate row is rejected and, when the face belongs to nobody
    or was this person's, faces says rejected too. A face named as someone
    else cannot be accepted here: that is a change of name, done in the viewer.
    """
    if by not in DECIDERS or by == "auto":
        raise PeopleError(f"decided_by must be owner or agent, not {by!r}")
    overlap = set(accept) & set(reject)
    if overlap:
        raise PeopleError(f"face(s) both accepted and rejected: {sorted(overlap)}")
    conflicts = _taken_elsewhere(conn, person_id, accept)
    if conflicts:
        raise PeopleError("; ".join(conflicts))
    with conn.transaction():
        if accept:
            clash = conn.execute(
                """
                SELECT f.photo_id FROM faces f
                WHERE f.id = ANY(%(ids)s) AND EXISTS (
                  SELECT 1 FROM faces o WHERE o.photo_id = f.photo_id AND o.id <> f.id
                    AND o.person_id = %(person)s AND o.assignment IN ('seed', 'manual', 'auto'))
                """,
                {"ids": list(accept), "person": person_id},
            ).fetchall()
            if clash:
                raise PeopleError(
                    f"photo {clash[0][0]} already holds this person: a photo holds a person once"
                )
            conn.execute(
                "UPDATE faces SET person_id = %s, assignment = 'manual' WHERE id = ANY(%s)",
                (person_id, list(accept)),
            )
            # The photo holds her now: its other faces are not her
            conn.execute(
                """
                DELETE FROM face_candidates c USING faces f, faces a
                WHERE c.person_id = %(person)s AND c.status = 'pending' AND f.id = c.face_id
                  AND a.id = ANY(%(ids)s) AND a.photo_id = f.photo_id AND f.id <> a.id
                """,
                {"person": person_id, "ids": list(accept)},
            )
        if reject:
            conn.execute(
                """
                UPDATE faces SET person_id = %(person)s, assignment = 'rejected'
                WHERE id = ANY(%(ids)s) AND (person_id IS NULL OR person_id = %(person)s)
                """,
                {"person": person_id, "ids": list(reject)},
            )
        for ids, status in ((accept, "accepted"), (reject, "rejected")):
            if ids:
                conn.execute(
                    """
                    INSERT INTO face_candidates (person_id, face_id, status, decided_by, decided_at)
                    SELECT %(person)s, id, %(status)s, %(by)s, now()
                    FROM faces WHERE id = ANY(%(ids)s)
                    ON CONFLICT (person_id, face_id) DO UPDATE SET
                      status = EXCLUDED.status, decided_by = EXCLUDED.decided_by,
                      decided_at = now(), updated_at = now()
                    """,
                    {"person": person_id, "ids": list(ids), "status": status, "by": by},
                )
    return len(accept), len(reject)


def rejected_faces(conn: Connection, person_id: int) -> set[int]:
    rows = conn.execute(
        "SELECT face_id FROM face_candidates WHERE person_id = %s AND status = 'rejected'",
        (person_id,),
    ).fetchall()
    return {row[0] for row in rows}


def person_model(conn: Connection, person_id: int) -> str:
    """The embedding space of the person's faces (one model: vectors of two never compare)."""
    rows = conn.execute(
        """
        SELECT model, count(*) FROM faces
        WHERE person_id = %s AND assignment IN ('seed', 'manual', 'auto')
        GROUP BY model ORDER BY count(*) DESC
        """,
        (person_id,),
    ).fetchall()
    if not rows:
        raise PeopleError("this person has no face yet: give seeds first")
    if len(rows) > 1:
        raise PeopleError(f"faces of several models: {', '.join(r[0] for r in rows)}")
    return rows[0][0]


@dataclass(frozen=True)
class Loaded:
    faces: Faces
    taken: list[date | None]


def load_faces(conn: Connection, model: str) -> Loaded:
    """Every face of the model, with the date its photo was taken."""
    ids: list[int] = []
    photo_ids: list[int] = []
    taken: list[date | None] = []
    vectors: list[np.ndarray] = []
    eligible: list[bool] = []
    person_ids: list[int] = []
    assignments: list[str | None] = []
    with conn.cursor(binary=True) as cursor:
        cursor.execute(
            """
            SELECT f.id, f.photo_id, f.embedding, f.cluster_eligible, f.person_id, f.assignment,
                   p.metadata ->> 'date_taken', fo.path
            FROM faces f
            JOIN photos p ON p.id = f.photo_id
            JOIN folders fo ON fo.id = p.folder_id
            WHERE f.model = %s
            ORDER BY f.id
            """,
            (model,),
        )
        folders: dict[str, date | None] = {}
        for face_id, photo_id, vector, ok, person, assignment, exif, path in cursor:
            ids.append(face_id)
            photo_ids.append(photo_id)
            if path not in folders:
                folders[path] = folder_date(path)
            taken.append(taken_on(exif_date(exif), folders[path])[0])
            vectors.append(vector.to_numpy())
            eligible.append(bool(ok))
            person_ids.append(person or 0)
            assignments.append(assignment)
    dimensions = vectors[0].shape[0] if vectors else 512
    faces = Faces(
        ids=np.array(ids, dtype=np.int64),
        photo_ids=np.array(photo_ids, dtype=np.int64),
        days=np.array([day_number(t) for t in taken], dtype=np.int32),
        embeddings=(
            np.stack(vectors).astype(np.float16)
            if vectors
            else np.empty((0, dimensions), np.float16)
        ),
        eligible=np.array(eligible, dtype=bool),
        person_ids=np.array(person_ids, dtype=np.int64),
        assignments=np.array(assignments, dtype=object),
    )
    return Loaded(faces, taken)


def write_expansion(
    conn: Connection, person_id: int, faces: Faces, taken: list[date | None], result: Expansion
) -> tuple[int, int, int]:
    """Writes accepted and pending proposals; drops pending ones no longer proposed.

    Only touches what nobody decided: a face the owner named or rejected
    meanwhile keeps his decision, a decided candidate row is never rewritten.
    Returns (accepted, pending, dropped).
    """

    def rows(proposals: Iterable[Proposal]) -> list[tuple[int, float, int, int | None]]:
        out = []
        for p in proposals:
            here, there = taken[p.index], taken[p.source]
            gap = abs((here - there).days) if here and there else None
            out.append((int(faces.ids[p.index]), p.similarity, int(faces.ids[p.source]), gap))
        return out

    accepted = rows(result.accepted)
    pending = rows(result.pending)
    with conn.transaction():
        done: set[int] = set()
        if accepted:
            ids = [r[0] for r in accepted]
            updated = conn.execute(
                """
                UPDATE faces SET person_id = %(person)s, assignment = 'auto'
                WHERE id = ANY(%(ids)s)
                  AND (assignment IS NULL OR (assignment = 'rejected' AND person_id <> %(person)s))
                RETURNING id
                """,
                {"person": person_id, "ids": ids},
            ).fetchall()
            done = {r[0] for r in updated}
            with conn.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO face_candidates
                      (person_id, face_id, similarity, best_seed_face_id, gap_days,
                       status, decided_by, decided_at)
                    VALUES (%s, %s, %s, %s, %s, 'accepted', 'auto', now())
                    ON CONFLICT (person_id, face_id) DO UPDATE SET
                      similarity = EXCLUDED.similarity,
                      best_seed_face_id = EXCLUDED.best_seed_face_id,
                      gap_days = EXCLUDED.gap_days, status = 'accepted', decided_by = 'auto',
                      decided_at = now(), updated_at = now()
                    WHERE face_candidates.status = 'pending'
                    """,
                    [(person_id, *r) for r in accepted if r[0] in done],
                )
        if pending:
            with conn.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO face_candidates
                      (person_id, face_id, similarity, best_seed_face_id, gap_days)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (person_id, face_id) DO UPDATE SET
                      similarity = EXCLUDED.similarity,
                      best_seed_face_id = EXCLUDED.best_seed_face_id,
                      gap_days = EXCLUDED.gap_days, updated_at = now()
                    WHERE face_candidates.status = 'pending'
                    """,
                    [(person_id, *r) for r in pending],
                )
        dropped = conn.execute(
            """
            DELETE FROM face_candidates
            WHERE person_id = %s AND status = 'pending' AND NOT (face_id = ANY(%s))
            """,
            (person_id, [r[0] for r in pending]),
        ).rowcount
    return len(done), len(pending), dropped


@dataclass(frozen=True)
class Summary:
    by_assignment: Counter
    pending: int
    rejected: int
    # year -> (faces of the person, pending candidates); None = undated
    years: dict[int | None, tuple[int, int]]


def summarize(conn: Connection, person_id: int) -> Summary:
    rows = conn.execute(
        """
        SELECT 'face', f.assignment, p.metadata ->> 'date_taken', fo.path
        FROM faces f JOIN photos p ON p.id = f.photo_id JOIN folders fo ON fo.id = p.folder_id
        WHERE f.person_id = %(person)s AND f.assignment IN ('seed', 'manual', 'auto')
        UNION ALL
        SELECT 'candidate', c.status, p.metadata ->> 'date_taken', fo.path
        FROM face_candidates c JOIN faces f ON f.id = c.face_id
        JOIN photos p ON p.id = f.photo_id JOIN folders fo ON fo.id = p.folder_id
        WHERE c.person_id = %(person)s AND c.status IN ('pending', 'rejected')
        """,
        {"person": person_id},
    ).fetchall()
    assignments: Counter = Counter()
    years: dict[int | None, list[int]] = {}
    pending = rejected = 0
    for kind, state, exif, path in rows:
        when = taken_on(exif_date(exif), folder_date(path))[0]
        year = when.year if when else None
        if kind == "face":
            assignments[state] += 1
            years.setdefault(year, [0, 0])[0] += 1
        elif state == "pending":
            pending += 1
            years.setdefault(year, [0, 0])[1] += 1
        else:
            rejected += 1
    ordered = sorted(years.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))
    return Summary(assignments, pending, rejected, {y: (c[0], c[1]) for y, c in ordered})
