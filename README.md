# Blaze Gallery

A self-hosted photo gallery that integrates with *Backblaze B2* cloud storage (or any S3 storage actually). Browse and organize your photo collection with a modern web interface that never modifies your original files.

<img width="1623" height="839" alt="Screenshot 2025-08-09 at 20 11 30" src="https://github.com/user-attachments/assets/138a5e6a-2133-495c-a398-aafc1607a4c3" />

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
- **Folder sharing** with password protection and expiration dates
- **Share management** dashboard with access logs and analytics
- **RAW file support** with intelligent handling (see limitations below)
- **AI Integration** via MCP server - query your photos with Claude using natural language

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

### Thumbnail storage configuration

Blaze Gallery generates lightweight thumbnails for fast browsing. By default they
are stored on the local filesystem inside `data/thumbnails`. To keep your
deployment fully stateless you can instruct the app to write thumbnails back to
the same S3-compatible bucket that contains your photos:

```env
# Save thumbnails alongside your photos in S3 instead of local disk
THUMBNAIL_STORAGE=s3
THUMBNAIL_S3_PREFIX=thumbnails
```

Thumbnails are stored in a dedicated prefix (default `thumbnails/`) that mirrors
your original folder structure and appends the internal photo ID to the file
name to avoid collisions (e.g. `thumbnails/vacation/IMG_0001-42.jpeg`).

## AI Integration (MCP Server)

Blaze Gallery includes an **MCP (Model Context Protocol) server** that lets you query your photo collection using natural language with Claude and other AI assistants.

### Quick Setup
```bash
cd mcp-server
npm install && npm run build
```

### Example Queries
Once configured with Claude Desktop, you can ask:
- *"Show me all my photos from 2023"*
- *"Find photos taken with my Canon camera"*
- *"What's my photo collection breakdown by year?"*
- *"Show me trends in my photo uploads over time"*

**→ [Full MCP Setup Guide](./mcp-server/README.md)**

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
