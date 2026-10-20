"""Entry points: blaze-worker, blaze-enqueue, blaze-queue, blaze-embedder, blaze-people,
blaze-*-preview."""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import socket
import sys
import warnings
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
from pgvector.psycopg import register_vector
from psycopg_pool import ConnectionPool

from .config import database_url, read_env, storage_settings

if TYPE_CHECKING:
    from .people_store import Person

log = logging.getLogger("blaze_worker")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(threadName)s %(message)s",
        stream=sys.stdout,
    )
    # scikit-image deprecation noise from insightface's alignment helper
    warnings.filterwarnings("ignore", category=FutureWarning)


def _env_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--env-file",
        type=Path,
        help="KEY=VALUE file (the app's .env); the environment wins over it",
    )


def _connect(url: str) -> psycopg.Connection:
    # prepare_threshold=None: works behind a transaction-mode pooler too
    return psycopg.connect(url, autocommit=True, prepare_threshold=None)


# -- blaze-worker -------------------------------------------------------------


# Per task: inference threads, download/decode threads, rendition long side
# (faces: detector input, detection score floor; None is Thresholds' default)
_DEFAULTS = {
    "faces": {"concurrency": 2, "fetchers": 8, "max_side": 1024, "det_size": 640},
    # A second, more sensitive look at photos already done, adding faces only
    # (store.add_faces). The detector sees the whole photo shrunk to det_size
    # px: at 1280 faces are twice as large as at faces' 640, for four times
    # the detection cost. Photo 117889: a half-hidden face scores 0.57 at 1280,
    # 0.41 at 640 (at 0.35 a 1280 pass also keeps a 0.41 false positive).
    # max_side only needs to be at least det_size; 2048 also halves what the
    # 25 px floor on the box side (measured on the rendition) stands for.
    "faces_extra": {
        "concurrency": 2,
        "fetchers": 8,
        "max_side": 2048,
        "det_size": 1280,
        "min_score": 0.5,
    },
    # One model in GPU memory, a few seconds per photo: two fetchers keep it fed
    "describe": {"concurrency": 1, "fetchers": 2, "max_side": 768},
    # Downloads dominate (tens of ms of CPU per photo): many fetchers, a few
    # render/upload threads; max_side is unused (the thumbnail is 400 px)
    "thumbs": {"concurrency": 4, "fetchers": 12, "max_side": 400},
    # Thumbnails are ~40 KB: a few fetchers feed two image towers
    "embed": {"concurrency": 2, "fetchers": 4, "max_side": 400},
    # No image read, no pipeline: batches of stored embeddings (tags.Tagger)
    "tags": {},
}


