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
- **Gallery statistics** with duplicate detection and space optimization
- **Audit dashboard** with performance monitoring and thumbnail analytics
- **Search functionality** across your entire photo collection
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

**✅ Supported for download and metadata:**
- Canon: `.CR2`, `.CR3`
- Nikon: `.NEF`
- Sony: `.ARW`
- Adobe: `.DNG`
- Fujifilm: `.RAF`
- Olympus: `.ORF`
- Panasonic: `.RW2`
- Pentax: `.PEF`
- Samsung: `.SRW`
- Sigma: `.X3F`

**❌ Cannot display in browser:**
- RAW files cannot be previewed directly in web browsers
- Files are detected and catalogued but show a helpful message instead of the image
- Download functionality works perfectly for editing in external software
- EXIF metadata is extracted and displayed when available

### Other Limitations
- **Thumbnail Generation**: Very large files (>50MB by default) skip automatic thumbnail generation for performance
- **EXIF Support**: Some proprietary camera formats may have limited metadata extraction
- **File Size**: Extremely large files may have slower initial loading times

## New Features

### Gallery Analytics (v1.2+)
- **Duplicate Detection**: Automatically identify duplicate photos by filename and size
- **Folder Duplicates**: Detect entirely duplicated folders (backup copies)
- **Storage Analytics**: Visual heatmaps showing folder sizes and photo distribution
- **Space Optimization**: Calculate potential space savings from removing duplicates
- **Ignored Files**: Transparency into system files excluded from analysis

### Performance Monitoring (v1.2+)
- **Audit Dashboard**: Comprehensive B2 performance monitoring
- **Thumbnail Analytics**: Track generation rates, cache hits, and storage usage
- **API Performance**: Monitor response times and error rates
- **System Health**: Database optimization and sync status tracking

### Enhanced User Experience (v1.2+)
- **Improved Favorites**: Instant feedback with optimistic updates
- **Better Navigation**: Floating navigation menus for large pages
- **Search Improvements**: Enhanced photo discovery capabilities
- **Mobile Optimization**: Better responsive design for all devices

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to the branch (`git push origin feature/name`)
5. Open a Pull Request

---

**⭐ If you find Blaze Gallery useful, please give it a star on GitHub!**

Built with ❤️ for photographers and self-hosting enthusiasts who want to keep their memories safe and beautifully browsable.