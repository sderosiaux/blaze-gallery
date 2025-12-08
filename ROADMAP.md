# Blaze Gallery Roadmap

> Vision: Transform from a single-user self-hosted gallery into a multi-tenant platform that helps families organize, manage, and rediscover their photo memories with AI assistance.

---

## Current State (v1.0)

- Single bucket, single user configuration
- Read-only access to photos (no modifications)
- Manual organization (folders reflect S3 structure)
- Sharing with password protection and expiry
- Thumbnail generation and caching
- Google OAuth authentication

---

## Phase 1: Multi-Tenant & Family Accounts

**Goal:** Support multiple users with their own buckets, enabling family sharing and SaaS deployment.

### 1.1 Dynamic Bucket Configuration
- [ ] Remove hardcoded bucket config from environment
- [ ] Store bucket configurations in database per user/organization
- [ ] Support multiple buckets per account (e.g., "Family Photos", "Work", "Archive")
- [ ] Bucket connection wizard (enter endpoint, bucket, credentials → test → save)
- [ ] Encrypted credential storage

### 1.2 User & Organization Model
- [ ] Organizations (families) as top-level entity
- [ ] Invite family members via email
- [ ] Role-based access:
  - **Owner**: Full admin, billing, can delete org
  - **Admin**: Manage members, all buckets
  - **Member**: View all, manage own favorites/shares
  - **Guest**: View-only access to specific shared folders
- [ ] Per-user favorites and viewing history
- [ ] Activity feed: "Mom added 47 photos to Summer 2024"

### 1.3 SaaS Infrastructure
- [ ] Tenant isolation (data, rate limits, storage quotas)
- [ ] Onboarding flow: Sign up → Connect storage → Start browsing
- [ ] Usage metering (photos indexed, thumbnails generated, API calls)
- [ ] Billing integration (Stripe) with plans:
  - **Free**: 1 bucket, 10k photos, basic sharing
  - **Family**: 5 buckets, unlimited photos, 5 members
  - **Pro**: Unlimited buckets, API access, priority support
- [ ] Admin dashboard for SaaS operator

### 1.4 Thumbnail Architecture for Multi-Tenant
- [ ] Per-tenant thumbnail namespacing
- [ ] Tenant-owned thumbnail storage option (use their bucket)
- [ ] Shared thumbnail CDN for SaaS (Cloudflare R2)
- [ ] Thumbnail cleanup on tenant offboarding

---

## Phase 2: Photo Management & Organization

**Goal:** Allow users to reorganize, deduplicate, and manage their photo library directly from Blaze.

### 2.1 Write Operations Framework
- [ ] "Write mode" toggle (explicit opt-in, clear warnings)
- [ ] Operation queue with preview before execution
- [ ] Undo buffer (keep deleted files for 30 days)
- [ ] Audit log of all modifications
- [ ] Dry-run mode for bulk operations

### 2.2 Duplicate Management
- [ ] Enhanced duplicate detection:
  - Exact hash match (current)
  - Perceptual hash (similar images)
  - Same photo, different resolutions
- [ ] Duplicate review UI:
  - Side-by-side comparison
  - Keep best quality option
  - Batch selection
- [ ] Actions: Delete duplicates, move to "Duplicates" folder, merge metadata
- [ ] Space savings calculator and reports

### 2.3 Folder Reorganization
- [ ] Drag-and-drop folder moves
- [ ] Rename folders
- [ ] Merge folders (combine two folders into one)
- [ ] Split folder (move selected photos to new folder)
- [ ] Bulk move photos between folders
- [ ] Create new folders

### 2.4 Photo Operations
- [ ] Delete photos (with trash/recovery)
- [ ] Move photos between folders
- [ ] Rename photos (with pattern support: `{date}_{original}`)
- [ ] Batch operations with selection UI
- [ ] Copy photo to another bucket

### 2.5 Collections (Virtual Albums)
- [ ] Create collections without moving files (references only)
- [ ] Quick "Add to collection" from photo viewer
- [ ] Share collections like folders (same password/expiry features)
- [ ] Smart collections (auto-populated by rules: date range, tags, search query)
- [ ] Collection cover photo selection

### 2.6 Date-Based Auto-Organization
- [ ] "Organize by date" wizard
- [ ] Preview proposed structure: `2024/2024-07 July/photo.jpg`
- [ ] Customizable patterns: `{year}/{month}/`, `{year}/{year}-{month}-{day}/`
- [ ] Handle photos without EXIF dates (use file modified date, or quarantine)
- [ ] Incremental organization (only new unorganized photos)

