# Blaze Gallery Marketing

**Your Backblaze photos, beautifully browsable.**

A lightning-fast, self-hosted photo gallery that seamlessly integrates with Backblaze B2 cloud storage. Browse, organize, and enjoy your photo collection with a modern, responsive interface that never modifies your original photos.

## 🎯 Why Choose Blaze Gallery?

### For Photography Enthusiasts
- **Professional Workflow** compatible with Lightroom/Capture One exports
- **RAW + JPEG Support** for professional camera formats (.NEF, .CR2, .ARW, etc.)
- **EXIF Preservation** including GPS coordinates and camera settings
- **Folder Organization** maintains your existing structure
- **High-Quality Thumbnails** with configurable generation thresholds

### For Families & Personal Use
- **Simple Setup** - Running in 5 minutes with Docker
- **Safe Browsing** - Never modifies your original photos
- **Mobile Friendly** - Beautiful experience on all devices
- **Search & Favorites** - Easy photo discovery and organization
- **Slideshow Mode** - Perfect for sharing memories with family

### For Self-Hosters
- **Privacy First** - All processing happens on your infrastructure
- **Cost Effective** - Leverage Backblaze B2's affordable storage pricing
- **Docker Native** - Simple deployment and maintenance
- **Open Source** - Audit, modify, and contribute to the codebase
- **No Vendor Lock-in** - Your photos, your infrastructure, your control

## ✨ Key Features

### 🚀 Lightning Fast Performance
- **Smart Caching** - Thumbnails cached locally for instant loading
- **Lazy Loading** - Photos load as you scroll for smooth browsing
- **Optimized Database** - SQLite with proper indexing for fast queries
- **Configurable Thresholds** - Skip processing very large files automatically
- **Intelligent Preloading** - Next/previous photos ready before you click

### ☁️ Cloud-Native Integration
- **Backblaze B2 Compatible** - Seamless S3-compatible API integration
- **Read-Only Security** - Never modifies your original photos
- **Flexible Storage** - Works with any S3-compatible service
- **Cost-Effective** - Leverage Backblaze B2's affordable storage pricing
- **Regional Endpoints** - Choose your preferred data center location

### 🎨 Beautiful User Experience
- **Modern Interface** - Clean, intuitive design built with Next.js and Tailwind CSS
- **Responsive Design** - Perfect on desktop, tablet, and mobile devices
- **Photo Lightbox** - Full-screen viewing with smooth transitions
- **Folder Navigation** - Browse your existing folder structure naturally
- **Keyboard Shortcuts** - Power user navigation (←/→, Space, Esc)

### 📊 Smart Organization
- **❤️ Favorites System** - Mark and organize your favorite photos
- **🔍 Powerful Search** - Find photos by filename, date, or metadata
- **📂 Folder Tooltips** - See folder stats and last visit information
- **📅 EXIF Metadata** - View photo details, GPS location, and camera settings
- **📈 Gallery Statistics** - Track your collection size and growth

### 🔧 Self-Hosted & Configurable
- **🐳 Docker Ready** - Complete Docker Compose setup for easy deployment
- **🔒 Privacy First** - All data stays on your infrastructure
- **⚙️ Highly Configurable** - Tune performance and behavior via environment variables
- **🧹 Automatic Cleanup** - Manages disk space with configurable retention policies
- **📊 Built-in Monitoring** - Health endpoints and comprehensive logging

## 🏗️ Technical Excellence

### Modern Tech Stack
- **Frontend**: Next.js 14 with App Router, React 18, TypeScript, Tailwind CSS
- **Backend**: Node.js API routes with Better-SQLite3 database
- **Storage**: Backblaze B2 S3-compatible API with intelligent caching
- **Image Processing**: Sharp for high-performance thumbnail generation
- **Deployment**: Docker containerized with multi-architecture support

### Performance Optimizations
- **Thumbnail Caching** - Local disk caching with automatic cleanup
- **Database Indexing** - Optimized queries for large photo collections
- **Lazy Loading** - Progressive image loading as you browse
- **Connection Pooling** - Efficient S3 API usage with connection reuse
- **Memory Management** - Smart garbage collection and resource cleanup

