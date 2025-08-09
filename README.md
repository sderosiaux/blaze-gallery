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


## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit your changes (`git commit -m 'Add feature'`)
4. Push to the branch (`git push origin feature/name`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.