def _faces_analyzers(args: argparse.Namespace) -> list[Any]:
    from .faces import FaceModel, Thresholds, prepare_models, providers_for
    from .tasks import ExtraFacesAnalyzer, FacesAnalyzer

    cores = os.cpu_count() or 4
    threads = args.threads or max(1, cores // args.concurrency)
    providers = providers_for(args.provider)
    files = prepare_models(args.model_root)
    thresholds = Thresholds() if args.min_score is None else Thresholds(min_score=args.min_score)
    log.info(
        "%s: providers=%s workers=%d x %d threads, %d px, det=%d, min_score=%.2f, model=%s",
        args.task,
        providers,
        args.concurrency,
        threads,
        args.max_side,
        args.det_size,
        thresholds.min_score,
        files.pipeline_model,
    )

    def analyzer() -> Any:
        model = FaceModel(files, providers, threads, args.det_size, thresholds)
        if args.task == "faces_extra":
            return ExtraFacesAnalyzer(model, files, args.det_size, thresholds.min_score)
        return FacesAnalyzer(model, files, args.det_size)

    return [analyzer() for _ in range(args.concurrency)]


def _describe_analyzers(args: argparse.Namespace) -> list[Any]:
    from .describe import Describer, require_apple_silicon
    from .tasks import DescribeAnalyzer

    require_apple_silicon()
    if args.concurrency != 1:
        raise SystemExit("describe runs one model on the GPU: --concurrency 1")
    describer = Describer(args.model)
    log.info("describe: model=%s, %d px", describer.model_name, args.max_side)
    return [DescribeAnalyzer(describer)]


def _thumbs_task(
    args: argparse.Namespace, env: dict[str, str], pool: ConnectionPool
) -> tuple[list[Any], Any]:
    from .thumbs import ThumbsAnalyzer, ThumbsLoader
    from .thumbstore import ThumbnailStore, thumbnail_settings

    store = (
        None if args.colors_only else ThumbnailStore(thumbnail_settings(env), args.concurrency + 4)
    )
    log.info(
        "thumbs: render=%d fetch=%d thumbnails=%s display (HEIC)=%s",
        args.concurrency,
        args.fetchers,
        store.location if store else "off (colors only)",
        store.display_location if store else "off",
    )
    return [ThumbsAnalyzer(store) for _ in range(args.concurrency)], ThumbsLoader(pool, store)


def _embed_task(
    args: argparse.Namespace, env: dict[str, str], pool: ConnectionPool
) -> tuple[list[Any], Any]:
    from .embed import EmbedAnalyzer, EmbedLoader
    from .siglip import MODEL, ImageTower, download
    from .thumbstore import ThumbnailStore, thumbnail_settings

    cores = os.cpu_count() or 4
    threads = args.threads or max(1, cores // args.concurrency)
    download(args.model_root)
    store = ThumbnailStore(thumbnail_settings(env), args.fetchers + 2)
    log.info(
        "embed: model=%s workers=%d x %d threads, fetch=%d, thumbnails=%s",
        MODEL,
        args.concurrency,
        threads,
        args.fetchers,
        store.location,
    )
    analyzers = [
        EmbedAnalyzer(ImageTower(args.model_root, threads)) for _ in range(args.concurrency)
    ]
    return analyzers, EmbedLoader(pool, store)


def _run_tags(args: argparse.Namespace, url: str) -> None:
    from .siglip import TextTower, download
    from .tags import Scorer, Tagger, Vocabulary, prompt_vectors

    vocabulary = Vocabulary.read()
    root = Path(args.model_root).expanduser()
    towers: list[TextTower] = []

    def embed(text: str) -> Any:
        # Only for a vocabulary whose prompts are not in the cache yet
        if not towers:
            download(root)
            towers.append(TextTower(root, args.threads or 4))
        return towers[0].embed(text)

    scorer = Scorer(vocabulary, prompt_vectors(vocabulary, embed, root / "tags"))

    def connect() -> psycopg.Connection:
        conn = _connect(url)
        register_vector(conn)
        return conn

    if args.dry_run:
        from .tags import dry_run

        with connect() as conn:
            scored, counts = dry_run(conn, scorer, args.dry_run, args.batch)
        print(f"dry run, nothing written: {scored} photos, vocabulary v{vocabulary.version}")
        print("tag                   rows  >=threshold")
        for tag, (rows, above) in counts.items():
            print(f"{tag:18} {rows:8} {above:12}")
        print(f"{'total':18} {sum(r for r, _ in counts.values()):8}")
        return
    tagger = Tagger(connect, scorer, args.owner, args.batch, args.lease, args.wait, args.follow)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: tagger.stop())
    tagger.run()


def run_worker() -> None:
    from .describe import DEFAULT_MODEL
    from .tasks import SUPPORTED_TASKS

    parser = argparse.ArgumentParser(description="Analyze queued photos.")
    parser.add_argument("--task", choices=SUPPORTED_TASKS, default="faces")
    parser.add_argument(
        "--concurrency",
        type=int,
        help="inference workers (faces, faces_extra: 2; describe: 1, the only choice; thumbs: 4)",
    )
    parser.add_argument("--owner", default=socket.gethostname(), help="name on the leases")
    parser.add_argument(
        "--fetchers", type=int, help="download/decode threads (faces: 8, describe: 2, thumbs: 12)"
    )
    parser.add_argument("--writers", type=int, default=4, help="database write threads")
    parser.add_argument(
        "--max-side",
        type=int,
        help="rendition the model sees, px (faces: 1024, faces_extra: 2048, describe: 768)",
    )
    parser.add_argument("--lease", type=int, default=600, help="lease length (s)")
    parser.add_argument(
        "--wait",
        type=float,
        default=0,
        help="poll interval (s) when the queue is empty; 0 exits instead",
    )
    parser.add_argument(
        "--follow",
        metavar="TASK",
        help="with nothing to claim, wait while TASK still runs (embed: --follow thumbs)",
    )
    parser.add_argument(
        "--batch", type=int, default=1000, help="tags: photos per claim, written in one transaction"
    )
    parser.add_argument(
        "--dry-run",
        type=int,
        metavar="N",
        help="tags: score N photos with an embedding, print what would be stored, write nothing",
    )
    faces = parser.add_argument_group("faces, faces_extra")
    faces.add_argument(
        "--threads",
        type=int,
        default=0,
        help="ONNX threads per worker, faces and embed (0: cores / concurrency; tags: 4)",
    )
    faces.add_argument("--provider", choices=("auto", "cpu", "coreml"), default="auto")
    faces.add_argument(
        "--det-size", type=int, help="detector input, px (faces: 640, faces_extra: 1280)"
    )
    faces.add_argument(
        "--min-score",
        type=float,
        help="detections scoring less are not stored (faces: 0.7, faces_extra: 0.5)",
    )
    faces.add_argument("--model-root", default=os.environ.get("BLAZE_MODEL_ROOT", "~/.insightface"))
    describe = parser.add_argument_group("describe")
    describe.add_argument(
        "--model", default=DEFAULT_MODEL, help="MLX vision-language model (Hugging Face repo)"
    )
    thumbs = parser.add_argument_group("thumbs")
    thumbs.add_argument(
        "--colors-only",
        action="store_true",
        help="measure colors only: upload no thumbnail, write nothing in photos",
    )
    _env_arg(parser)
    args = parser.parse_args()
    for name, value in _DEFAULTS[args.task].items():
        if getattr(args, name) is None:
            setattr(args, name, value)
    _setup_logging()

    from .pipeline import Options, Worker
    from .storage import Originals

    env = read_env(args.env_file)
    url = database_url(env)
    if args.task == "tags":
        _run_tags(args, url)
        return
    # thumbs, embed: their loaders read each photo's thumbnail state on the fetch threads
    pool = ConnectionPool(
        url,
        min_size=1,
        max_size=args.writers + 3 + (args.fetchers if args.task in ("thumbs", "embed") else 0),
        kwargs={"autocommit": True, "prepare_threshold": None},
        configure=register_vector,
        open=True,
    )
    load = None
    ready_sql = None
    # Photos out of the gallery still get thumbnails (the Bibliothèque shows
    # them); no other task, nor --colors-only, has work on them
    analyze_excluded = args.task == "thumbs" and not args.colors_only
    if args.task == "thumbs":
        analyzers, load = _thumbs_task(args, env, pool)
    elif args.task == "embed":
        from .embed import ready_sql as embed_ready_sql
        from .thumbstore import thumbnail_settings

        analyzers, load = _embed_task(args, env, pool)
        ready_sql = embed_ready_sql(thumbnail_settings(env).prefix)
    else:
        analyzers = (_describe_analyzers if args.task == "describe" else _faces_analyzers)(args)
        if args.task == "faces_extra":
            from .tasks import EXTRA_FACES_READY_SQL

            ready_sql = EXTRA_FACES_READY_SQL
    log.info("owner=%s task=%s", args.owner, args.task)
    options = Options(
        owner=args.owner,
        task=args.task,
        concurrency=args.concurrency,
        fetchers=args.fetchers,
        writers=args.writers,
        lease_seconds=args.lease,
        max_side=args.max_side,
        wait_seconds=args.wait,
        ready_sql=ready_sql,
        follow=args.follow,
        analyze_excluded=analyze_excluded,
    )
    originals = Originals(storage_settings(env), args.fetchers + 2)
    worker = Worker(options, pool, originals, analyzers, load)
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: worker.stop())
    try:
        worker.run()
    finally:
        pool.close()


