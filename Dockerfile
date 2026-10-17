# syntax=docker/dockerfile:1

# Node 22 LTS on Alpine. sharp ships prebuilt musl binaries (they come with
# npm ci), so no compiler or system libvips is needed.
FROM node:22-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
COPY . .
RUN BUILD_STANDALONE=1 npm run build

# One-shot job of `docker compose --profile demo`: fills the demo bucket and
# has the app index it (demo/seed.mjs). Reuses the full node_modules for
# sharp and the S3 client.
FROM deps AS demo-seed
COPY demo ./demo
USER node
CMD ["node", "demo/seed.mjs"]

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    THUMBNAILS_PATH=/app/data/thumbnails

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node db ./db
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
# Thumbnails and display renditions (THUMBNAIL_STORAGE=local): mount a volume
# here so they survive a new image.
RUN mkdir -p /app/data/thumbnails && chown -R node:node /app/data

USER node
EXPOSE 3000

# /api/health: one database query and one look at thumbnail storage.
# busybox wget is part of the Alpine base.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

# The schema first (idempotent, see scripts/migrate.mjs), then the server.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
