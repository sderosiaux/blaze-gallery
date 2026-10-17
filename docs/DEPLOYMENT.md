# Deployment

Blaze Gallery is a Next.js server plus a PostgreSQL database. It is built
for a long-running process: the sync queue, the thumbnail work and the
audit cleanup all run inside the server. Docker is the reference setup;
Vercel works with the limits listed below.

Whatever the platform, pick an access mode first (Google sign-in or
`ALLOW_PUBLIC_ACCESS=true`): a production server answers 503 to every API
call until one is set. See [CONFIGURATION.md](./CONFIGURATION.md#access).

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
- The sync queue runs in the background of the request that started it,
  and Vercel can freeze a function once it has answered. A full scan of a
  large bucket may not finish there; running it from a long-lived instance
  (Docker or `npm start`) on the same database and bucket does.
- The daily S3 audit-log cleanup never runs: it is a `node-cron` job inside
  the server process.

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