# -- blaze-enqueue ------------------------------------------------------------


def run_enqueue() -> None:
    from .enqueue import enqueue_again, enqueue_all, enqueue_ids, sample_ids

    parser = argparse.ArgumentParser(description="Queue photos for analysis (images only).")
    parser.add_argument("--task", default="faces")
    what = parser.add_mutually_exclusive_group(required=True)
    what.add_argument("--all", action="store_true", help="every image of the library")
    what.add_argument("--sample", type=int, metavar="N", help="a spread of formats and years")
    what.add_argument("--ids", help="comma-separated photo ids")
    parser.add_argument(
        "--pin", help="comma-separated photo ids to put first (with --sample/--ids)"
    )
    parser.add_argument(
        "--again",
        action="store_true",
        help="with --ids/--pin: queue them again even if done or failed (new model or prompt)",
    )
    parser.add_argument("--seed", default="blaze-sample-1", help="sample selection seed")
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()
    add = enqueue_again if args.again else enqueue_ids

    def ids(text: str | None) -> list[int]:
        return [int(v) for v in text.split(",") if v.strip()] if text else []

    model = None
    if args.task == "tags":
        from .tags import Vocabulary

        # A job done with an older vocabulary is queued again
        model = Vocabulary.read().model
    with _connect(database_url(read_env(args.env_file))) as conn:
        pinned = ids(args.pin)
        if pinned:
            log.info("pinned: %d queued", add(conn, args.task, pinned, pinned=True))
        if args.all:
            log.info("all images: %d queued", enqueue_all(conn, args.task, model))
        elif args.ids:
            log.info("ids: %d queued", add(conn, args.task, ids(args.ids), pinned=False))
        else:
            chosen = sample_ids(conn, args.sample - len(pinned), pinned, args.seed)
            log.info("sample: %d queued", enqueue_ids(conn, args.task, chosen, pinned=False))


