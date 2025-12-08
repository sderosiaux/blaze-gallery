# Blaze Gallery

**Your photos. Your cloud. Your control.**

A beautiful, self-hosted photo gallery that connects to your S3-compatible storage. Browse thousands of photos with a fast, modern interface that never touches your original files.

<img width="1623" height="839" alt="Blaze Gallery Screenshot" src="https://github.com/user-attachments/assets/138a5e6a-2133-495c-a398-aafc1607a4c3" />

## Why Blaze Gallery?

- **Own your data** - Photos stay in your storage, not someone else's servers
- **No lock-in** - Works with any S3-compatible storage (Backblaze B2, AWS S3, Cloudflare R2, MinIO)
- **Read-only** - Never modifies your original photos
- **Fast** - Smart thumbnails and caching for instant browsing
- **Share privately** - Password-protected links with expiration dates

## Get Started in 2 Minutes

```bash
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery
cp .env.template .env
# Edit .env with your S3 credentials
docker-compose up -d
```

Open http://localhost:3000 and your photos will be automatically indexed.

## Features

| Feature | Description |
|---------|-------------|
| **Fast browsing** | Lazy loading, smart caching, progressive images |
| **Folder navigation** | Browse your existing folder structure |
| **Photo lightbox** | Slideshow mode, keyboard navigation, EXIF data |
| **Search** | Find photos across your entire collection |
| **Favorites** | Mark and filter your best shots |
| **Sharing** | Password-protected links with expiration |
| **Random discovery** | Rediscover forgotten memories |
| **Mobile-ready** | Responsive design for any device |

## Documentation

- **[Setup Guide](./docs/SETUP.md)** - Detailed installation and configuration
- **[Configuration](./docs/CONFIGURATION.md)** - Environment variables and options
- **[Deployment](./docs/DEPLOYMENT.md)** - Production deployment guides

## Requirements

- Docker and Docker Compose (recommended)
- Or: Node.js 18+ and PostgreSQL
- S3-compatible storage with your photos

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**[View Demo](https://sderosiaux.github.io/blaze-gallery)** | **[Report Issue](https://github.com/sderosiaux/blaze-gallery/issues)** | **[Star on GitHub](https://github.com/sderosiaux/blaze-gallery)**
