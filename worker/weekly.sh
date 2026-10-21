#!/bin/sh
# Weekly bucket sync for Blaze Gallery (indexes photos dropped straight into B2).
# Runs `npm run sync`, then `npm run palettes` (folder colour strips), from
# the latest main in a throwaway Node container; the container name doubles
# as a lock, so two runs never overlap. Then `npm run trash -- purge` erases
# what has waited 30 days in the Corbeille (refusing past a twentieth of the
# library). Then queues the new photos for every analysis (existing jobs are
# left alone) and starts the workers, which stop by themselves once their
# queue is empty (so Neon can suspend).
set -eu
BASE="$HOME/blaze-sync"
LOG="$BASE/logs/sync-$(date +%Y-%m-%d).log"
{
  echo "== $(date -Is) start"
  git -C "$BASE/repo" pull -q --ff-only
  docker run --rm --name blaze-sync \
    --env-file "$HOME/blaze-worker/blaze-worker.env" \
    -v "$BASE/repo:/app" -v blaze-sync-npm:/root/.npm -w /app \
    node:22-slim sh -c "npm ci --no-audit --no-fund --loglevel=error && { npm run sync; s=\$?; npm run palettes; exit \$s; }"
  # blaze-thumbs.env has the keys of both storages, originals and thumbnails.
  # A purge that stops (refused, storage error) leaves the indexing to run
  docker run --rm --name blaze-trash \
    --env-file "$HOME/blaze-worker/blaze-thumbs.env" \
    -v "$BASE/repo:/app" -w /app node:22-slim npm run trash -- purge ||
    echo "== $(date -Is) purge stopped"
  for task in faces thumbs embed; do
    docker run --rm --env-file "$HOME/blaze-worker/blaze-thumbs.env" \
      --entrypoint blaze-enqueue blaze-worker:embed --task "$task" --all
  done
  # Embed reads the thumbnails, so it starts once the thumbs worker has exited
  docker start blaze-worker
  docker start -a blaze-worker-thumbs >/dev/null
  docker start -a blaze-worker-embed >/dev/null
  # Tags read the embeddings: queued once embed has exited (photos with an
  # embedding only). A container keeps the image it was created from, and
  # its vocabulary: after a rebuild of blaze-worker:embed it is made again,
  # or every week the whole library would be queued for the old vocabulary
  if [ "$(docker inspect -f "{{.Image}}" blaze-worker-tags 2>/dev/null)" != \
       "$(docker image inspect -f "{{.Id}}" blaze-worker:embed)" ]; then
    docker rm -f blaze-worker-tags >/dev/null 2>&1 || true
    docker create --name blaze-worker-tags --restart on-failure:5 --stop-timeout 60 \
      --env-file "$HOME/blaze-worker/blaze-worker.env" blaze-worker:embed \
      --task tags --owner hetzner-tags >/dev/null
  fi
  docker run --rm --env-file "$HOME/blaze-worker/blaze-worker.env" \
    --entrypoint blaze-enqueue blaze-worker:embed --task tags --all
  docker start -a blaze-worker-tags >/dev/null
  # Stacks of near-duplicates for the new photos: after tags (screens and
  # documents only stack as exact copies), reading the thumbnails embed read.
  # A throwaway container, so it always runs the current image
  docker run --rm --env-file "$HOME/blaze-worker/blaze-thumbs.env" \
    --entrypoint blaze-enqueue blaze-worker:embed --task groups --all
  docker run --rm --name blaze-worker-groups --env-file "$HOME/blaze-worker/blaze-thumbs.env" \
    blaze-worker:embed --task groups --owner hetzner-groups
  echo "== $(date -Is) done"
} >>"$LOG" 2>&1
find "$BASE/logs" -name "sync-*.log" -mtime +14 -delete