# -- blaze-queue --------------------------------------------------------------


def run_status() -> None:
    parser = argparse.ArgumentParser(description="Queue state and per-machine throughput.")
    parser.add_argument("--task", default="faces")
    _env_arg(parser)
    args = parser.parse_args()
    with _connect(database_url(read_env(args.env_file))) as conn:
        rows = conn.execute(
            """
            SELECT status, coalesce(lease_owner, '-'), count(*),
                   round(extract(epoch FROM max(finished_at) - min(started_at))::numeric, 1),
                   round(avg((stats ->> 'ms_fetch')::int)),
                   round(avg((stats ->> 'ms_decode')::int)),
                   -- faces rows from before ms_infer existed: the sum of its stages
                   round(avg(coalesce((stats ->> 'ms_infer')::int,
                                      (stats ->> 'ms_detect')::int + (stats ->> 'ms_rotate')::int
                                      + (stats ->> 'ms_faces')::int))),
                   round(avg((stats ->> 'bytes')::bigint) / 1e6, 2),
                   round(avg(coalesce((stats ->> 'faces')::int,
                                      (stats ->> 'faces_added')::int)), 2)
            FROM analysis_jobs WHERE task = %s
            GROUP BY 1, 2 ORDER BY 1, 2
            """,
            (args.task,),
        ).fetchall()
    print(
        "status   owner            jobs  span_s  fetch_ms decode_ms infer_ms MB/photo faces/photo"
    )
    for status, owner, count, span, fetch, decode, infer, mb, faces in rows:
        per_photo = "-" if faces is None else faces
        print(
            f"{status:8} {owner:16} {count:5} {span or '-':>7} {fetch or '-':>8} "
            f"{decode or '-':>9} {infer or '-':>8} {mb or '-':>8} {per_photo:>11}"
        )


# -- blaze-embedder -----------------------------------------------------------


