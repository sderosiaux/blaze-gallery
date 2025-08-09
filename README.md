# Blaze Gallery

A self-hosted photo gallery that integrates with Backblaze B2 cloud storage. Browse and organize your photo collection with a modern web interface that never modifies your original files.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Fast browsing** with smart caching and lazy loading
- **Backblaze B2 integration** using S3-compatible API
- **Read-only mode** - never modifies your original photos
- **Responsive design** - works on desktop, tablet, and mobile
- **Photo lightbox** with slideshow mode and keyboard navigation
- **Favorites system** and folder navigation
- **EXIF metadata** display including GPS location
- **Automatic thumbnails** with configurable size limits
- **RAW file support** (.NEF, .CR2, etc.) with proper handling

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Backblaze B2 account with a bucket containing photos

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/blaze-gallery.git
   cd blaze-gallery
   ```

2. **Configure environment**
   ```bash
   cp .env.template .env
   ```
   
   Edit `.env` with your Backblaze B2 credentials:
   ```env
   BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   BACKBLAZE_BUCKET=your-photo-bucket-name
   BACKBLAZE_ACCESS_KEY=your_application_key_id
   BACKBLAZE_SECRET_KEY=your_application_key_secret
   ```

3. **Start the application**
   ```bash
   docker-compose up -d
   ```

4. **Access your gallery**
   Open http://localhost:3000 and click "Sync" to scan your photos

## Configuration

### Required Settings

| Variable | Description | Example |
|----------|-------------|---------|
| `BACKBLAZE_ENDPOINT` | Backblaze B2 S3-compatible endpoint | `https://s3.us-west-004.backblazeb2.com` |
| `BACKBLAZE_BUCKET` | Your photo bucket name | `my-photos` |
| `BACKBLAZE_ACCESS_KEY` | Application Key ID (READ-ONLY recommended) | `004a1b2c3d4e5f...` |
| `BACKBLAZE_SECRET_KEY` | Application Key Secret | `K004abc123...` |

### Optional Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTO_THUMBNAIL_THRESHOLD_MB` | Max file size for automatic thumbnails | `30` |
| `AUTO_METADATA_THRESHOLD_MB` | Max file size for EXIF extraction | `5` |
| `THUMBNAIL_MAX_AGE_DAYS` | Days to keep thumbnails before cleanup | `30` |
| `SYNC_THROTTLE_SECONDS` | Minimum seconds between sync requests | `30` |
| `LOG_LEVEL` | Logging level: DEBUG, INFO, WARN, ERROR | `INFO` |

### Backblaze B2 Setup

1. Create a **READ-ONLY** Application Key in your Backblaze B2 console
2. Allow permissions: List Buckets ✅, List Files ✅, Read Files ✅, Write Files ❌
3. Use the correct regional endpoint for your bucket

## Development

### Local Development

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.template .env
# Edit .env with your credentials

# Start development server
npm run dev
```

### Available Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Production server
npm run lint         # Code linting
npm run type-check   # TypeScript validation
```

## Architecture

- **Frontend**: Next.js 14 with React and TypeScript
- **Backend**: Node.js API routes with SQLite database
- **Storage**: Backblaze B2 via S3-compatible API
- **Image Processing**: Sharp for thumbnail generation
- **Deployment**: Docker containerized

## Troubleshooting

### Connection Issues
- Verify Backblaze credentials and endpoint URL
- Check bucket permissions and region
- Set `LOG_LEVEL=DEBUG` for detailed logs

### Performance Issues
- Adjust `AUTO_THUMBNAIL_THRESHOLD_MB` to skip large files
- Monitor disk space for thumbnail cache
- Check system resources during sync operations

### Monitoring
```bash
# View logs
docker-compose logs -f blaze-gallery

# Health check
curl http://localhost:3000/api/health
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to the branch (`git push origin feature/name`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.