### Security & Privacy
- **Read-Only Mode** - Application never modifies your original photos
- **Minimal Permissions** - Requires only List and Read access to B2
- **Local Processing** - All image processing happens on your server
- **No Telemetry** - No data collection or external tracking
- **Audit Logging** - Track all API usage and system activities

## 📈 Perfect For

### Individual Photographers
- Showcase your portfolio with professional presentation
- Maintain original folder structure from Lightroom exports
- Support for RAW files with intelligent fallback handling
- EXIF data preservation for technical reference

### Family Photo Collections
- Safe browsing without risk of accidental deletion
- Mobile-friendly interface for sharing with relatives
- Favorites system for highlighting special moments
- Simple setup that "just works" for non-technical users

### Photography Businesses
- Client gallery hosting without third-party dependencies
- Cost-effective storage using Backblaze B2 pricing
- Professional appearance with customizable branding potential
- Self-hosted for complete control and privacy

### Self-Hosting Enthusiasts
- Open source with MIT license for full transparency
- Docker-first design for easy integration into existing setups
- Comprehensive configuration options for fine-tuning
- Active development with regular feature updates

## 🌟 User Testimonials

> "Finally, a photo gallery that doesn't try to organize my photos for me. Blaze Gallery respects my folder structure and just makes them beautiful to browse." - Professional Photographer

> "The setup was incredibly simple. Five minutes from git clone to browsing my 10,000+ family photos." - Home User

> "Love that it's read-only. I can let family members browse without worrying about accidental changes to my originals." - Family Organizer

> "The Docker setup is perfect for my homelab. Scales beautifully and integrates perfectly with my existing infrastructure." - Self-Hosting Enthusiast

## 💡 Comparison

| Feature | Blaze Gallery | Google Photos | NextCloud Photos | PhotoPrism |
|---------|---------------|---------------|------------------|------------|
| **Self-Hosted** | ✅ | ❌ | ✅ | ✅ |
| **Read-Only Safety** | ✅ | ❌ | ❌ | ❌ |
| **Backblaze B2 Native** | ✅ | ❌ | ❌ | ❌ |
| **5-Minute Setup** | ✅ | ✅ | ❌ | ❌ |
| **RAW File Support** | ✅ | Limited | ✅ | ✅ |
| **Original Folder Structure** | ✅ | ❌ | ✅ | ❌ |
| **No ML/AI Processing** | ✅ | ❌ | ✅ | ❌ |
| **Resource Usage** | Low | N/A | Medium | High |

## 🚀 Getting Started Journey

### Step 1: Preparation (2 minutes)
- Sign up for Backblaze B2 (if needed)
- Upload your photos to a B2 bucket
- Create a read-only application key

### Step 2: Deployment (2 minutes)  
- Clone the repository
- Copy .env template and add your credentials
- Run `docker-compose up -d`

### Step 3: First Sync (1 minute)
- Access http://localhost:3000
- Click the "Sync" button
- Watch your photos appear in the gallery

### Step 4: Enjoy! (∞ minutes)
- Browse your photos with the beautiful interface
- Mark favorites and explore folders
- Share URLs with family and friends

## 📞 Support & Community

- 📖 **Documentation**: Comprehensive setup guides and troubleshooting
- 💬 **Discussions**: Active community for questions and feature requests
- 🐛 **Issues**: Responsive bug reporting and fixes
- 🔄 **Updates**: Regular feature releases and security updates
- 🤝 **Contributing**: Welcoming community for code contributions

## 🎁 Value Proposition

### Cost Savings
- **No Monthly Fees** - One-time setup, lifetime use
- **Backblaze B2 Pricing** - $5/TB/month vs $10+/TB with other providers
- **No Per-User Limits** - Share with unlimited family members
- **Self-Hosted Efficiency** - No bandwidth costs for internal access

### Time Savings  
- **5-Minute Setup** - From zero to browsing in minutes
- **No Photo Organization** - Works with your existing folder structure
- **Automatic Thumbnails** - No manual processing required
- **One-Click Sync** - Easy updates when you add new photos

### Peace of Mind
- **Read-Only Safety** - Impossible to accidentally delete originals
- **Full Control** - Your photos, your server, your rules
- **Privacy Protected** - No cloud provider access to your memories
- **Open Source** - Audit the code, modify as needed

---

*Ready to take control of your photo collection? Get started with Blaze Gallery today!*