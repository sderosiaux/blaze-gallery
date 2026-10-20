"""The tags task: what a photo shows (indoors, a cat, the beach, Christmas...), from its embedding.

No image is read. The stored SigLIP2 photo embedding (embed task) is
compared with the embeddings of short English descriptions of each tag,
made once per vocabulary by the same model's text tower. The vocabulary,
its French labels and search words, and each tag's threshold live in
db/tags.json, which the app reads too.

How a tag is scored (db/tags.json, "prompts"):

  logit(t)  = SCALE * cos(photo, match) + bias        match: its descriptions,
                                                      averaged then normalized
  plain     = sigmoid(logit(t)) * beats(t)
  beats(t)  = softmax(SCALE * cos(photo, d) for d in [match] + versus)[match]
              ("a dog" must also look more like a dog than like a cat);
              1 without versus
  softmax   = tags naming the same group share one softmax of their logits
              (indoors / outdoors / inside a vehicle)
  of        = score(of) * beats(t): a kitten is a cat that looks more like a
              kitten than like an adult cat
  any       = the largest of its own score and the listed tags' scores, each
              moved in logit so that its threshold lands on this tag's: a
              photo that has "chat" has "animal" too

SCALE is SigLIP's own logit scale. The ONNX export holds the two towers
only: SCALE and the model's bias (-16.77) come from the open_clip
checkpoint the export was made from. That bias puts the model's 50% where a
caption describes the photo closely; a short "a photo of a cat" stays below
it on obvious cats, so each tag sets its own bias. Every score is monotonic
in its cosines and lies in 0..1; a photo has a tag when score >= threshold.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import psycopg

from . import jobs
from .gallery import EXCLUDED_NOTE, out_of_gallery
from .siglip import MODEL
from .store import save_tags

log = logging.getLogger("blaze_worker")

TASK = "tags"

# exp(logit_scale) of timm/ViT-B-16-SigLIP2 (open_clip_model.safetensors)
SCALE = math.exp(4.7244534)
# Rows below this are not stored: no threshold comes near it
FLOOR = 0.05
GROUPS = ("scene", "animal", "lieu", "moment", "chose")


def vocabulary_path() -> Path:
    """db/tags.json of this checkout; BLAZE_TAGS elsewhere (the Docker image)."""
    found = os.environ.get("BLAZE_TAGS")
    return Path(found) if found else Path(__file__).resolve().parents[3] / "db" / "tags.json"


@dataclass(frozen=True)
class Tag:
    tag: str
    label: str
    group: str
    words: tuple[str, ...]
    threshold: float
    match: tuple[str, ...]
    bias: float = 0.0
    versus: tuple[tuple[str, ...], ...] = ()
    softmax: str | None = None
    of: str | None = None
    any: tuple[str, ...] = ()
    # Stored whatever its score (indoors and outdoors: every photo is one or the other)
    always: bool = False


@dataclass(frozen=True)
class Vocabulary:
    version: int
    tags: tuple[Tag, ...]

    @classmethod
    def read(cls, path: Path | None = None) -> Vocabulary:
        return cls.parse(json.loads((path or vocabulary_path()).read_text()))

    @classmethod
    def parse(cls, data: dict) -> Vocabulary:
        tags = []
        for entry in data["tags"]:
            prompts = entry["prompts"]
            tags.append(
                Tag(
                    tag=entry["tag"],
                    label=entry["label"],
                    group=entry["group"],
                    words=tuple(entry["words"]),
                    threshold=float(entry["threshold"]),
                    match=tuple(prompts["match"]),
                    bias=float(prompts.get("bias", 0.0)),
                    versus=tuple(tuple(_list(v)) for v in prompts.get("versus", ())),
                    softmax=prompts.get("softmax"),
                    of=prompts.get("of"),
                    any=tuple(prompts.get("any", ())),
                    always=bool(prompts.get("always", False)),
                )
            )
        vocabulary = cls(int(data["version"]), tuple(tags))
        vocabulary.check()
        return vocabulary

    def check(self) -> None:
        seen: set[str] = set()
        groups: dict[str, int] = {}
        for t in self.tags:
            if t.tag in seen:
                raise ValueError(f"tag {t.tag} twice")
            if t.group not in GROUPS:
                raise ValueError(f"tag {t.tag}: group {t.group}")
            if not t.match or not t.words or not 0 < t.threshold < 1:
                raise ValueError(f"tag {t.tag}: match, words and a threshold in 0..1")
            # A tag builds on tags listed before it: no cycle
            for other in (t.of, *t.any):
                if other is not None and other not in seen:
                    raise ValueError(f"tag {t.tag}: {other} must come before it")
            if t.softmax and (t.of or t.versus):
                raise ValueError(f"tag {t.tag}: softmax goes alone")
            if t.of and not t.versus:
                raise ValueError(f"tag {t.tag}: of needs versus")
            if t.softmax:
                groups[t.softmax] = groups.get(t.softmax, 0) + 1
            seen.add(t.tag)
        if any(n < 2 for n in groups.values()):
            raise ValueError("a softmax group needs two tags")

    @property
    def prompts(self) -> list[str]:
        texts = [p for t in self.tags for p in (*t.match, *(p for v in t.versus for p in v))]
        return list(dict.fromkeys(texts))

    @property
    def model(self) -> str:
        """analysis_jobs.model of a tags job: the image space, the vocabulary, how it scores.

        The hash covers what changes a stored row, not labels, words or
        thresholds (the app reads those from the file), except the thresholds
        `any` maps: a prompt or a bias edited without a new version still
        queues every photo again.
        """
        # `any` maps thresholds into scores: theirs count for those tags
        mapped = {name for t in self.tags if t.any for name in (t.tag, *t.any)}
        scoring = [
            (t.tag, t.match, t.bias, t.versus, t.softmax, t.of, t.any, t.always)
            + ((t.threshold,) if t.tag in mapped else ())
            for t in self.tags
        ]
        digest = hashlib.sha256(json.dumps([MODEL, SCALE, FLOOR, scoring]).encode()).hexdigest()
        return f"{MODEL} tags v{self.version} {digest[:8]}"

    def fingerprint(self) -> str:
        """Names the prompt embeddings: same model, same texts."""
        return hashlib.sha256(json.dumps([MODEL, self.prompts]).encode()).hexdigest()[:16]


def _list(value: str | Sequence[str]) -> list[str]:
    return [value] if isinstance(value, str) else list(value)


def prompt_vectors(
    vocabulary: Vocabulary, embed: Callable[[str], np.ndarray], cache: Path | None
) -> dict[str, np.ndarray]:
    """Each prompt's text embedding, read from `cache` when it holds this vocabulary's."""
    path = cache / f"{vocabulary.fingerprint()}.npz" if cache else None
    if path and path.exists():
        with np.load(path) as stored:
            # npz keys are the prompts' indices: texts may hold any character
            return {p: stored[str(i)] for i, p in enumerate(vocabulary.prompts)}
    vectors = {p: embed(p) for p in vocabulary.prompts}
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part.npz")
        np.savez(partial, **{str(i): vectors[p] for i, p in enumerate(vocabulary.prompts)})
        partial.replace(path)
    return vectors


def _concept(vectors: dict[str, np.ndarray], prompts: Iterable[str]) -> np.ndarray:
    mean = np.mean([vectors[p] for p in prompts], axis=0)
    return (mean / np.linalg.norm(mean)).astype(np.float32)


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _logit(p: np.ndarray | float) -> np.ndarray:
    p = np.clip(p, 1e-7, 1 - 1e-7)
    return np.log(p / (1 - p))


class Scorer:
    def __init__(self, vocabulary: Vocabulary, vectors: dict[str, np.ndarray]) -> None:
        self.vocabulary = vocabulary
        self.index = {t.tag: i for i, t in enumerate(vocabulary.tags)}
        self.thresholds = {t.tag: t.threshold for t in vocabulary.tags}
        concepts: list[np.ndarray] = []
        # Per tag: its match column, then its versus columns
        self.columns: list[tuple[int, list[int]]] = []
        for t in vocabulary.tags:
            columns = []
            for prompts in (t.match, *t.versus):
                concepts.append(_concept(vectors, prompts))
                columns.append(len(concepts) - 1)
            self.columns.append((columns[0], columns[1:]))
        self.matrix = np.stack(concepts, axis=1)

    def scores(self, embeddings: np.ndarray) -> np.ndarray:
        """(photos, 768) normalized embeddings -> (photos, tags) scores in 0..1."""
        logits = SCALE * (embeddings.astype(np.float32) @ self.matrix)
        tags = self.vocabulary.tags
        out = np.zeros((len(embeddings), len(tags)), np.float32)
        groups: dict[str, list[int]] = {}
        for i, t in enumerate(tags):
            if t.softmax:
                groups.setdefault(t.softmax, []).append(i)
        for members in groups.values():
            biased = np.stack([logits[:, self.columns[i][0]] + tags[i].bias for i in members], 1)
            biased = np.exp(biased - biased.max(axis=1, keepdims=True))
            out[:, members] = biased / biased.sum(axis=1, keepdims=True)
        # In vocabulary order: a tag's `of` and `any` are scored before it
        for i, t in enumerate(tags):
            if t.softmax:
                continue
            match, versus = self.columns[i]
            beats = np.ones(len(embeddings), np.float32)
            if versus:
                rivals = logits[:, versus] - logits[:, [match]]
                beats = 1.0 / (1.0 + np.exp(rivals).sum(axis=1))
            base = out[:, self.index[t.of]] if t.of else _sigmoid(logits[:, match] + t.bias)
            out[:, i] = base * beats
            for other in t.any:
                shift = _logit(t.threshold) - _logit(self.thresholds[other])
                mapped = _sigmoid(_logit(out[:, self.index[other]]) + shift)
                out[:, i] = np.maximum(out[:, i], mapped)
        return out

    def rows(self, photo_ids: Sequence[int], scores: np.ndarray) -> list[tuple[int, str, float]]:
        """(photo_id, tag, score) to store: at or above FLOOR, and the `always` tags."""
        keep = scores >= FLOOR
        for i, t in enumerate(self.vocabulary.tags):
            if t.always:
                keep[:, i] = True
        names = [t.tag for t in self.vocabulary.tags]
        return [
            (int(photo_ids[p]), names[k], round(float(scores[p, k]), 4))
            for p, k in zip(*np.nonzero(keep), strict=True)
        ]


# -- the task -------------------------------------------------------------------


def ready_sql() -> str:
    """Claim condition (jobs.claim): the photo has an embedding in the space of MODEL."""
    return f"""EXISTS (
  SELECT 1 FROM photo_embeddings e
  WHERE e.photo_id = analysis_jobs.photo_id AND e.model = '{MODEL}'
)"""


def load_embeddings(conn: psycopg.Connection, photo_ids: Sequence[int]) -> dict[int, np.ndarray]:
    # Binary halfvec: a third of the bytes of the text form, and no parsing
    with conn.cursor(binary=True) as cursor:
        rows = cursor.execute(
            "SELECT photo_id, embedding FROM photo_embeddings "
            "WHERE photo_id = ANY(%s) AND model = %s",
            (list(photo_ids), MODEL),
        ).fetchall()
    return {photo_id: vector.to_numpy() for photo_id, vector in rows}


def dry_run(
    conn: psycopg.Connection, scorer: Scorer, limit: int, batch: int = 1000
) -> tuple[int, dict[str, tuple[int, int]]]:
    """Scores up to `limit` photos the task would claim, writes nothing.

    Returns (photos scored, {tag: (rows it would store, photos at or above its threshold)}).
    """
    photo_ids = [
        row[0]
        for row in conn.execute(
            f"""
            SELECT analysis_jobs.photo_id FROM analysis_jobs JOIN photos p ON p.id = photo_id
            WHERE task = %s AND status = 'queued' AND {ready_sql()} AND NOT {out_of_gallery()}
            ORDER BY priority DESC, analysis_jobs.id LIMIT %s
            """,
            (TASK, limit),
        ).fetchall()
    ]
    tags = scorer.vocabulary.tags
    stored = dict.fromkeys((t.tag for t in tags), 0)
    above = dict.fromkeys((t.tag for t in tags), 0)
    scored = 0
    for start in range(0, len(photo_ids), batch):
        vectors = load_embeddings(conn, photo_ids[start : start + batch])
        if not vectors:
            continue
        ids = list(vectors)
        scores = scorer.scores(np.stack([vectors[p] for p in ids]))
        for _, tag, _ in scorer.rows(ids, scores):
            stored[tag] += 1
        for i, t in enumerate(tags):
            above[t.tag] += int((scores[:, i] >= t.threshold).sum())
        scored += len(ids)
    return scored, {t.tag: (stored[t.tag], above[t.tag]) for t in tags}


@dataclass
class Counters:
    done: int = 0
    rows: int = 0
    skipped: int = 0
    lost: int = 0
    retried: int = 0
    started: float = 0.0

    def line(self) -> str:
        elapsed = max(time.monotonic() - self.started, 1e-6)
        return (
            f"done={self.done} tags={self.rows} skipped={self.skipped} lost={self.lost} "
            f"retried={self.retried} rate={self.done / elapsed:.0f}/s"
        )


class Tagger:
    """Claims a batch, reads its embeddings, scores, writes the batch in one transaction.

    No image is read and the scoring takes milliseconds: a batch costs a few
    round trips to the database, whatever its size. The worker holds one
    connection while there is work and exits once the queue is empty (with
    `follow`, once that task has stopped making progress too).
    """

    def __init__(
        self,
        connect: Callable[[], psycopg.Connection],
        scorer: Scorer,
        owner: str,
        batch: int,
        lease_seconds: int,
        wait_seconds: float = 0,
        follow: str | None = None,
        follow_poll_seconds: float = 60.0,
        reap_every_seconds: float = 60.0,
    ) -> None:
        self.connect = connect
        self.scorer = scorer
        self.vocabulary = scorer.vocabulary
        self.owner = owner
        self.batch = batch
        self.lease_seconds = lease_seconds
        self.wait_seconds = wait_seconds
        self.follow = follow
        self.follow_poll_seconds = follow_poll_seconds
        self.reap_every_seconds = reap_every_seconds
        self.counters = Counters()
        self._stopping = threading.Event()

    def stop(self) -> None:
        log.info("stopping: the batch in hand is written, then exit")
        self._stopping.set()

    def tag(self, conn: psycopg.Connection, claimed: list[jobs.Job]) -> None:
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
        vectors = load_embeddings(conn, [j.photo_id for j in wanted])
        # Embedding gone since the claim (photo re-embedded or deleted): later
        for job in (j for j in wanted if j.photo_id not in vectors):
            jobs.fail(conn, self.owner, job.id, "no embedding", permanent=False)
            self.counters.retried += 1
        scored = [j for j in wanted if j.photo_id in vectors]
        if not scored:
            return
        photo_ids = [j.photo_id for j in scored]
        scores = self.scorer.scores(np.stack([vectors[p] for p in photo_ids]))
        closed, written = save_tags(
            conn,
            self.owner,
            scored,
            self.scorer.rows(photo_ids, scores),
            self.vocabulary.version,
            self.vocabulary.model,
        )
        self.counters.done += closed
        self.counters.rows += written
        self.counters.lost += len(scored) - closed

    def _step(self, conn: psycopg.Connection, last_reap: float) -> tuple[bool, float]:
        """One claim and its batch; (keep going, time of the last reap)."""
        if time.monotonic() - last_reap > self.reap_every_seconds:
            requeued, failed = jobs.requeue_expired(conn)
            if requeued or failed:
                log.info("expired leases: %d requeued, %d failed", requeued, failed)
            last_reap = time.monotonic()
        claimed = jobs.claim(conn, self.owner, [TASK], self.batch, self.lease_seconds, ready_sql())
        if claimed:
            self.tag(conn, claimed)
            log.info("%s", self.counters.line())
            return True, last_reap
        if self.follow and jobs.progressing(conn, self.follow):
            log.info("nothing ready, %s still running: waiting", self.follow)
            self._stopping.wait(self.follow_poll_seconds)
            return True, last_reap
        if self.wait_seconds > 0:
            self._stopping.wait(self.wait_seconds)
            return True, last_reap
        # Jobs leased by another worker come back if it died: wait for them
        held, expires_in = jobs.leased(conn, [TASK])
        if not held:
            log.info("queue empty")
            return False, last_reap
        log.info("queue empty, %d jobs still leased (other or crashed workers): waiting", held)
        self._stopping.wait(min(max(expires_in, 1.0), 30.0))
        return True, 0.0

    def run(self) -> Counters:
        self.counters.started = time.monotonic()
        log.info(
            "tags: vocabulary v%d, %d tags, batch %d, model %s",
            self.vocabulary.version,
            len(self.vocabulary.tags),
            self.batch,
            MODEL,
        )
        conn: psycopg.Connection | None = None
        last_reap, errors = 0.0, 0
        try:
            while not self._stopping.is_set():
                try:
                    if conn is None or conn.closed:
                        conn = self.connect()
                    going, last_reap = self._step(conn, last_reap)
                    errors = 0
                    if not going:
                        break
                except psycopg.OperationalError:
                    # The leases of a batch cut short expire and come back
                    errors += 1
                    if errors > 5:
                        raise
                    log.exception("database unreachable, retrying")
                    if conn is not None:
                        conn.close()
                    conn = None
                    self._stopping.wait(5.0 * errors)
        finally:
            if conn is not None:
                conn.close()
        log.info("finished: %s", self.counters.line())
        return self.counters
