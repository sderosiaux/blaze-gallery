# Setup

Three ways to run Blaze Gallery, from the quickest to the most hands-on.
Each needs a clone of the repository:

```bash
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery
```

## Try the demo

Needs Docker with Compose v2.

```bash
cp .env.demo .env
docker compose --profile demo up -d --build
```

Open http://localhost:3100. The first start builds the image and downloads
62 sample photos from [Lorem Picsum](https://picsum.photos), so it needs a
network connection and takes a few minutes; later starts reuse everything.
`docker compose logs -f demo-seed` shows the seeding job until it prints
`ready`.

What runs: the app, PostgreSQL, a MinIO server holding the sample bucket,
and a one-shot job that uploads the photos with EXIF dates and asks the app
to index them. There is no sign-in (`ALLOW_PUBLIC_ACCESS=true`), which is
why the demo listens on your machine only and should stay there. The
photographers are credited in [demo/CREDITS.md](../demo/CREDITS.md).

Stop it with `docker compose down`; add `-v` to delete the database,
thumbnails and sample bucket as well.

## Run it on your own bucket with Docker Compose

```bash
cp .env.template .env
```

In `.env`, set the four `BACKBLAZE_*` variables to your bucket (see
[Storage providers](#storage-providers)) and choose who can open the
gallery: Google sign-in ([SETUP_GOOGLE.md](../SETUP_GOOGLE.md)) or
`ALLOW_PUBLIC_ACCESS=true`. The image runs in production mode, where the API
refuses every request until one of the two is set.

```bash
docker compose up -d --build
```

Open http://localhost:3000 (`BLAZE_PORT` changes the port). Compose starts
its own PostgreSQL, so `DATABASE_URL` in `.env` is ignored. On every start
the app creates any missing table (`scripts/migrate.mjs`), then serves.

The first page you open starts a full scan of the bucket. Folders appear as
it goes. Dates come from each photo's EXIF, read when a folder is first
displayed, so the timeline fills in as you open folders; a
`metadata_scan` reads a whole folder at once (below). Thumbnails are made on
first view and kept in the `thumbnails` volume.

New photos added to the bucket from elsewhere show up after the next full
scan. One runs each time the server starts (unless one finished within the
hour), and you can start one at any time with an API key:

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" http://localhost:3000/api/sync/full
curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"folderPath": "2023-05 Dolomites", "type": "metadata_scan"}' \
  http://localhost:3000/api/sync/folder
```

## Run it with Node.js

Needs Node.js 20.12 or newer (`.nvmrc` pins the version used in
development) and PostgreSQL 13 or newer.

```bash
npm ci
cp .env.template .env      # fill BACKBLAZE_*, DATABASE_URL, sign-in
npm run db:migrate         # creates the tables; safe to run again
npm run build
npm start
```

`npm run dev` starts a development server instead; it skips the sign-in
requirement.

The folder lookups compare paths byte by byte. `db/schema.sql` declares
`folders.path` with the `C` collation for that reason, so the database's
own locale does not matter.

## Storage providers

All providers use the same four variables. The key needs list and read on
the bucket, plus write and delete for uploads, deletions, and thumbnails
kept in the same bucket.

Backblaze B2 (endpoint shown on the bucket page; use an application key,
not the master key):

```env
BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKBLAZE_BUCKET=my-photos
BACKBLAZE_ACCESS_KEY=<keyID>
BACKBLAZE_SECRET_KEY=<applicationKey>
```

Cloudflare R2:

```env
BACKBLAZE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKBLAZE_BUCKET=my-photos
BACKBLAZE_ACCESS_KEY=<access key id>
BACKBLAZE_SECRET_KEY=<secret access key>
```

MinIO or another self-hosted server. If the app reaches it at an address
your browser cannot use (a container name, a private IP), set
`BACKBLAZE_PUBLIC_ENDPOINT` to the address the browser should use: download
links are signed for it.

```env
BACKBLAZE_ENDPOINT=http://minio:9000
BACKBLAZE_PUBLIC_ENDPOINT=https://s3.home.example.com
BACKBLAZE_BUCKET=photos
BACKBLAZE_ACCESS_KEY=<user>
BACKBLAZE_SECRET_KEY=<password>
```

AWS S3: requests are signed for `us-east-1`, so only buckets in that
region work at the moment.

```env
BACKBLAZE_ENDPOINT=https://s3.us-east-1.amazonaws.com
BACKBLAZE_BUCKET=my-photos
BACKBLAZE_ACCESS_KEY=<access key id>
BACKBLAZE_SECRET_KEY=<secret access key>
```

## Troubleshooting

Every API call answers 503 "Sign-in is not configured": the server runs in
production without `GOOGLE_AUTH_ENABLED=true` or `ALLOW_PUBLIC_ACCESS=true`.

The library stays empty: `docker compose logs app` shows the result of the
storage connection test at the first page load ("S3 connection failed"
followed by the reason). Check the endpoint (with `https://`), the bucket
name and the key's list permission.

Folders are there but the timeline is empty: dates come from the photos'
EXIF and are read when a folder's photos are first displayed. Photos without
EXIF dates never appear on the timeline.

`docker compose up` fails on the app's health check: `docker compose logs
app` shows the migration and startup output. A `DATABASE_URL` error there
means the `db` service is not healthy yet or its volume was created with a
different `POSTGRES_PASSWORD`.
