"""The tags task: vocabulary, scores, and the batches it writes to Postgres."""

from __future__ import annotations

import math

import numpy as np
import pytest
from pgvector import HalfVector

from blaze_worker import jobs
from blaze_worker.enqueue import enqueue_all
from blaze_worker.gallery import EXCLUDED_NOTE
from blaze_worker.siglip import DIM, MODEL
from blaze_worker.store import save_tags
from blaze_worker.tags import (
    FLOOR,
    GROUPS,
    SCALE,
    TASK,
    Scorer,
    Tagger,
    Vocabulary,
    dry_run,
    prompt_vectors,
)

from .conftest import add_photos, connect


def axis(i: int) -> np.ndarray:
    v = np.zeros(DIM, np.float32)
    v[i] = 1.0
    return v


def photo(**weights: float) -> np.ndarray:
    """An embedding with these cosines to the prompts' axes (AXES), the rest elsewhere."""
    v = np.zeros(DIM, np.float32)
    for name, w in weights.items():
        v[AXES[name]] = w
    v[DIM - 1] = math.sqrt(max(0.0, 1.0 - float(np.sum(v * v))))
    return v


# One axis per prompt: a prompt's embedding is its axis
AXES = {
    "indoors": 0,
    "outdoors": 1,
    "a cat": 2,
    "a dog": 3,
    "a kitten": 4,
    "an adult cat": 5,
    "an animal": 6,
    "a beach": 7,
}

VOCABULARY = {
    "version": 1,
    "tags": [
        {
            "tag": "interieur",
            "label": "Intérieur",
            "group": "scene",
            "words": ["intérieur"],
            "threshold": 0.5,
            "prompts": {"match": ["indoors"], "softmax": "scene", "always": True},
        },
        {
            "tag": "exterieur",
            "label": "Extérieur",
            "group": "scene",
            "words": ["extérieur"],
            "threshold": 0.5,
            "prompts": {"match": ["outdoors"], "softmax": "scene", "always": True},
        },
        {
            "tag": "chat",
            "label": "Chat",
            "group": "animal",
            "words": ["chat"],
            "threshold": 0.5,
            "prompts": {"match": ["a cat"], "bias": -11.0, "versus": [["a dog"]]},
        },
        {
            "tag": "chaton",
            "label": "Chaton",
            "group": "animal",
            "words": ["chaton"],
            "threshold": 0.5,
            "prompts": {"match": ["a kitten"], "of": "chat", "versus": [["an adult cat"]]},
        },
        {
            "tag": "animal",
            "label": "Animal",
            "group": "animal",
            "words": ["animal"],
            "threshold": 0.5,
            "prompts": {"match": ["an animal"], "bias": -11.0, "any": ["chat"]},
        },
        {
            "tag": "plage",
            "label": "Plage",
            "group": "lieu",
            "words": ["plage"],
            "threshold": 0.5,
            "prompts": {"match": ["a beach"], "bias": -11.0},
        },
    ],
}


def vectors_of(vocabulary: Vocabulary) -> dict[str, np.ndarray]:
    return {p: axis(AXES[p]) for p in vocabulary.prompts}


def vocab(version: int = 1, **changes: dict) -> Vocabulary:
    """VOCABULARY with some tags' prompts changed."""
    tags = [
        {**t, "prompts": {**t["prompts"], **changes.get(t["tag"], {})}} for t in VOCABULARY["tags"]
    ]
    return Vocabulary.parse({**VOCABULARY, "version": version, "tags": tags})


def scorer(version: int = 1, **changes: dict) -> Scorer:
    vocabulary = vocab(version, **changes)
    return Scorer(vocabulary, vectors_of(vocabulary))


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


# -- the vocabulary -----------------------------------------------------------


