# Setup Guide

Complete guide to installing and configuring Blaze Gallery.

## Prerequisites

- **Docker and Docker Compose** (recommended) or Node.js 18+
- **PostgreSQL database** (local or hosted like Neon, Supabase)
- **S3-compatible storage** with your photos (Backblaze B2, AWS S3, Cloudflare R2, MinIO)

## Quick Start with Docker

### 1. Clone and Configure

```bash
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery
cp .env.template .env
```

### 2. Edit Environment Variables

Open `.env` and configure your storage:

```env
# S3 Storage (Backblaze B2 example)
BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKBLAZE_BUCKET=your-photo-bucket
BACKBLAZE_ACCESS_KEY=your_key_id
BACKBLAZE_SECRET_KEY=your_secret_key

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/blaze_gallery
```

### 3. Start the Application

```bash
docker-compose up -d
```

### 4. Access Your Gallery

Open http://localhost:3000. Your photos will be automatically scanned and indexed.

## Manual Installation (Node.js)

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Database

Create a PostgreSQL database and run migrations:

```bash
npm run db:migrate
```

### 3. Build and Run

```bash
npm run build
npm start
```

## Storage Providers

### Backblaze B2

```env
BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKBLAZE_BUCKET=your-bucket-name
BACKBLAZE_ACCESS_KEY=your_application_key_id
BACKBLAZE_SECRET_KEY=your_application_key
```

### AWS S3

```env
BACKBLAZE_ENDPOINT=https://s3.amazonaws.com
BACKBLAZE_BUCKET=your-bucket-name
BACKBLAZE_ACCESS_KEY=your_aws_access_key
BACKBLAZE_SECRET_KEY=your_aws_secret_key
AWS_REGION=us-east-1
```

### Cloudflare R2

```env
BACKBLAZE_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
BACKBLAZE_BUCKET=your-bucket-name
BACKBLAZE_ACCESS_KEY=your_r2_access_key
BACKBLAZE_SECRET_KEY=your_r2_secret_key
```

### MinIO (Self-hosted)

```env
BACKBLAZE_ENDPOINT=http://localhost:9000
BACKBLAZE_BUCKET=photos
BACKBLAZE_ACCESS_KEY=minioadmin
BACKBLAZE_SECRET_KEY=minioadmin
```

## Thumbnail Storage

By default, thumbnails are stored locally in `data/thumbnails`. For stateless deployments, store them in S3:

```env
THUMBNAIL_STORAGE=s3
THUMBNAIL_S3_PREFIX=thumbnails
```

## Authentication (Optional)

Enable Google OAuth for protected access:

```env
AUTH_ENABLED=true
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
AUTH_ALLOWED_EMAILS=you@example.com,friend@example.com
```

## Troubleshooting

### Photos not appearing

1. Check S3 credentials are correct
2. Verify bucket permissions allow listing and reading
3. Check the sync status in the admin panel

### Slow thumbnail generation

Thumbnails are generated on-demand. First load may be slow for large collections. Consider pre-generating with:

```bash
npm run sync:thumbnails
```

### Database connection errors

Ensure `DATABASE_URL` is correct and the database is accessible from your deployment.
