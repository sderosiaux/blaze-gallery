# Configuration

Everything is set through environment variables, read when the server
starts. [`.env.template`](../.env.template) has the same list with example
values; `cp .env.template .env` is the usual starting point.

An empty value counts as unset.

## Photo storage

| Variable | Default | Effect |
| --- | --- | --- |
| `BACKBLAZE_ENDPOINT` | required | S3 endpoint of the photo bucket, with `https://` or `http://`. Any S3-compatible service. |
| `BACKBLAZE_BUCKET` | required | Bucket holding the photos. Its folders become the albums. |
| `BACKBLAZE_ACCESS_KEY` | required | Key ID. List and read are enough to browse; uploads, deletions and thumbnails stored in this bucket need write and delete. |
| `BACKBLAZE_SECRET_KEY` | required | Secret of that key. |
| `BACKBLAZE_PUBLIC_ENDPOINT` | `BACKBLAZE_ENDPOINT` | Address browsers use to reach the bucket. Download links (zoom, video, download) are signed for it. Set it when the server's address is not reachable from browsers, such as `http://minio:9000` inside Compose. |

Requests are signed for region `us-east-1`. B2, R2 and MinIO accept it;
on AWS S3 only `us-east-1` buckets work.

## Database

| Variable | Default | Effect |
| --- | --- | --- |
| `DATABASE_URL` | required | PostgreSQL 13+ connection string. TLS follows `sslmode` in the URL (`require` for hosted databases). Docker Compose overrides it with its own database. |

`npm run db:migrate` creates the tables from `db/schema.sql`. It only adds
what is missing, so it is safe on an existing database; the Docker image
runs it on every start.

## Access

| Variable | Default | Effect |
| --- | --- | --- |
| `GOOGLE_AUTH_ENABLED` | `false` | `true` requires Google sign-in, limited to `AUTH_EMAIL_WHITELIST`. Setup: [SETUP_GOOGLE.md](../SETUP_GOOGLE.md). |
| `GOOGLE_CLIENT_ID` | | OAuth client ID. Required with sign-in. |
| `GOOGLE_CLIENT_SECRET` | | OAuth client secret. Required with sign-in. |
| `GOOGLE_REDIRECT_URI` | `$NEXT_PUBLIC_APP_URL/api/auth/google/callback` | Must match the redirect URI registered at Google. |
| `AUTH_EMAIL_WHITELIST` | | Comma-separated addresses allowed to sign in. Required with sign-in. |
| `AUTH_SESSION_DURATION` | `86400` | Sign-in session length, in seconds. |
| `AUTH_SESSION_SECRET` | random per process | 32+ characters. Required with sign-in. Also signs the sessions of password-protected shared links; without it they end when the server restarts. |
| `ALLOW_PUBLIC_ACCESS` | `false` | `true` runs a production server without sign-in: anyone who reaches it can browse, share, upload and delete. |
| `API_KEY` | | Sent as `Authorization: Bearer <key>` or `X-API-Key`. Required by `/api/sync/full`, `/api/sync/folder` and `/api/config`; accepted by `/api/mcp` instead of a session. |
| `ADMIN_API_KEY` | | A second key, accepted wherever `API_KEY` is, as long as `API_KEY` is set. |

A production server (`NODE_ENV=production`: the Docker image, `npm start`,
Vercel) answers 503 to every API call until either `GOOGLE_AUTH_ENABLED` or
`ALLOW_PUBLIC_ACCESS` is `true`. `npm run dev` has no such check.

## Public address

| Variable | Default | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | | The gallery's public URL. In production, Google sign-in and sign-out only accept requests from this origin, and it is the default base of `GOOGLE_REDIRECT_URI`. |

Next.js copies `NEXT_PUBLIC_*` values into the browser code at build time.
Share links use `NEXT_PUBLIC_APP_URL` if it was set when `npm run build`
ran (as on Vercel); otherwise they use the address in the browser, which is
the case for the Docker image.

## Thumbnails

Thumbnails (400 px) and the viewer's renditions (2048 px) are made from the
originals on first view, then stored.

| Variable | Default | Effect |
| --- | --- | --- |
| `THUMBNAIL_STORAGE` | `local` | `local`: files under `THUMBNAILS_PATH`. `s3`: objects under `THUMBNAIL_S3_PREFIX` in a bucket; use it where the disk does not persist (Vercel). |
| `THUMBNAILS_PATH` | `./data/thumbnails` | Directory for `local`. The Docker image sets `/app/data/thumbnails`. |
| `THUMBNAIL_S3_PREFIX` | `thumbnails` | Key prefix for `s3`. Renditions go under the sibling prefix `display`. |
| `THUMBNAIL_S3_ENDPOINT` | photo bucket | Separate bucket for `s3` thumbnails, for example Cloudflare R2. Set all four `THUMBNAIL_S3_*` connection variables or none. |
| `THUMBNAIL_S3_BUCKET` | photo bucket | |
| `THUMBNAIL_S3_ACCESS_KEY` | photo bucket key | Needs read and write. |
| `THUMBNAIL_S3_SECRET_KEY` | photo bucket key | |
| `AUTO_THUMBNAIL_THRESHOLD_MB` | `30` | Larger photos get no automatic thumbnail. RAW files are exempt: their embedded preview is used. |
| `THUMBNAIL_MAX_AGE_DAYS` | `30` | The cleanup job (`POST /api/sync/cleanup`) deletes thumbnails older than this; they are rebuilt on the next view. |

## S3 audit log

The app records its storage calls in the `s3_audit_logs` table (Admin, Audit).

| Variable | Default | Effect |
| --- | --- | --- |
| `AUDIT_CLEANUP_ENABLED` | `true` | `false` keeps entries forever. |
| `AUDIT_RETENTION_DAYS` | `30` | Age after which entries are deleted. |
| `AUDIT_CLEANUP_SCHEDULE` | `0 2 * * *` | Cron expression of the cleanup. It needs a long-running server: it does not run on Vercel. |
| `B2_BUCKET_NAME` | `unknown` | Bucket name written on the audit entries of thumbnail requests. |

## Logs and runtime

| Variable | Default | Effect |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARN` or `ERROR`. |
| `NEXT_TELEMETRY_DISABLED` | | `1` turns off Next.js telemetry. |
| `PORT`, `HOSTNAME` | `3000`, `0.0.0.0` in the image | Where the server listens. |

## Docker Compose only

Read by `docker-compose.yml` from `.env`, not by the app.

| Variable | Default | Effect |
| --- | --- | --- |
| `BLAZE_PORT` | `3000` | Host port of the gallery. |
| `POSTGRES_PASSWORD` | `blaze` | Password of the bundled PostgreSQL, applied when its volume is first created. The database is not published outside the Compose network. |
| `MINIO_PORT` | `9100` | Demo only: host port of MinIO's S3 API, bound to 127.0.0.1. |
| `COMPOSE_PROFILES` | | `demo` (as in `.env.demo`) adds MinIO and the seeding job to every `docker compose` command. |