def test_the_repository_vocabulary_is_valid_and_scores():
    vocabulary = Vocabulary.read()
    names = [t.tag for t in vocabulary.tags]
    assert {"interieur", "exterieur", "chat", "chaton", "animal", "ecran_document"} <= set(names)
    for t in vocabulary.tags:
        assert t.group in GROUPS and t.label and t.words and 0 < t.threshold < 1
    assert {t.tag for t in vocabulary.tags if t.always} == {"interieur", "exterieur"}
    rng = np.random.default_rng(0)
    vectors = {p: rng.normal(size=DIM).astype(np.float32) for p in vocabulary.prompts}
    vectors = {p: v / np.linalg.norm(v) for p, v in vectors.items()}
    embeddings = rng.normal(size=(50, DIM)).astype(np.float32)
    embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True)
    scores = Scorer(vocabulary, vectors).scores(embeddings)
    assert scores.shape == (50, len(names))
    assert np.all((scores >= 0) & (scores <= 1))
    scene = [i for i, t in enumerate(vocabulary.tags) if t.softmax == "scene"]
    assert np.allclose(scores[:, scene].sum(axis=1), 1, atol=1e-5)


@pytest.mark.parametrize(
    ("change", "error"),
    [
        ({"chaton": {"of": "plage"}}, "must come before"),
        ({"animal": {"any": ["plage"]}}, "must come before"),
        ({"exterieur": {"softmax": None}}, "two tags"),
        ({"chaton": {"versus": []}}, "of needs versus"),
        ({"plage": {"softmax": "scene", "versus": [["a dog"]]}}, "softmax goes alone"),
    ],
)
def test_a_vocabulary_that_cannot_be_scored_is_refused(change, error):
    with pytest.raises(ValueError, match=error):
        vocab(**change)


def test_prompt_embeddings_are_cached_per_vocabulary(tmp_path):
    vocabulary = Vocabulary.parse(VOCABULARY)
    asked: list[str] = []

    def embed(text: str) -> np.ndarray:
        asked.append(text)
        return axis(AXES[text])

    first = prompt_vectors(vocabulary, embed, tmp_path)
    assert sorted(asked) == sorted(vocabulary.prompts)

    def refuse(text: str) -> np.ndarray:
        raise AssertionError("the cache holds them")

    again = prompt_vectors(vocabulary, refuse, tmp_path)
    assert all(np.array_equal(first[p], again[p]) for p in vocabulary.prompts)
    # Another prompt: another file, embedded anew
    other = Vocabulary.parse({**VOCABULARY, "tags": VOCABULARY["tags"][:2]})
    assert other.fingerprint() != vocabulary.fingerprint()
    asked.clear()
    prompt_vectors(other, embed, tmp_path)
    assert sorted(asked) == ["indoors", "outdoors"]


# -- scores -------------------------------------------------------------------


def test_scores_follow_the_formula():
    s = scorer()
    names = [t.tag for t in s.vocabulary.tags]
    x = photo(indoors=0.12, outdoors=0.08, **{"a cat": 0.13, "a dog": 0.05, "a kitten": 0.12})
    got = dict(zip(names, s.scores(x[np.newaxis])[0], strict=True))

    indoor = math.exp(SCALE * 0.12) / (math.exp(SCALE * 0.12) + math.exp(SCALE * 0.08))
    assert got["interieur"] == pytest.approx(indoor, rel=1e-4)
    assert got["interieur"] + got["exterieur"] == pytest.approx(1, abs=1e-5)
    cat = sigmoid(SCALE * 0.13 - 11) * sigmoid(SCALE * (0.13 - 0.05))
    assert got["chat"] == pytest.approx(cat, rel=1e-4)
    # A kitten: a cat, more like a kitten than like an adult cat (cos 0 here)
    assert got["chaton"] == pytest.approx(cat * sigmoid(SCALE * 0.12), rel=1e-4)
    # "a photo of an animal" is weaker than the cat: the cat's score stands
    assert got["animal"] == pytest.approx(cat, rel=1e-4)
    assert got["plage"] == pytest.approx(sigmoid(-11), rel=1e-3)


def test_a_score_rises_with_its_cosine_and_a_rival_lowers_it():
    s = scorer()
    cat = [t.tag for t in s.vocabulary.tags].index("chat")
    rising = np.stack([photo(**{"a cat": c}) for c in np.linspace(0.0, 0.2, 21)])
    assert np.all(np.diff(s.scores(rising)[:, cat]) > 0)
    looks_like_a_dog = photo(**{"a cat": 0.12, "a dog": 0.14})
    assert s.scores(looks_like_a_dog[np.newaxis])[0, cat] < 0.2 * sigmoid(SCALE * 0.12 - 11)


