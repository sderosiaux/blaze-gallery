/**
 * Migration script to upload local thumbnails to R2 and update Neon database paths
 *
 * Usage: npx tsx scripts/migrate-thumbnails-to-r2.ts
 */

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// R2 Configuration
const R2_ENDPOINT = process.env.THUMBNAIL_S3_ENDPOINT!;
const R2_BUCKET = process.env.THUMBNAIL_S3_BUCKET!;
const R2_ACCESS_KEY = process.env.THUMBNAIL_S3_ACCESS_KEY!;
const R2_SECRET_KEY = process.env.THUMBNAIL_S3_SECRET_KEY!;
const R2_PREFIX = process.env.THUMBNAIL_S3_PREFIX || 'thumbnails';

// Database
const DATABASE_URL = process.env.DATABASE_URL!;

// Local paths
const THUMBNAILS_DIR = path.join(process.cwd(), 'data', 'thumbnails');

// Create S3 client for R2
const s3Client = new S3Client({
  endpoint: R2_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

// Create PostgreSQL pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

interface PhotoRow {
  id: number;
  thumbnail_path: string | null;
  s3_key: string;
}

function getNewS3Key(photoId: number, s3Key: string): string {
  const dir = path.posix.dirname(s3Key);
  const baseName = path.posix.basename(s3Key, path.posix.extname(s3Key));
  const fileName = `${baseName}-${photoId}.jpeg`;

  const segments: string[] = [];
  if (R2_PREFIX) {
    segments.push(R2_PREFIX);
  }
  if (dir && dir !== '.') {
    segments.push(dir);
  }
  segments.push(fileName);

  return path.posix.join(...segments.filter(Boolean));
}

async function uploadThumbnail(localPath: string, s3Key: string): Promise<boolean> {
  try {
    const fileBuffer = fs.readFileSync(localPath);

    await s3Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return true;
  } catch (error) {
    console.error(`Failed to upload ${s3Key}:`, (error as Error).message);
    return false;
  }
}

// Process in batches with concurrency
async function processBatch(photos: PhotoRow[], batchSize: number = 20): Promise<{uploaded: number, failed: number, notFound: number, updated: number}> {
  let uploaded = 0;
  let failed = 0;
  let notFound = 0;
  let updated = 0;

  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);

    const results = await Promise.all(batch.map(async (photo) => {
      const localThumbnailPath = photo.thumbnail_path!;
      const localFilename = path.basename(localThumbnailPath);
      const localFullPath = path.join(THUMBNAILS_DIR, localFilename);
      const newS3Key = getNewS3Key(photo.id, photo.s3_key);

      // Check if local file exists
      if (!fs.existsSync(localFullPath)) {
        return { status: 'notFound', photoId: photo.id, newS3Key };
      }

      // Upload to R2
      const success = await uploadThumbnail(localFullPath, newS3Key);

      if (success) {
        return { status: 'uploaded', photoId: photo.id, newS3Key };
      } else {
        return { status: 'failed', photoId: photo.id, newS3Key };
      }
    }));

    // Update database for successful uploads
    for (const result of results) {
      if (result.status === 'uploaded') {
        await pool.query('UPDATE photos SET thumbnail_path = $1 WHERE id = $2', [result.newS3Key, result.photoId]);
        uploaded++;
        updated++;
      } else if (result.status === 'notFound') {
        notFound++;
      } else {
        failed++;
      }
    }

    console.log(`Progress: ${Math.min(i + batchSize, photos.length)}/${photos.length} (uploaded: ${uploaded}, failed: ${failed}, not found: ${notFound})`);
  }

  return { uploaded, failed, notFound, updated };
}

async function migrate() {
  console.log('Starting thumbnail migration to R2...');
  console.log(`R2 Endpoint: ${R2_ENDPOINT}`);
  console.log(`R2 Bucket: ${R2_BUCKET}`);
  console.log(`R2 Prefix: ${R2_PREFIX}`);
  console.log(`Thumbnails dir: ${THUMBNAILS_DIR}`);
  console.log('');

  // Get all photos with local thumbnail paths (only those with absolute paths)
  const result = await pool.query<PhotoRow>(`
    SELECT id, thumbnail_path, s3_key
    FROM photos
    WHERE thumbnail_path IS NOT NULL
      AND thumbnail_path != ''
      AND thumbnail_path LIKE '/%'
    ORDER BY id
  `);

  const photos = result.rows;
  console.log(`Found ${photos.length} photos with local thumbnails to migrate`);

  if (photos.length === 0) {
    console.log('No photos to migrate!');
    await pool.end();
    return;
  }

  const { uploaded, failed, notFound, updated } = await processBatch(photos, 20);

  await pool.end();

  console.log('');
  console.log('Migration complete!');
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Database updated: ${updated}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Not found locally: ${notFound}`);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  pool.end();
  process.exit(1);
});
