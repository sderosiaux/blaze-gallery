# Deployment

Blaze Gallery is a Next.js server plus a PostgreSQL database. It is built
for a long-running process: the sync queue, the thumbnail work and the
audit cleanup all run inside the server. Docker is the reference setup;
Vercel works with the limits listed below.

Whatever the platform, pick an access mode first (Google sign-in or
`ALLOW_PUBLIC_ACCESS=true`): a production server answers 503 to every API
call until one is set. See [CONFIGURATION.md](./CONFIGURATION.md#access).

The color strip under each folder cover comes from `folder_palettes`,
which no server request fills: folding the whole library's colors takes
seconds. Run `npm run palettes` (same `.env`) after each sync and while the
worker measures colors; `-- --dry-run` computes without writing. Until it
has run, folders show no strip.

## Docker Compose on a server

[SETUP.md](./SETUP.md#run-it-on-your-own-bucket-with-docker-compose)
covers the commands. For a server, also:

- Put the gallery behind a reverse proxy with TLS (example below) and set
  `NEXT_PUBLIC_APP_URL` to its public URL.
- Set `POSTGRES_PASSWORD` before the first start, and `AUTH_SESSION_SECRET`.
- Back up the `pgdata` volume: favorites, shares, rotations and the index
  live there. Thumbnails can be rebuilt from the originals.

Updating:

```bash
git pull
docker compose up -d --build
```

The new container applies any schema addition before it serves.

## The image alone

With a database you already run:

```bash
docker build -t blaze-gallery .
docker run -d --name blaze-gallery -p 3000:3000 --env-file .env \
  -v blaze-thumbnails:/app/data/thumbnails blaze-gallery
```

`DATABASE_URL` in `.env` must be reachable from the container (not
`localhost`), with `sslmode=require` for a hosted database. The container
runs `scripts/migrate.mjs` and then `server.js`, as user `node`. Its health
check polls `/api/health`, which answers 200 when the database and the
thumbnail storage respond.

## Node.js on a VM

```bash
npm ci
npm run db:migrate
npm run build
npm start          # port 3000; PORT changes it
```

Keep it running with your process manager (systemd, pm2). Run
`npm run db:migrate` again after each update, before restarting.

## Vercel

Import the repository, add the environment variables, deploy. Before the
first deployment, and after any update that changes `db/schema.sql`, run
`npm run db:migrate` from your machine with the production `DATABASE_URL`.

What differs from a long-running server:

- No persistent disk: set `THUMBNAIL_STORAGE=s3`. With `local`, thumbnails
  cannot be kept between invocations.
- Thumbnails and viewer renditions are made inside functions: the first
  view of each photo downloads the original from the bucket and resizes it
  there, which counts against function duration, memory and invocations,
  and against the bucket's egress.
- The app does not sync the bucket on Vercel: a function is frozen once it
  has answered, so a scan would stop midway. Run `npm run sync` from any
  machine with the same `.env` (by hand after adding photos, or from cron):
  it queues a full scan and runs the queue until it is empty. A job left
  without a heartbeat for 15 minutes is failed so it never blocks the next
  sync. The scan lists the whole bucket (a few minutes) and writes only what
  differs from the database: new files, replaced files, files gone. It never
  removes anything when the listing fails partway, and stops without writing
  when more than 5% of the photos would go (`--allow-mass-removal` to
  confirm). `npm run sync -- --dry-run` prints what it would change and
  writes nothing. After a sync, run `npm run palettes` (folder colour
  strips) and queue the new photos for analysis (below); the worker
  machine does all three in its weekly cron job.
- The daily S3 audit-log cleanup never runs: it is a `node-cron` job inside
  the server process.

## Search by content

Searching "les chats" finds photos of cats through SigLIP2 embeddings
(`photo_embeddings`, `search_query_embeddings` in `db/schema.sql`). The
functions never run the model. Two containers on the worker machine, both
from one image, do that work:

- `blaze-worker-embed` runs the `embed` task. It embeds each photo from its
  R2 thumbnail and leaves a photo queued until the thumbs pass has made that
  thumbnail. With `--follow thumbs` it waits while the thumbs pass is
  running, then exits, so the database can go idle.
- `blaze-embedder` holds the text model behind HTTPS and never touches the
  database. The app asks it for each query it has not seen before and keeps
  the answer in `search_query_embeddings`. If it doesn't answer within 3 s,
  the search falls back to folder and file names.

The app reads three variables: `EMBEDDER_URL` (`https://<server IP>:47443`),
`EMBEDDER_TOKEN` and `EMBEDDER_CA` (the certificate, PEM; newlines may be
written `\n`). The app trusts that certificate only. Without the three,
search works on names alone.

```bash
cd worker && docker build --target embed -t blaze-worker:embed .
# Once: a certificate for the server's IP (and 127.0.0.1, for an SSH tunnel)
# and a token, readable by you only
mkdir -m 700 embedder-tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -subj "/CN=blaze-embedder" -addext "subjectAltName=IP:<server IP>,IP:127.0.0.1" \
  -keyout embedder-tls/key.pem -out embedder-tls/cert.pem
chmod 600 embedder-tls/*
(umask 077; echo "EMBEDDER_TOKEN=$(openssl rand -hex 32)" > embedder.env)
# blaze.env: DATABASE_URL, BACKBLAZE_*, THUMBNAIL_S3_* (chmod 600)
docker run -d --name blaze-worker-embed --restart on-failure:5 --stop-timeout 120 \
  --cpu-shares 256 --env-file blaze.env blaze-worker:embed \
  --task embed --concurrency 2 --threads 2 --fetchers 12 --follow thumbs --owner hetzner-embed
docker run -d --name blaze-embedder --restart unless-stopped --cpu-shares 4096 \
  --user "$(id -u):$(id -g)" -p 47443:47443 --env-file embedder.env \
  -v "$PWD/embedder-tls:/run/blaze:ro" \
  --entrypoint blaze-embedder blaze-worker:embed --port 47443 \
  --cert /run/blaze/cert.pem --key /run/blaze/key.pem
```

`--cpu-shares 256` lets the thumbs pass take the CPU first. The embedder
gets no database setting. The port must be open in the host firewall
(`sudo ufw allow 47443/tcp`). On a host whose `DOCKER-USER` chain drops
outside traffic to containers (ours only lets 80/443 through, for another
project's proxy), run the embedder with `--network host` instead of `-p`:
it then sits behind the ufw rule only; until then the app tries once per minute per
instance, for 0.8 s, and answers with names only. `GET /health` needs no
token.
`docker restart blaze-embedder` is safe. New photos: `docker run --rm
--env-file blaze.env --entrypoint blaze-enqueue blaze-worker:embed --task <task>
--all` for faces, thumbs and embed queues the missing ones (running it again
changes nothing), then `docker start blaze-worker`, `docker start -a
blaze-worker-thumbs` and, once it has exited, `docker start blaze-worker-embed`:
embed only claims photos whose thumbnail exists, and stops at once when none
is ready yet. Each worker stops once its queue is empty, so the
database can suspend; nothing polls it between runs. Progress:
`--entrypoint blaze-queue ... --task embed`.

## Health check

`GET /api/health` needs no authentication. It runs one database query and
one storage check and returns booleans only:

```bash
curl -s http://localhost:3000/api/health
# {"success":true,"healthy":true,"checks":{"database":true,"thumbnails_directory":true,...}}
```

It answers 503 when either check fails.

## Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name photos.example.com;
    # ssl_certificate ... (certbot --nginx fills these in)

    client_max_body_size 200m;   # uploads: the app sets no limit of its own

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