def run_embedder() -> None:
    """Embeds the app's search queries over HTTPS (worker/src/blaze_worker/embedder.py)."""
    import threading

    from .embedder import serve
    from .siglip import TextTower, download

    parser = argparse.ArgumentParser(description=run_embedder.__doc__)
    parser.add_argument("--port", type=int, default=47443)
    parser.add_argument("--cert", help="TLS certificate (PEM); without it, plain HTTP")
    parser.add_argument("--key", help="TLS private key (PEM)")
    parser.add_argument("--threads", type=int, default=4, help="ONNX threads of the text tower")
    parser.add_argument(
        "--model-root", default=os.environ.get("BLAZE_MODEL_ROOT", "~/.blaze-models")
    )
    args = parser.parse_args()
    _setup_logging()
    # From the environment (docker --env-file): the token is the only secret here
    token = os.environ.get("EMBEDDER_TOKEN", "").strip()
    if len(token) < 32:
        raise SystemExit("EMBEDDER_TOKEN must hold at least 32 characters")
    if bool(args.cert) != bool(args.key):
        raise SystemExit("--cert and --key go together")
    download(args.model_root)
    stopping = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stopping.set())
    serve(TextTower(args.model_root, args.threads), token, args.port, args.cert, args.key, stopping)
    log.info("stopped")


# -- blaze-faces-preview ------------------------------------------------------


def run_preview() -> None:
    """Draws the stored faces on the 1024 px rendition, for a visual check."""
    parser = argparse.ArgumentParser(description=run_preview.__doc__)
    parser.add_argument("photo_ids", help="comma-separated photo ids")
    parser.add_argument("--out", type=Path, required=True)
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()

    import cv2

    from .decode import load_picture
    from .storage import Originals

    env = read_env(args.env_file)
    originals = Originals(storage_settings(env), 4)
    args.out.mkdir(parents=True, exist_ok=True)
    with _connect(database_url(env)) as conn:
        for photo_id in (int(v) for v in args.photo_ids.split(",")):
            key, mime = conn.execute(
                "SELECT s3_key, mime_type FROM photos WHERE id = %s", (photo_id,)
            ).fetchone()
            faces = conn.execute(
                """
                SELECT box, landmarks, det_score, width_px, height_px, sharpness, yaw,
                       expression, cluster_eligible, detect_rotation, eye_left_open,
                       eye_right_open, mouth_open
                FROM faces WHERE photo_id = %s ORDER BY id
                """,
                (photo_id,),
            ).fetchall()
            image = load_picture(originals, key, mime, 1024).small.copy()
            height, width = image.shape[:2]
            for n, (
                box,
                points,
                score,
                w_px,
                h_px,
                sharp,
                yaw,
                expr,
                eligible,
                rot,
                el,
                er,
                mo,
            ) in enumerate(faces, 1):
                x, y, w, h = box
                color = (0, 200, 0) if eligible else (0, 165, 255)
                top_left = (round(x * width), round(y * height))
                bottom_right = (round((x + w) * width), round((y + h) * height))
                cv2.rectangle(image, top_left, bottom_right, color, 2)
                for i in range(0, 10, 2):
                    cv2.circle(
                        image,
                        (round(points[i] * width), round(points[i + 1] * height)),
                        2,
                        (0, 0, 255),
                        -1,
                    )
                label = f"#{n} {score:.2f} {min(w_px, h_px)}px s{sharp:.0f} y{yaw:.0f} {expr}"
                if rot:
                    label += f" r{rot}"
                cv2.putText(
                    image,
                    label,
                    (top_left[0], max(12, top_left[1] - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    color,
                    1,
                    cv2.LINE_AA,
                )
                log.info(
                    "photo %s face %d: score=%.2f size=%dx%d px sharp=%.0f yaw=%.0f expr=%s "
                    "eyes=%.2f/%.2f mouth=%.2f eligible=%s rotation=%d",
                    photo_id,
                    n,
                    score,
                    w_px,
                    h_px,
                    sharp,
                    yaw,
                    expr,
                    el,
                    er,
                    mo,
                    eligible,
                    rot,
                )
            path = args.out / f"faces-{photo_id}.jpg"
            cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 88])
            log.info("photo %s: %d faces -> %s", photo_id, len(faces), path)


