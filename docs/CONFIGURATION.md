# Configuration Reference

All configuration is done via environment variables.

## Required Variables

### Storage

| Variable | Description | Example |
|----------|-------------|---------|
| `BACKBLAZE_ENDPOINT` | S3-compatible endpoint URL | `https://s3.us-west-004.backblazeb2.com` |
| `BACKBLAZE_BUCKET` | Bucket name containing photos | `my-photos` |
| `BACKBLAZE_ACCESS_KEY` | Access key ID | `0012345678abcdef` |
| `BACKBLAZE_SECRET_KEY` | Secret access key | `K000xxxxxxxxxxxxx` |

### Database

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |

## Optional Variables

### Thumbnails

| Variable | Default | Description |
|----------|---------|-------------|
| `THUMBNAIL_STORAGE` | `local` | Storage type: `local` or `s3` |
| `THUMBNAIL_S3_PREFIX` | `thumbnails` | S3 prefix when using S3 storage |
| `THUMBNAIL_MAX_WIDTH` | `400` | Maximum thumbnail width in pixels |
| `THUMBNAIL_QUALITY` | `80` | JPEG quality (1-100) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable Google OAuth |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth client secret |
| `AUTH_ALLOWED_EMAILS` | - | Comma-separated list of allowed emails |
| `NEXTAUTH_URL` | - | Your app's public URL |
| `NEXTAUTH_SECRET` | - | Random secret for session encryption |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public URL for share links |
| `NODE_ENV` | `development` | Environment mode |

### AWS Region (for AWS S3 only)

| Variable | Default | Description |
|----------|---------|-------------|
| `AWS_REGION` | `us-east-1` | AWS region for S3 |

## Example .env File

```env
# S3 Storage (Backblaze B2)
BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
BACKBLAZE_BUCKET=my-photo-bucket
BACKBLAZE_ACCESS_KEY=0012345678abcdef0000
BACKBLAZE_SECRET_KEY=K000abcdefghijklmnopqrstuvwxyz1234

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/blaze_gallery

# Thumbnails (optional - defaults to local storage)
THUMBNAIL_STORAGE=s3
THUMBNAIL_S3_PREFIX=thumbnails

# Authentication (optional - disabled by default)
AUTH_ENABLED=true
GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
AUTH_ALLOWED_EMAILS=me@example.com,friend@example.com

# Application
NEXT_PUBLIC_APP_URL=https://gallery.example.com
```
