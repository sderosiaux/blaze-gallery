# Blaze Gallery

**Your photos. Your cloud. Your control.**

A self-hosted photo gallery for the photos you already keep in an S3-compatible bucket. Your folders become albums, dates come from EXIF, and nothing is imported or copied.

<img width="1623" height="839" alt="Blaze Gallery Screenshot" src="https://github.com/user-attachments/assets/138a5e6a-2133-495c-a398-aafc1607a4c3" />

## Why Blaze Gallery?

- **Own your data** - Photos stay in your storage, not someone else's servers
- **No lock-in** - Works with any S3-compatible storage (Backblaze B2, AWS S3, Cloudflare R2, MinIO)
- **Originals untouched** - Rotations and favorites live in the database; the bucket only changes when you upload or delete
- **Fast** - Smart thumbnails and caching for instant browsing
- **Share privately** - Password-protected links with expiration dates

## Try it

A demo library of 62 free photos, no account or bucket needed (Docker with Compose v2):

```bash
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery
cp .env.demo .env
docker compose --profile demo up -d --build
```

Then open http://localhost:3100. The first start downloads the sample photos and takes a few minutes.

## Use it with your photos

```bash
cp .env.template .env
# set BACKBLAZE_* to your bucket, then GOOGLE_AUTH_ENABLED or ALLOW_PUBLIC_ACCESS
docker compose up -d --build
```

Open http://localhost:3000. Compose runs PostgreSQL next to the app and creates the tables on start. The [setup guide](./docs/SETUP.md) covers Node.js without Docker and each storage provider.

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

- Docker with Compose v2, or Node.js 20.12+ and PostgreSQL 13+
- S3-compatible storage with your photos (Backblaze B2, Cloudflare R2, MinIO, AWS S3 in us-east-1)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

**[View Demo](https://sderosiaux.github.io/blaze-gallery)** | **[Report Issue](https://github.com/sderosiaux/blaze-gallery/issues)** | **[Star on GitHub](https://github.com/sderosiaux/blaze-gallery)**
