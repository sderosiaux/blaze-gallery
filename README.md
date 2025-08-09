# Blaze Gallery

A self-hosted photo gallery that integrates with Backblaze B2 cloud storage. Browse and organize your photo collection with a modern web interface that never modifies your original files.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Fast browsing** with smart caching, lazy loading, and progressive image loading
- **Backblaze B2 integration** using S3-compatible API
- **Read-only mode** - never modifies your original photos
- **Responsive design** - works on desktop, tablet, and mobile
- **Photo lightbox** with slideshow mode and keyboard navigation
- **Favorites system** and folder navigation
- **EXIF metadata** display including GPS location
- **Automatic thumbnails** with configurable size limits
- **Gallery statistics** with duplicate detection and space optimization
- **Audit dashboard** with performance monitoring and thumbnail analytics
- **Search functionality** across your entire photo collection
- **Random photo discovery** to rediscover forgotten memories
- **RAW file support** with intelligent handling (see limitations below)

## Quick Start

### Prerequisites
- Docker and Docker Compose
- Backblaze B2 account with a bucket containing photos

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/sderosiaux/blaze-gallery.git
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
   Open http://localhost:3000 and your photos will be automatically scanned and indexed

## Limitations

### RAW File Support
RAW camera files are supported but with limitations due to browser technology:

**❌ Cannot display in browser:**
- RAW files cannot be previewed directly in web browsers
- Files are detected and catalogued but show a helpful message instead of the image
- Download functionality works perfectly for editing in external software
- EXIF metadata is extracted and displayed when available

---

**⭐ If you find Blaze Gallery useful, please give it a star on GitHub!**

Built with ❤️ for photographers and self-hosting enthusiasts who want to keep their memories safe and beautifully browsable.