---

## Phase 3: AI-Powered Features

**Goal:** Use AI to help users organize, search, and rediscover their memories.

### 3.1 Smart Search
- [ ] Natural language search: "photos from beach last summer"
- [ ] Semantic search using image embeddings (CLIP)
- [ ] Search by description/scene: "birthday party", "sunset", "dog"
- [ ] Search by people (with manual tagging, no auto face-rec initially)
- [ ] Combined filters: "photos of kids at beach in 2023"

### 3.2 Auto-Tagging & Categorization
- [ ] Scene detection: beach, mountain, city, indoor, etc.
- [ ] Object detection: car, food, pet, etc.
- [ ] Activity detection: birthday, wedding, travel, sports
- [ ] Color palette extraction
- [ ] Privacy-first: all processing local or user-controlled API keys

### 3.3 AI Organization Suggestions
- [ ] "Suggested albums" based on:
  - Events (clustered by date + location)
  - Trips (sequential dates, changing locations)
  - People (faces appear together)
  - Themes (similar scenes/objects)
- [ ] One-click album creation from suggestions
- [ ] "This looks like a duplicate" suggestions
- [ ] "These 47 screenshots could be archived" suggestions
- [ ] "Best photo" selection from burst/similar shots

### 3.4 Memory Features
- [ ] "On this day" - photos from this date in previous years
- [ ] "Rediscover" - surface forgotten gems
- [ ] Auto-generated highlights: "Your 2024 in photos"
- [ ] Memory notifications (email/push): "5 years ago today..."

### 3.5 AI Infrastructure
- [ ] Pluggable AI backend:
  - Local: Ollama with LLaVA/CLIP models
  - Cloud: OpenAI Vision API, Google Cloud Vision
  - Self-hosted: User's own API endpoints
- [ ] Embedding storage and vector search (pgvector)
- [ ] Background processing queue for AI tasks
- [ ] Cost controls: daily/monthly API limits
- [ ] Privacy mode: never send photos to cloud APIs

---

## Phase 4: Mobile & Sync

**Goal:** Complete the Google Photos replacement story with mobile upload and sync.

### 4.1 Mobile Web Enhancements
- [ ] PWA support (installable, offline viewing of cached photos)
- [ ] Mobile-optimized upload flow
- [ ] Camera roll integration (via browser file picker)
- [ ] Share-to-Blaze from phone gallery

### 4.2 Mobile Apps (Future)
- [ ] React Native app for iOS/Android
- [ ] Background photo sync
- [ ] Automatic upload of new photos
- [ ] Local-first with sync

### 4.3 Desktop Sync
- [ ] Folder watch agent (like Google Drive sync)
- [ ] Selective sync
- [ ] Conflict resolution

---

## Technical Debt & Infrastructure

### Ongoing
- [ ] Comprehensive test coverage (unit, integration, e2e)
- [ ] API documentation (OpenAPI spec)
- [ ] Performance monitoring and alerting
- [ ] Database migrations strategy
- [ ] Backup and disaster recovery

### Thumbnail Infrastructure
- [ ] Move thumbnail generation to run closer to storage (B2/R2 workers)
- [ ] Evaluate edge thumbnail generation (Cloudflare Images, imgproxy)
- [ ] Thumbnail format optimization (WebP, AVIF based on client support)

### Security
- [ ] Security audit
- [ ] Penetration testing
- [ ] SOC 2 compliance (for SaaS)
- [ ] GDPR compliance tooling

---

## Success Metrics

| Phase | Key Metric | Target |
|-------|------------|--------|
| Phase 1 | Multi-tenant signups | 100 families |
| Phase 2 | Photos reorganized | 1M photos managed |
| Phase 3 | AI searches/day | 10k queries |
| Phase 4 | Mobile uploads | 50% of new photos |

---

## Principles

1. **Privacy first** - User data stays under user control
2. **Non-destructive by default** - Write operations are opt-in
3. **Bring your own storage** - We index, we don't store originals
4. **AI as assistant** - Suggestions, not auto-actions
5. **Works offline** - Core features don't require internet (for self-hosted)

---

## Inspiration & References

- [PhotoPrism](https://www.photoprism.app/editions) - Feature-rich self-hosted gallery ([demo](https://demo.photoprism.app/library/albums))
- [Immich](https://immich.app/) - Google Photos replacement with mobile apps
- [LibrePhotos](https://github.com/LibrePhotos/librephotos) - Self-hosted with face recognition

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to help with roadmap items.

Interested in a specific feature? Open an issue to discuss!
