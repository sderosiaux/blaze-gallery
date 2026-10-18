"""Command-line entry points: blaze-worker, blaze-enqueue, blaze-queue, blaze-faces-preview."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import sys
import warnings
from pathlib import Path

import psycopg
from pgvector.psycopg import register_vector
from psycopg_pool import ConnectionPool

from .config import database_url, read_env, storage_settings

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


def run_worker() -> None:
    parser = argparse.ArgumentParser(description="Analyze queued photos.")
    parser.add_argument("--tasks", default="faces", help="comma-separated (faces)")
    parser.add_argument("--concurrency", type=int, default=2, help="inference workers")
    parser.add_argument("--owner", default=socket.gethostname(), help="name on the leases")
    parser.add_argument("--fetchers", type=int, default=8, help="download/decode threads")
    parser.add_argument("--writers", type=int, default=4, help="database write threads")
    parser.add_argument(
        "--threads", type=int, default=0, help="ONNX threads per worker (0: cores / concurrency)"
    )
    parser.add_argument("--provider", choices=("auto", "cpu", "coreml"), default="auto")
    parser.add_argument("--det-size", type=int, default=640, help="detector input (px)")
    parser.add_argument("--max-side", type=int, default=1024, help="detection rendition (px)")
    parser.add_argument("--lease", type=int, default=600, help="lease length (s)")
    parser.add_argument(
        "--wait",
        type=float,
        default=0,
        help="poll interval (s) when the queue is empty; 0 exits instead",
    )
    parser.add_argument(
        "--model-root", default=os.environ.get("BLAZE_MODEL_ROOT", "~/.insightface")
    )
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()

    from .faces import FaceModel, Thresholds, prepare_models, providers_for
    from .pipeline import Options, Worker
    from .storage import Originals

    env = read_env(args.env_file)
    url = database_url(env)
    cores = os.cpu_count() or 4
    threads = args.threads or max(1, cores // args.concurrency)
    providers = providers_for(args.provider)
    files = prepare_models(args.model_root)
    log.info(
        "owner=%s providers=%s workers=%d x %d threads, det=%d, model=%s",
        args.owner,
        providers,
        args.concurrency,
        threads,
        args.det_size,
        files.pipeline_model,
    )
    models = [
        FaceModel(files, providers, threads, args.det_size, Thresholds())
        for _ in range(args.concurrency)
    ]
    options = Options(
        owner=args.owner,
        tasks=tuple(t.strip() for t in args.tasks.split(",") if t.strip()),
        concurrency=args.concurrency,
        fetchers=args.fetchers,
        writers=args.writers,
        lease_seconds=args.lease,
        max_side=args.max_side,
        det_size=args.det_size,
        wait_seconds=args.wait,
    )
    pool = ConnectionPool(
        url,
        min_size=1,
        max_size=args.writers + 3,
        kwargs={"autocommit": True, "prepare_threshold": None},
        configure=register_vector,
        open=True,
    )
    worker = Worker(
        options, pool, Originals(storage_settings(env), args.fetchers + 2), files, models
    )
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: worker.stop())
    try:
        worker.run()
    finally:
        pool.close()


# -- blaze-enqueue ------------------------------------------------------------


def run_enqueue() -> None:
    from .enqueue import enqueue_all, enqueue_ids, sample_ids

    parser = argparse.ArgumentParser(description="Queue photos for analysis (images only).")
    parser.add_argument("--task", default="faces")
    what = parser.add_mutually_exclusive_group(required=True)
    what.add_argument("--all", action="store_true", help="every image of the library")
    what.add_argument("--sample", type=int, metavar="N", help="a spread of formats and years")
    what.add_argument("--ids", help="comma-separated photo ids")
    parser.add_argument(
        "--pin", help="comma-separated photo ids to put first (with --sample/--ids)"
    )
    parser.add_argument("--seed", default="blaze-sample-1", help="sample selection seed")
    _env_arg(parser)
    args = parser.parse_args()
    _setup_logging()

    def ids(text: str | None) -> list[int]:
        return [int(v) for v in text.split(",") if v.strip()] if text else []

    with _connect(database_url(read_env(args.env_file))) as conn:
        pinned = ids(args.pin)
        if pinned:
            log.info("pinned: %d queued", enqueue_ids(conn, args.task, pinned, pinned=True))
        if args.all:
            log.info("all images: %d queued", enqueue_all(conn, args.task))
        elif args.ids:
            log.info("ids: %d queued", enqueue_ids(conn, args.task, ids(args.ids), pinned=False))
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
                   round(avg((stats ->> 'ms_detect')::int + (stats ->> 'ms_rotate')::int
                             + (stats ->> 'ms_faces')::int)),
                   round(avg((stats ->> 'bytes')::bigint) / 1e6, 2),
                   round(avg((stats ->> 'faces')::int), 2)
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