def test_rows_keep_the_floor_and_both_scene_scores():
    s = scorer()
    x = np.stack([photo(indoors=0.13, **{"a cat": 0.14}), photo(outdoors=0.1)])
    rows = s.rows([10, 11], s.scores(x))
    tags = {(p, t) for p, t, _ in rows}
    assert {(10, "interieur"), (10, "exterieur"), (11, "interieur"), (11, "exterieur")} <= tags
    assert (10, "chat") in tags and (11, "chat") not in tags
    assert all(score >= FLOOR for _, t, score in rows if t not in ("interieur", "exterieur"))


# -- the task on Postgres -------------------------------------------------------


def embed_photos(conn, vectors: dict[int, np.ndarray], model: str = MODEL) -> None:
    for photo_id, v in vectors.items():
        conn.execute(
            "INSERT INTO photo_embeddings (photo_id, embedding, model) VALUES (%s, %s, %s)",
            (photo_id, HalfVector(v), model),
        )


def tags_of(conn) -> dict[int, dict[str, float]]:
    out: dict[int, dict[str, float]] = {}
    for photo_id, tag, score, version in conn.execute(
        "SELECT photo_id, tag, score, vocab_version FROM photo_tags"
    ).fetchall():
        out.setdefault(photo_id, {})[tag] = score
        assert version in (1, 2)
    return out


def job(conn, photo_id: int) -> tuple:
    return conn.execute(
        "SELECT status, model, stats, last_error FROM analysis_jobs "
        "WHERE task = 'tags' AND photo_id = %s",
        (photo_id,),
    ).fetchone()


def run(schema: str, s: Scorer, batch: int = 2) -> Tagger:
    tagger = Tagger(lambda: connect(schema), s, "test", batch, 600)
    tagger.run()
    return tagger


def test_tags_photos_with_an_embedding_and_leaves_the_others_queued(conn, schema):
    cat, beach, waiting, old_space, out = add_photos(conn, [("image/jpeg", None)] * 5)
    embed_photos(
        conn,
        {
            cat: photo(indoors=0.13, **{"a cat": 0.15}),
            beach: photo(outdoors=0.13, **{"a beach": 0.14}),
            out: photo(**{"a cat": 0.15}),
        },
    )
    embed_photos(conn, {old_space: photo(**{"a cat": 0.15})}, model="another-model@1")
    assert enqueue_all(conn, TASK, scorer().vocabulary.model) == 5
    # Its folder marked « pas une galerie photo » after it was queued
    conn.execute("UPDATE photos SET s3_key = 'books/' || id WHERE id = %s", (out,))
    conn.execute("INSERT INTO excluded_folders (path) VALUES ('books')")
    before = conn.execute("SELECT md5(array_agg(p ORDER BY id)::text) FROM photos p").fetchone()

    tagger = run(schema, scorer())

    assert (tagger.counters.done, tagger.counters.skipped) == (2, 1)
    found = tags_of(conn)
    assert set(found) == {cat, beach}
    assert found[cat]["chat"] > 0.9 and found[cat]["animal"] > 0.9
    assert found[cat]["interieur"] > 0.9 and "plage" not in found[cat]
    assert found[beach]["plage"] > 0.9 and found[beach]["exterieur"] > 0.9
    assert "chat" not in found[beach] and "interieur" in found[beach]
    status, model, stats, _ = job(conn, cat)
    assert (status, model, stats) == ("done", scorer().vocabulary.model, {"tags": len(found[cat])})
    # No embedding in this model's space yet: never claimed
    assert job(conn, waiting)[0] == "queued" and job(conn, old_space)[0] == "queued"
    assert job(conn, out)[0::3] == ("skipped", EXCLUDED_NOTE)
    after = conn.execute("SELECT md5(array_agg(p ORDER BY id)::text) FROM photos p").fetchone()
    assert before == after