# -- blaze-describe-preview ---------------------------------------------------


def run_describe_preview() -> None:
    """Describes photos, writing nothing to the database: renditions and a JSON line each."""
    from .describe import DEFAULT_MODEL, MAX_SIDE, require_apple_silicon

    parser = argparse.ArgumentParser(description=run_describe_preview.__doc__)
    parser.add_argument("photo_ids", help="comma-separated photo ids")
    parser.add_argument("--out", type=Path, required=True, help="renditions and results.jsonl")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--unconstrained",
        action="store_true",
        help="no JSON grammar: measures how often the model alone writes valid JSON",
    )
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()
    require_apple_silicon()

    import mlx.core as mx

    from .decode import load_picture
    from .describe import Describer, rendition, user_rotation
    from .description import InvalidReply
    from .storage import Originals

    env = read_env(args.env_file)
    originals = Originals(storage_settings(env), 4)
    args.out.mkdir(parents=True, exist_ok=True)
    describer = Describer(args.model, constrained=not args.unconstrained)
    log.info("model %s, constrained=%s", describer.model_name, describer.constrained)
    results = args.out / "results.jsonl"
    with _connect(database_url(env)) as conn, results.open("a") as lines:
        for photo_id in (int(v) for v in args.photo_ids.split(",")):
            key, mime, metadata = conn.execute(
                "SELECT s3_key, mime_type, metadata FROM photos WHERE id = %s", (photo_id,)
            ).fetchone()
            image = rendition(load_picture(originals, key, mime, MAX_SIDE), user_rotation(metadata))
            image.save(args.out / f"describe-{photo_id}.jpg", quality=88)
            row: dict[str, Any] = {
                "photo_id": photo_id,
                "model": describer.model_name,
                "constrained": describer.constrained,
            }
            try:
                found = describer.describe(image)
                row |= {
                    "ok": True,
                    "seconds": round(found.seconds, 3),
                    "tries": found.tries,
                    "first_errors": list(found.first_errors),
                    "tokens_in": found.prompt_tokens,
                    "tokens_out": found.generated_tokens,
                    "data": found.data,
                }
                log.info("photo %s (%.1fs): %s", photo_id, found.seconds, found.data["caption"])
            except InvalidReply as error:
                row |= {"ok": False, "errors": error.errors, "reply": error.reply}
                log.warning("photo %s: invalid after retry: %s", photo_id, error)
            row["peak_gb"] = round(mx.get_peak_memory() / 1e9, 2)
            lines.write(json.dumps(row, ensure_ascii=False) + "\n")
            lines.flush()


# -- blaze-colors-preview -----------------------------------------------------


def run_colors_preview() -> None:
    """Draws photos' colors next to their thumbnail: stored row if any, else measured now."""
    parser = argparse.ArgumentParser(description=run_colors_preview.__doc__)
    parser.add_argument("photo_ids", help="comma-separated photo ids")
    parser.add_argument("--out", type=Path, required=True)
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()

    from .colors import CENTER_SIGMA, Colors, analyze
    from .colors_sheet import draw
    from .storage import Originals
    from .thumbnail import load_source, render, user_rotation

    env = read_env(args.env_file)
    originals = Originals(storage_settings(env), 4)
    args.out.mkdir(parents=True, exist_ok=True)
    with _connect(database_url(env)) as conn:
        for photo_id in (int(v) for v in args.photo_ids.split(",")):
            key, mime, metadata = conn.execute(
                "SELECT s3_key, mime_type, metadata FROM photos WHERE id = %s", (photo_id,)
            ).fetchone()
            image = render(load_source(originals, key, mime), user_rotation(metadata))
            found = analyze(image, sigma=CENTER_SIGMA)
            row = conn.execute(
                """
                SELECT hues, palette_hex, palette_share, colorfulness, chroma, luminance,
                       monochrome, model
                FROM photo_colors WHERE photo_id = %s
                """,
                (photo_id,),
            ).fetchone()
            origin = "measured now"
            if row:
                hues, hexes, shares, colorfulness, chroma, luminance, mono, model = row
                origin = f"photo_colors ({model})"
                found = Colors(
                    tuple(hues), tuple(hexes), tuple(shares), colorfulness, chroma, luminance,
                    mono, found.chroma_p95,
                )  # fmt: skip
            path = args.out / f"colors-{photo_id}.jpg"
            draw(image, found, f"photo {photo_id} - {origin}").save(path, quality=90)
            log.info(
                "photo %s (%s): %s | palette %s | colorfulness %.1f L* %.1f mono=%s -> %s",
                photo_id,
                origin,
                " ".join(f"{n} {v:.2f}" for n, v in found.named().items() if v >= 0.03),
                " ".join(
                    f"{h} {s:.2f}"
                    for h, s in zip(found.palette_hex, found.palette_share, strict=True)
                ),
                found.colorfulness,
                found.luminance,
                found.monochrome,
                path,
            )


