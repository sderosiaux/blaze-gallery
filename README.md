# Blaze Gallery 🔥

**Your Backblaze photos, beautifully browsable.**

A lightning-fast, self-hosted photo gallery that seamlessly integrates with Backblaze B2 cloud storage. Browse, organize, and enjoy your photo collection with a modern, responsive interface that never modifies your original photos.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://hub.docker.com/r/your-username/blaze-gallery)
[![GitHub stars](https://img.shields.io/github/stars/your-username/blaze-gallery.svg)](https://github.com/your-username/blaze-gallery/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/your-username/blaze-gallery.svg)](https://github.com/your-username/blaze-gallery/issues)

## ✨ Features

### 🚀 **Lightning Fast Performance**
- **Smart Caching** - Thumbnails cached locally for instant loading
- **Lazy Loading** - Photos load as you scroll for smooth browsing
- **Optimized Database** - SQLite with proper indexing for fast queries
- **Configurable Thresholds** - Skip processing very large files automatically

### ☁️ **Cloud-Native Integration**
- **Backblaze B2 Compatible** - Seamless S3-compatible API integration
- **Read-Only Security** - Never modifies your original photos
- **Flexible Storage** - Works with any S3-compatible service
- **Cost-Effective** - Leverage Backblaze B2's affordable storage pricing

### 🎨 **Beautiful User Experience**
- **Modern Interface** - Clean, intuitive design built with Next.js and Tailwind CSS
- **Responsive Design** - Perfect on desktop, tablet, and mobile devices
- **Photo Lightbox** - Full-screen viewing with smooth transitions
- **Folder Navigation** - Browse your existing folder structure naturally

### 📊 **Smart Organization**
- **❤️ Favorites System** - Mark and organize your favorite photos
- **🔍 Powerful Search** - Find photos by filename, date, or metadata
- **📂 Folder Tooltips** - See folder stats and last visit information
- **📅 EXIF Metadata** - View photo details, GPS location, and camera settings

### 🔧 **Self-Hosted & Configurable**
- **🐳 Docker Ready** - Complete Docker Compose setup for easy deployment
- **🔒 Privacy First** - All data stays on your infrastructure
- **⚙️ Highly Configurable** - Tune performance and behavior via environment variables
- **🧹 Automatic Cleanup** - Manages disk space with configurable retention policies

## 🚀 Quick Start

Get your photo gallery running in under 5 minutes!

### Prerequisites
- Docker and Docker Compose installed
- A Backblaze B2 account with a bucket containing your photos

### 1. **Clone the Repository**
```bash
git clone https://github.com/your-username/blaze-gallery.git
cd blaze-gallery
```

### 2. **Configure Your Environment**
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

> 🔒 **Security Tip**: Create a **READ-ONLY** application key in Backblaze B2 for maximum security. Blaze Gallery never modifies your photos!

### 3. **Start the Application**
```bash
docker-compose up -d
```

### 4. **Access Your Gallery**
Open [http://localhost:3000](http://localhost:3000) in your browser

### 5. **Sync Your Photos**
Click the **"Sync"** button to scan your Backblaze bucket and start enjoying your photos!

That's it! 🎉 Your photos will be indexed automatically and thumbnails generated on-demand.

## ⚙️ Configuration

Blaze Gallery is highly configurable to suit your needs and infrastructure.

### Required Settings

Configure these in your `.env` file:

| Variable | Description | Example |
|----------|-------------|---------|
| `BACKBLAZE_ENDPOINT` | Your Backblaze B2 S3-compatible endpoint | `https://s3.us-west-004.backblazeb2.com` |
| `BACKBLAZE_BUCKET` | Your photo bucket name | `my-photo-bucket` |
| `BACKBLAZE_ACCESS_KEY` | Application Key ID (**READ-ONLY** recommended) | `004a1b2c3d4e5f...` |
| `BACKBLAZE_SECRET_KEY` | Application Key Secret | `K004abc123...` |

### Optional Performance Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `SYNC_THROTTLE_SECONDS` | Minimum seconds between folder sync requests | `30` |
| `AUTO_METADATA_THRESHOLD_MB` | Max file size for automatic EXIF extraction | `5` |
| `AUTO_THUMBNAIL_THRESHOLD_MB` | Max file size for automatic thumbnail generation | `10` |
| `THUMBNAIL_MAX_AGE_DAYS` | Days to keep thumbnails before cleanup | `30` |
| `SYNC_INTERVAL_HOURS` | Hours between automatic background syncs | `24` |

### Optional System Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` | `INFO` |
| `NEXT_TELEMETRY_DISABLED` | Disable Next.js telemetry | `1` |
| `DATABASE_PATH` | Custom database location (advanced) | Auto-detected |
| `THUMBNAILS_PATH` | Custom thumbnails location (advanced) | Auto-detected |

### Backblaze B2 Setup Guide

1. **Create or access your B2 bucket**
   - Go to [Backblaze B2 Console](https://secure.backblaze.com/b2_buckets.htm)
   - Create a private bucket or use existing one

2. **Create a READ-ONLY Application Key**
   - Navigate to "App Keys" → "Add a New Application Key"
   - **Key Name**: `blaze-gallery-readonly`
   - **Allow List Buckets**: ✅
   - **Allow List Files**: ✅
   - **Allow Read Files**: ✅
   - **Allow Write Files**: ❌ (Leave unchecked for security)
   - **Bucket**: Select your photo bucket
   
3. **Configure endpoints by region**
   - **US West**: `https://s3.us-west-004.backblazeb2.com`
   - **US East**: `https://s3.us-east-005.backblazeb2.com`
   - **EU Central**: `https://s3.eu-central-003.backblazeb2.com`

### Performance Tuning

For large photo collections (10,000+ photos):

```env
# Increase thresholds to skip processing very large RAW files
AUTO_METADATA_THRESHOLD_MB=2
AUTO_THUMBNAIL_THRESHOLD_MB=5

# More aggressive cleanup to save disk space
THUMBNAIL_MAX_AGE_DAYS=14

# Faster sync throttling for active browsing
SYNC_THROTTLE_SECONDS=15
```

For slower systems or limited bandwidth:
```env
# More conservative thresholds
AUTO_METADATA_THRESHOLD_MB=10
AUTO_THUMBNAIL_THRESHOLD_MB=20

# Less frequent background syncs
SYNC_INTERVAL_HOURS=48

# Longer throttling to reduce B2 API calls
SYNC_THROTTLE_SECONDS=60
```

## 🏗️ Architecture

Blaze Gallery is built with modern, performant technologies:

### Tech Stack
- **Frontend**: Next.js 14 with App Router, React, TypeScript, Tailwind CSS
- **Backend**: Node.js API routes with Better-SQLite3 database
- **Storage**: Backblaze B2 S3-compatible API
- **Image Processing**: Sharp for high-performance thumbnail generation
- **Deployment**: Docker containerized for easy self-hosting

### Data Flow
1. **Sync Service** scans your Backblaze B2 bucket for new photos
2. **Folder Hierarchy** is built and cached in local SQLite database
3. **Photo Metadata** (EXIF) is extracted and stored locally
4. **Thumbnails** are generated on-demand using Sharp
5. **Background Jobs** handle cleanup and maintenance automatically

### Project Structure
```
blaze-gallery/
├── src/
│   ├── app/                 # Next.js 14 App Router pages
│   ├── components/          # React UI components
│   ├── lib/                 # Core libraries (database, S3, sync)
│   ├── types/              # TypeScript definitions
│   └── styles/             # Tailwind CSS styles
├── data/
│   ├── database/           # SQLite database files
│   └── thumbnails/         # Generated thumbnail cache
├── docker/                 # Docker configuration
└── .env.template          # Environment configuration template
```

## 🔧 Development

### Local Development Setup

1. **Prerequisites**
   - Node.js 18+ and npm
   - Docker (for production testing)

2. **Install and Run**
   ```bash
   # Clone and install dependencies
   git clone https://github.com/your-username/blaze-gallery.git
   cd blaze-gallery
   npm install
   
   # Configure environment
   cp .env.template .env
   # Edit .env with your Backblaze credentials
   
   # Start development server
   npm run dev
   ```

3. **Available Commands**
   ```bash
   npm run dev          # Start development server
   npm run build        # Build for production
   npm run start        # Start production server
   npm run lint         # Run ESLint
   npm run type-check   # TypeScript validation
   ```

### Contributing

We welcome contributions! 🎉

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to your branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

## 🐳 Deployment

### Docker Compose (Recommended)

```yaml
version: '3.8'
services:
  blaze-gallery:
    image: blazegallery/blaze-gallery:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - BACKBLAZE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
      - BACKBLAZE_BUCKET=your-bucket
      - BACKBLAZE_ACCESS_KEY=your-key
      - BACKBLAZE_SECRET_KEY=your-secret
    restart: unless-stopped
```

### Production Considerations

- **Reverse Proxy**: Use nginx/Caddy for HTTPS and custom domains
- **Monitoring**: Built-in health endpoint at `/api/health`
- **Backups**: SQLite database and thumbnails in `/app/data`
- **Scaling**: Single instance design optimized for personal/family use

## 🛠️ Troubleshooting

### Connection Issues

**S3 Connection Failed**
- Verify Backblaze credentials and endpoint URL
- Check bucket permissions and region
- Set `LOG_LEVEL=DEBUG` for detailed logs
- Common errors:
  - `InvalidAccessKeyId`: Wrong Access Key
  - `NoSuchBucket`: Incorrect bucket name
  - `AccessDenied`: Insufficient permissions

### Performance Issues

**Slow Thumbnail Generation**
- Adjust `AUTO_THUMBNAIL_THRESHOLD_MB` to skip large files
- Monitor disk space for thumbnail cache
- Check system resources during sync

**High Memory Usage**
- Reduce thumbnail quality/size in configuration
- Lower `AUTO_METADATA_THRESHOLD_MB` for large files
- Restart container if memory usage grows over time

### Monitoring

```bash
# View logs
docker-compose logs -f blaze-gallery

# Health check
curl http://localhost:3000/api/health

# Sync status
curl http://localhost:3000/api/sync/status
```

## 🎯 Why Choose Blaze Gallery?

### For Photography Enthusiasts
- **Professional Workflow** compatible with Lightroom/Capture One exports
- **RAW + JPEG Support** for professional camera formats
- **EXIF Preservation** including GPS coordinates and camera settings
- **Folder Organization** maintains your existing structure

### For Families & Personal Use
- **Simple Setup** - Running in 5 minutes with Docker
- **Safe Browsing** - Never modifies your original photos
- **Mobile Friendly** - Beautiful experience on all devices
- **Search & Favorites** - Easy photo discovery and organization

### For Self-Hosters
- **Privacy First** - All processing happens on your infrastructure
- **Cost Effective** - Leverage Backblaze B2's affordable storage
- **Docker Native** - Simple deployment and maintenance
- **Open Source** - Audit, modify, and contribute to the codebase

## 📞 Support & Community

- 📖 **Documentation**: [Wiki](https://github.com/your-username/blaze-gallery/wiki)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/your-username/blaze-gallery/discussions)
- 🐛 **Issues**: [GitHub Issues](https://github.com/your-username/blaze-gallery/issues)
- 🔄 **Updates**: [Release Notes](https://github.com/your-username/blaze-gallery/releases)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Backblaze B2** - Affordable cloud storage that makes this possible
- **Next.js Team** - For the amazing React framework
- **Sharp** - Lightning-fast image processing
- **All Contributors** - Thank you for making Blaze Gallery better

---

<div align="center">

**⭐ Star this repository if you find Blaze Gallery useful!**

Built with ❤️ for photographers, families, and self-hosting enthusiasts

[View Demo](https://demo.blazegallery.io) • [Documentation](https://docs.blazegallery.io) • [Docker Hub](https://hub.docker.com/r/blazegallery/blaze-gallery)

</div>