def test_a_new_vocabulary_tags_every_photo_again_and_drops_what_fell_under_the_floor(conn, schema):
    cat, beach = add_photos(conn, [("image/jpeg", None)] * 2)
    embed_photos(
        conn,
        {cat: photo(**{"a cat": 0.15}), beach: photo(**{"a beach": 0.14})},
    )
    first = scorer()
    enqueue_all(conn, TASK, first.vocabulary.model)
    run(schema, first)
    assert "chat" in tags_of(conn)[cat]
    # Same vocabulary: nothing to do
    assert enqueue_all(conn, TASK, first.vocabulary.model) == 0

    # v2: cats need a much closer match
    second = scorer(version=2, chat={"bias": -30.0})
    assert enqueue_all(conn, TASK, second.vocabulary.model) == 2
    run(schema, second)

    found = tags_of(conn)
    assert "chat" not in found[cat] and "plage" in found[beach]
    versions = conn.execute("SELECT DISTINCT vocab_version FROM photo_tags").fetchall()
    assert versions == [(2,)]
    assert job(conn, cat)[1] == second.vocabulary.model


def test_a_batch_whose_lease_was_lost_keeps_the_previous_tags(conn):
    mine, theirs = add_photos(conn, [("image/jpeg", None)] * 2)
    conn.execute(
        "INSERT INTO photo_tags (photo_id, tag, score, vocab_version) VALUES (%s, 'chat', 0.9, 1)",
        (theirs,),
    )
    enqueue_all(conn, TASK)
    claimed = jobs.claim(conn, "test", [TASK], 2, 600)
    # Expired, then taken by another worker
    conn.execute("UPDATE analysis_jobs SET lease_owner = 'other' WHERE photo_id = %s", (theirs,))

    closed, written = save_tags(
        conn,
        "test",
        claimed,
        [(mine, "plage", 0.8), (theirs, "plage", 0.7)],
        2,
        "m",
    )

    assert (closed, written) == (1, 1)
    rows = conn.execute("SELECT photo_id, tag, score FROM photo_tags ORDER BY 1").fetchall()
    assert rows == [(mine, "plage", pytest.approx(0.8)), (theirs, "chat", pytest.approx(0.9))]
    assert job(conn, theirs)[0] == "leased"


def test_complete_many_closes_only_the_jobs_still_held(conn):
    ids = add_photos(conn, [("image/jpeg", None)] * 3)
    enqueue_all(conn, TASK)
    a, b, c = jobs.claim(conn, "test", [TASK], 3, 600)
    conn.execute("UPDATE analysis_jobs SET lease_owner = 'other' WHERE id = %s", (b.id,))

    held = jobs.complete_many(conn, "test", [(a.id, {"tags": 3}), (b.id, {}), (c.id, {})], "m")

    assert held == {a.id, c.id}
    assert job(conn, ids[0])[:3] == ("done", "m", {"tags": 3})
    assert job(conn, ids[1])[0] == "leased"


def test_what_changes_a_stored_score_changes_the_jobs_model():
    model = vocab().model
    assert model.startswith(f"{MODEL} tags v1 ")
    assert vocab(chat={"bias": -12.0}).model != model
    assert vocab(plage={"match": ["a sandy beach"]}).model != model
    assert vocab(version=2).model != model
    relabelled = Vocabulary.parse(
        {**VOCABULARY, "tags": [{**t, "threshold": 0.7, "label": "x"} for t in VOCABULARY["tags"]]}
    )
    assert relabelled.model == model


def test_a_dry_run_counts_what_would_be_written_and_writes_nothing(conn):
    cat, beach, out = add_photos(conn, [("image/jpeg", None)] * 3)
    embed_photos(
        conn,
        {
            cat: photo(indoors=0.13, **{"a cat": 0.15}),
            beach: photo(outdoors=0.13, **{"a beach": 0.14}),
            out: photo(**{"a cat": 0.15}),
        },
    )
    enqueue_all(conn, TASK)
    # Out of the gallery since it was queued
    conn.execute("UPDATE photos SET s3_key = 'books/' || id WHERE id = %s", (out,))
    conn.execute("INSERT INTO excluded_folders (path) VALUES ('books')")
    jobs_now = "SELECT md5(array_agg(j ORDER BY id)::text) FROM analysis_jobs j"
    before = conn.execute(jobs_now).fetchone()

    scored, counts = dry_run(conn, scorer(), 10)

    assert scored == 2
    assert counts["interieur"][0] == 2 and counts["interieur"][1] == 1
    assert counts["chat"] == (1, 1) and counts["plage"] == (1, 1)
    assert conn.execute("SELECT count(*) FROM photo_tags").fetchone()[0] == 0
    assert conn.execute(jobs_now).fetchone() == before