# -- blaze-people -------------------------------------------------------------


def _ids(text: str | None) -> list[int]:
    return [int(v) for v in text.split(",") if v.strip()] if text else []


def _print_summary(conn: psycopg.Connection, person_id: int) -> None:
    from .people_store import summarize

    summary = summarize(conn, person_id)
    owned = ", ".join(f"{k} {v}" for k, v in sorted(summary.by_assignment.items()))
    print(f"faces: {owned or 'none'} | pending {summary.pending} | rejected {summary.rejected}")
    print("   year  faces  pending")
    for year, (faces, pending) in summary.years.items():
        print(f"{year or 'undated':>7} {faces:6} {pending:8}")


def _print_coverage(conn: psycopg.Connection) -> None:
    """How much of each year the faces pass has looked at: an expansion sees only that."""
    from .enqueue import PINNED_PRIORITY

    rows = conn.execute(
        """
        SELECT priority, count(*) FILTER (WHERE status IN ('done', 'skipped', 'failed')), count(*)
        FROM analysis_jobs WHERE task = 'faces' AND priority < %s
        GROUP BY priority ORDER BY priority DESC
        """,
        (PINNED_PRIORITY,),
    ).fetchall()

    def share(done: int, total: int) -> str:
        return "<1%" if 0 < done < total / 100 else f"{100 * done / total:.0f}%"

    cells = [f"{year or '?'}:{share(done, total)}" for year, done, total in rows if total]
    print("faces pass, share of each year's photos looked at:", " ".join(cells))


def _expand(conn: psycopg.Connection, person: Person, args: argparse.Namespace) -> None:
    import time
    from collections import Counter

    from .people import Thresholds, expand
    from .people_store import load_faces, person_model, rejected_faces, write_expansion

    thresholds = Thresholds(auto=args.auto, review=args.review)
    began = time.perf_counter()
    loaded = load_faces(conn, person_model(conn, person.id))
    faces, taken = loaded.faces, loaded.taken
    loaded_at = time.perf_counter()
    result = expand(
        faces, person.id, rejected_faces(conn, person.id), thresholds, born=person.birth_date
    )
    print(
        f"{len(faces)} faces loaded in {loaded_at - began:.0f} s, "
        f"{result.rounds} rounds in {time.perf_counter() - loaded_at:.1f} s: "
        f"{len(result.accepted)} auto-accepted, {len(result.pending)} to review "
        f"(auto >= {thresholds.auto}, review >= {thresholds.review}); not proposed: "
        f"{result.refused_other} closer to someone else, "
        f"{result.refused_rejected} closer to a rejected face; "
        f"{result.ambiguous} sent to review as another face of the photo is as close"
    )
    years: Counter = Counter()
    for p in result.accepted + result.pending:
        years[(taken[p.index].year if taken[p.index] else 0, p.auto)] += 1
    for year in sorted({y for y, _ in years}):
        print(
            f"  {year or 'undated'}: {years[(year, True)]} auto, {years[(year, False)]} to review"
        )
    if args.dump:
        args.dump.write_text(
            json.dumps(
                [
                    {
                        "face_id": int(faces.ids[p.index]),
                        "photo_id": int(faces.photo_ids[p.index]),
                        "taken": taken[p.index].isoformat() if taken[p.index] else None,
                        "similarity": round(p.similarity, 4),
                        "best_seed_face_id": int(faces.ids[p.source]),
                        "eligible": bool(faces.eligible[p.index]),
                        "auto": p.auto,
                        "round": p.round,
                    }
                    for p in result.accepted + result.pending
                ]
                + [
                    {
                        "face_id": int(faces.ids[i]),
                        "photo_id": int(faces.photo_ids[i]),
                        "taken": taken[i].isoformat() if taken[i] else None,
                        "similarity": round(similarity, 4),
                        "refused": reason,
                        "competitor_similarity": round(competitor, 4),
                    }
                    for i, similarity, competitor, reason in result.refused
                ],
                indent=1,
            )
        )
        print(f"proposals (and refused faces) -> {args.dump}")
    if args.dry_run:
        print("dry run: nothing written")
        return
    accepted, pending, dropped = write_expansion(conn, person.id, faces, taken, result)
    print(f"written: {accepted} accepted, {pending} pending, {dropped} stale pending dropped")


