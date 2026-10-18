# Blaze analysis worker (CPU). Build from worker/:
#   docker build -t blaze-worker:local .
# Run with the app's .env (DATABASE_URL, BACKBLAZE_*):
#   docker run -d --name blaze-worker --env-file blaze.env --stop-timeout 120 \
#     blaze-worker:local --task faces --concurrency 4 --owner hetzner
# docker stop sends SIGTERM: the worker finishes the photos it holds, then
# exits; --stop-timeout leaves it the time to do so.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    BLAZE_MODEL_ROOT=/models \
    HOME=/home/worker \
    PATH=/app/.venv/bin:$PATH
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
RUN useradd --create-home --home-dir /home/worker --uid 10001 worker
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

# Weights are baked in: a container starts without reaching GitHub.
# InsightFace buffalo_l (non-commercial licence) and HSEmotion enet_b0_8.
RUN python -c "from blaze_worker.faces import prepare_models; print(prepare_models('/models'))" \
    && rm -f /models/models/*.zip \
    && chown -R worker:worker /models /home/worker

FROM base AS test
RUN uv sync --frozen
USER worker
ENTRYPOINT ["pytest", "-q", "--tb=short", "-p", "no:cacheprovider"]

FROM base AS runtime
USER worker
ENTRYPOINT ["blaze-worker"]

# Search by content: the SigLIP2 towers baked in on top (~1.5 GB). Build with
#   docker build --target embed -t blaze-worker:embed .
# The same image runs the embed task (blaze-worker --task embed) and the
# query embedder (--entrypoint blaze-embedder); docs/DEPLOYMENT.md.
# The weights get their own stage: a code change does not download them again.
FROM python:3.12-slim-bookworm AS siglip
COPY src/blaze_worker/siglip.py /build/siglip.py
RUN pip install --no-cache-dir numpy \
    && cd /build && python -c "from siglip import download; print(download('/models'))"

FROM base AS embed
COPY --from=siglip --chown=worker:worker /models/siglip2 /models/siglip2
USER worker
ENTRYPOINT ["blaze-worker"]
