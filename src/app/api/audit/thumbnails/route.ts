import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { requireAuth } from "@/lib/auth/middleware";
import { query, requireRow } from "@/lib/database";
import { logger } from "@/lib/logger";
import { getThumbnailStorageInfo } from "@/lib/thumbnails";
import type { ThumbnailStorageInfo } from "@/lib/thumbnails";
import { listObjects } from "@/lib/s3";
import type {
  ThumbnailCoverage,
  ThumbnailStorageScan,
} from "@/components/audit/types";

export const dynamic = "force-dynamic";

// Two answers with very different costs:
// - default: coverage counts from the database, one query.
// - ?scope=storage: lists every thumbnail file (about 1,000 keys per
//   ListObjects page, sequential) and matches it against the photo records.
//   With ~11,000 files this takes 15-70 s, so the result is kept for
//   SCAN_TTL_MS and concurrent callers share one listing; ?refresh=1 forces a
//   new one.
const SCAN_TTL_MS = 10 * 60 * 1000;
const SAMPLE_SIZE = 10;

interface ScanCache {
  last: ThumbnailStorageScan | null;
  inflight: Promise<ThumbnailStorageScan> | null;
}

// On globalThis so the cached listing survives dev-server module reloads.
const globalForScan = globalThis as unknown as { thumbnailScan?: ScanCache };
const scanCache = (globalForScan.thumbnailScan ??= {
  last: null,
  inflight: null,
});

interface FileStats {
  files: { key: string; modified: Date }[];
  total_bytes: number;
  oldest: Date | null;
  newest: Date | null;
}

function track(stats: FileStats, key: string, size: number, modified: Date) {
  stats.files.push({ key, modified });
  stats.total_bytes += size;
  if (!stats.oldest || modified < stats.oldest) stats.oldest = modified;
  if (!stats.newest || modified > stats.newest) stats.newest = modified;
}

async function listS3Files(
  bucket: string,
  prefix?: string,
): Promise<FileStats> {
  const stats: FileStats = {
    files: [],
    total_bytes: 0,
    oldest: null,
    newest: null,
  };
  let continuationToken: string | undefined;
  let pageNumber = 1;

  do {
    const { objects, nextContinuationToken, isTruncated } = await listObjects({
      bucket,
      prefix,
      continuationToken,
      maxKeys: 1000,
      pageNumber,
      useThumbnailClient: true,
    });
    for (const obj of objects)
      track(stats, obj.key, obj.size, obj.lastModified);
    continuationToken = isTruncated ? nextContinuationToken : undefined;
    pageNumber += 1;
  } while (continuationToken);

  return stats;
}

function listLocalFiles(dir: string): FileStats {
  const stats: FileStats = {
    files: [],
    total_bytes: 0,
    oldest: null,
    newest: null,
  };
  for (const file of fs.readdirSync(dir)) {
    try {
      const fileStat = fs.statSync(path.join(dir, file));
      if (fileStat.isFile()) track(stats, file, fileStat.size, fileStat.mtime);
    } catch {
      // A file removed between readdir and stat is simply not counted.
    }
  }
  return stats;
}

function requireBucket(storage: ThumbnailStorageInfo): string {
  if (storage.bucket === undefined) {
    throw new Error("Thumbnail bucket is not configured");
  }
  return storage.bucket;
}

async function scanStorage(): Promise<ThumbnailStorageScan> {
  const startedAt = Date.now();
  const storage = getThumbnailStorageInfo();
  const isS3 = storage.mode === "s3";

  // Records first, files second: thumbnails keep being generated while the
  // listing runs, and a file written after this snapshot is new, not unused.
  const recordsResult = await query<{ thumbnail_path: string }>(`
    SELECT thumbnail_path FROM photos
    WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''
  `);
  // S3 records hold the full key; local records hold a path whose basename is
  // the file name.
  const recordKeys: string[] = recordsResult.rows.map((row) =>
    isS3 ? row.thumbnail_path : path.basename(row.thumbnail_path),
  );
  const snapshotAt = new Date();

  const directoryExists = isS3 || fs.existsSync(storage.location);
  const stats: FileStats = isS3
    ? await listS3Files(
        requireBucket(storage),
        storage.prefix ? `${storage.prefix}/` : undefined,
      )
    : directoryExists
      ? listLocalFiles(storage.location)
      : { files: [], total_bytes: 0, oldest: null, newest: null };

  const fileKeys = new Set(stats.files.map((f) => f.key));
  const recordSet = new Set(recordKeys);
  const missing = recordKeys.filter((key) => !fileKeys.has(key));
  const orphaned = stats.files
    .filter((f) => f.modified < snapshotAt && !recordSet.has(f.key))
    .map((f) => f.key);

  return {
    scanned_at: new Date().toISOString(),
    scan_ms: Date.now() - startedAt,
    mode: storage.mode,
    location: storage.location,
    directory_exists: directoryExists,
    file_count: stats.files.length,
    total_bytes: stats.total_bytes,
    oldest: stats.oldest?.toISOString() ?? null,
    newest: stats.newest?.toISOString() ?? null,
    missing: { count: missing.length, sample: missing.slice(0, SAMPLE_SIZE) },
    orphaned: {
      count: orphaned.length,
      sample: orphaned.slice(0, SAMPLE_SIZE),
    },
  };
}

function storageScan(refresh: boolean): Promise<ThumbnailStorageScan> {
  const { last } = scanCache;
  if (
    last &&
    !refresh &&
    Date.now() - Date.parse(last.scanned_at) < SCAN_TTL_MS
  ) {
    return Promise.resolve(last);
  }
  if (!scanCache.inflight) {
    scanCache.inflight = scanStorage()
      .then((scan) => {
        scanCache.last = scan;
        return scan;
      })
      .finally(() => {
        scanCache.inflight = null;
      });
  }
  return scanCache.inflight;
}

async function coverage(): Promise<ThumbnailCoverage> {
  const result = await query<{ total_photos: number; with_thumbnail: number }>(`
    SELECT
      COUNT(*)::int AS total_photos,
      (COUNT(*) FILTER (WHERE thumbnail_path IS NOT NULL AND thumbnail_path != ''))::int AS with_thumbnail
    FROM photos
  `);
  const { total_photos, with_thumbnail } = requireRow(
    result,
    "Thumbnail coverage",
  );
  const storage = getThumbnailStorageInfo();
  return {
    total_photos,
    with_thumbnail,
    without_thumbnail: total_photos - with_thumbnail,
    storage: { mode: storage.mode, location: storage.location },
  };
}

export const GET = requireAuth(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const data =
      searchParams.get("scope") === "storage"
        ? await storageScan(searchParams.get("refresh") === "1")
        : await coverage();

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logger.apiError("Error in GET /api/audit/thumbnails", error as Error, {
      method: "GET",
      path: "/api/audit/thumbnails",
    });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
});