def run_people() -> None:
    """Names people and finds their faces: create, seed, label, expand, status."""
    from .people import AUTO_THRESHOLD, REVIEW_THRESHOLD
    from .people_store import (
        PeopleError,
        create_person,
        decide,
        find_person,
        set_seeds,
        sole_faces,
    )

    parser = argparse.ArgumentParser(description=run_people.__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="a new person, birth date unknown")
    create.add_argument("--name", required=True)
    seed = commands.add_parser("seed", help="the owner's example faces of a person")
    seed.add_argument("--person", required=True, help="name or id")
    seed.add_argument("--faces", help="comma-separated face ids")
    seed.add_argument("--photos", help="comma-separated photo ids with a single face")
    label = commands.add_parser("label", help="yes/no on faces, as the review screen does")
    label.add_argument("--person", required=True, help="name or id")
    label.add_argument("--accept", help="comma-separated face ids")
    label.add_argument("--reject", help="comma-separated face ids")
    label.add_argument("--by", choices=("owner", "agent"), required=True)
    grow = commands.add_parser("expand", help="propose and accept faces from the known ones")
    grow.add_argument("--person", required=True, help="name or id")
    grow.add_argument("--auto", type=float, default=AUTO_THRESHOLD, help="auto-accept from")
    grow.add_argument("--review", type=float, default=REVIEW_THRESHOLD, help="propose from")
    grow.add_argument("--dry-run", action="store_true", help="compute, write nothing")
    grow.add_argument("--dump", type=Path, help="write every proposal to this JSON file")
    status = commands.add_parser("status", help="counts per year, and faces pass coverage")
    status.add_argument("--person", required=True, help="name or id")
    _env_arg(parser)
    args = parser.parse_args()

    with _connect(database_url(read_env(args.env_file))) as conn:
        register_vector(conn)
        try:
            if args.command == "create":
                person = create_person(conn, args.name)
                print(f"person {person.id}: {person.name}")
                return
            person = find_person(conn, args.person)
            if args.command == "seed":
                faces = _ids(args.faces)
                photos = _ids(args.photos)
                if photos:
                    faces += list(sole_faces(conn, photos).values())
                if not faces:
                    raise PeopleError("give --faces or --photos")
                print(f"{person.name}: {set_seeds(conn, person.id, faces)} seed faces")
            elif args.command == "label":
                accepted, rejected = decide(
                    conn, person.id, _ids(args.accept), _ids(args.reject), args.by
                )
                print(f"{person.name}: {accepted} accepted, {rejected} rejected ({args.by})")
            elif args.command == "expand":
                _expand(conn, person, args)
            _print_summary(conn, person.id)
            _print_coverage(conn)
        except PeopleError as error:
            raise SystemExit(str(error)) from error
