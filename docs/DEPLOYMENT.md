# Deployment Guide

## Docker (Recommended)

### Using Docker Compose

```bash
# Clone and configure
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery
cp .env.template .env
# Edit .env with your credentials

# Start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Custom Docker Build

```bash
docker build -t blaze-gallery .
docker run -p 3000:3000 --env-file .env blaze-gallery
```

## Vercel

1. Fork the repository on GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

**Required environment variables:**
- `DATABASE_URL` - Use Neon, Supabase, or other hosted PostgreSQL
- `BACKBLAZE_*` - Your S3 storage credentials

## Railway

1. Connect your GitHub repository
2. Add PostgreSQL plugin
3. Set environment variables
4. Deploy

## Manual (VPS/Server)

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Nginx (optional, for reverse proxy)

### Installation

```bash
# Clone
git clone https://github.com/sderosiaux/blaze-gallery.git
cd blaze-gallery

# Install dependencies
npm install

# Build
npm run build

# Start with PM2
npm install -g pm2
pm2 start npm --name "blaze-gallery" -- start
pm2 save
pm2 startup
```

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name gallery.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL with Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d gallery.example.com
```

## Database Setup

### Neon (Recommended for Serverless)

1. Create account at neon.tech
2. Create new project
3. Copy connection string to `DATABASE_URL`

### Supabase

1. Create project at supabase.com
2. Go to Settings → Database
3. Copy connection string (use "Connection pooling" for serverless)

### Local PostgreSQL

```bash
# Create database
createdb blaze_gallery

# Set DATABASE_URL
export DATABASE_URL="postgresql://user:password@localhost:5432/blaze_gallery"
```

## Health Checks

The app exposes `/api/health` for monitoring:

```bash
curl http://localhost:3000/api/health
```

## Updating

```bash
# Pull latest
git pull origin main

# Rebuild
npm run build

# Restart
pm2 restart blaze-gallery
# Or: docker-compose up -d --build
```
