import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./logger";
import { createS3AuditMiddleware } from "./s3Audit";
import crypto from "crypto";

// Initialize audit middleware
const auditMiddleware = createS3AuditMiddleware();

// Presigned URL cache interface
interface CachedUrl {
  url: string;
  expiresAt: number; // Unix timestamp
  createdAt: number; // Unix timestamp
}

// In-memory cache for presigned URLs
const urlCache = new Map<string, CachedUrl>();

// Cache cleanup interval (run every 5 minutes)
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupInterval: NodeJS.Timeout | null = null;

// Initialize cache cleanup
function initializeCacheCleanup() {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, cached] of urlCache.entries()) {
      if (now >= cached.expiresAt) {
        urlCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(
        `Cleaned up ${cleanedCount} expired presigned URLs from cache`,
      );
    }
  }, CACHE_CLEANUP_INTERVAL);
}

// Generate cache key for presigned URLs
function getCacheKey(bucket: string, key: string, expiresIn: number): string {
  return `${bucket}:${key}:${expiresIn}`;
}

// Get cache statistics for monitoring
export function getUrlCacheStats() {
  const now = Date.now();
  let validCount = 0;
  let expiredCount = 0;

  for (const cached of urlCache.values()) {
    if (now < cached.expiresAt) {
      validCount++;
    } else {
      expiredCount++;
    }
  }

  return {
    totalCached: urlCache.size,
    validUrls: validCount,
    expiredUrls: expiredCount,
    memoryUsage: urlCache.size * 200, // Rough estimate: ~200 bytes per cached URL
  };
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

class S3Manager {
  private static instance: S3Manager;
  private static thumbnailInstance: S3Manager | null = null;
  private s3Client: S3Client | null = null;
  private currentConfigHash: string | null = null;
  private isInitialized = false;
  private bucketName: string = "";

  constructor() {}

  static getInstance(): S3Manager {
    if (!S3Manager.instance) {
      S3Manager.instance = new S3Manager();
    }
    return S3Manager.instance;
  }

  /**
   * Get or create a separate S3Manager instance for thumbnail storage.
   * Uses separate credentials if configured, otherwise falls back to main credentials.
   */
  static getThumbnailInstance(): S3Manager {
    const { getConfig } = require("./config");
    const config = getConfig();

    // If no separate thumbnail S3 config, use main instance
    if (
      !config.thumbnail_s3_endpoint ||
      !config.thumbnail_s3_bucket ||
      !config.thumbnail_s3_access_key ||
      !config.thumbnail_s3_secret_key
    ) {
      return S3Manager.getInstance();
    }

    // Create or return dedicated thumbnail instance
    if (!S3Manager.thumbnailInstance) {
      S3Manager.thumbnailInstance = new S3Manager();
    }

    // Initialize with thumbnail-specific config
    S3Manager.thumbnailInstance.initializeClient({
      endpoint: config.thumbnail_s3_endpoint,
      bucket: config.thumbnail_s3_bucket,
      accessKeyId: config.thumbnail_s3_access_key,
      secretAccessKey: config.thumbnail_s3_secret_key,
      region: "auto", // R2 uses "auto" region
    });
    S3Manager.thumbnailInstance.bucketName = config.thumbnail_s3_bucket;

    return S3Manager.thumbnailInstance;
  }

  /**
   * Get the thumbnail bucket name (separate bucket if configured, otherwise main bucket)
   */
  static getThumbnailBucketName(): string {
    const { getConfig } = require("./config");
    const config = getConfig();

    if (config.thumbnail_s3_bucket) {
      return config.thumbnail_s3_bucket;
    }
    return config.backblaze_bucket;
  }

  private generateConfigHash(config: S3Config): string {
    const configString = JSON.stringify({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region || "us-east-1",
    });
    return crypto.createHash("sha256").update(configString).digest("hex");
  }

  private needsReinitialization(config: S3Config): boolean {
    const newConfigHash = this.generateConfigHash(config);
    return !this.isInitialized || this.currentConfigHash !== newConfigHash;
  }

  /**
   * Get S3 client with auto-initialization
   * Fetches config and initializes client transparently if needed
   */
  getS3Client(): S3Client {
    this.ensureInitialized();
    return this.s3Client!;
  }

  /**
   * Get the configured bucket name
   * Auto-initializes S3Manager if needed and returns bucket name
   */
  getBucketName(): string {
    this.ensureInitialized();

    const { getConfig } = require("./config");
    const config = getConfig();
    return config.backblaze_bucket;
  }

  /**
   * Ensure S3Manager is initialized without returning the client
   * Single source of truth for initialization logic
   */
  private ensureInitialized(): void {
    if (this.isInitialized && this.s3Client) {
      return; // Already initialized
    }

    const { getConfig } = require("./config");
    const config = getConfig();

    this.initializeClient({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });
  }

  initializeClient(config: S3Config): S3Client {
    try {
      // Check if we need to reinitialize
      if (!this.needsReinitialization(config)) {
        logger.debug(
          `Using cached S3 client for ${config.bucket}@${config.endpoint}`,
        );
        return this.s3Client!;
      }

      logger.s3Connection(
        `Initializing S3 client for ${config.bucket}@${config.endpoint}`,
      );

      // Close existing client if present
      if (this.s3Client) {
        this.s3Client.destroy();
      }

      // Create new client with optimized settings
      this.s3Client = new S3Client({
        endpoint: config.endpoint,
        region: config.region || "us-east-1",
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        forcePathStyle: true,
        // Optimize connection settings
        maxAttempts: 3,
        requestHandler: {
          connectionTimeout: 30000, // 30 seconds
          socketTimeout: 60000, // 60 seconds
          keepAlive: true,
          maxSockets: 50, // Connection pool size
        },
      });

      this.currentConfigHash = this.generateConfigHash(config);
      this.isInitialized = true;

      logger.debug(
        `S3 client initialized successfully for ${config.bucket}@${config.endpoint}`,
      );

      return this.s3Client;
    } catch (error) {
      logger.s3Error(
        `Failed to initialize S3 client: ${config.bucket}@${config.endpoint}`,
        error as Error,
      );
      throw error;
    }
  }

  getClient(): S3Client {
    if (!this.s3Client || !this.isInitialized) {
      const error = new Error(
        "S3 client not initialized. Call initializeClient first.",
      );
      logger.s3Error("S3 client not initialized", error);
      throw error;
    }
    return this.s3Client;
  }

  destroy(): void {
    if (this.s3Client) {
      this.s3Client.destroy();
      this.s3Client = null;
      this.currentConfigHash = null;
      this.isInitialized = false;
      logger.s3Connection("S3 client destroyed");
    }
  }
}

// Legacy compatibility functions
export function initializeS3Client(config: S3Config): S3Client {
  return S3Manager.getInstance().initializeClient(config);
}

/**
 * Get S3 client with auto-initialization
 * This is the recommended way to get S3 client in endpoints
 */
export function getS3Client(): S3Client {
  return S3Manager.getInstance().getS3Client();
}

/**
 * Get S3 client for thumbnail storage
 * Uses separate credentials if configured, otherwise falls back to main credentials
 */
export function getThumbnailS3Client(): S3Client {
  return S3Manager.getThumbnailInstance().getS3Client();
}

/**
 * Get the thumbnail bucket name
 * Returns separate bucket if configured, otherwise main bucket
 */
export function getThumbnailBucketName(): string {
  return S3Manager.getThumbnailBucketName();
}

export function destroyS3Client(): void {
  S3Manager.getInstance().destroy();
}

export interface S3Object {
  key: string;
  lastModified: Date;
  size: number;
  etag: string;
}

export async function listObjects(
  bucket: string,
  prefix?: string,
  continuationToken?: string,
  maxKeys: number = 1000,
  pageNumber: number = 1,
  request?: Request,
): Promise<{
  objects: S3Object[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}> {
  const client = getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;
    const pageInfo = pageNumber > 1 ? ` (page ${pageNumber})` : "";
    logger.s3Connection(`Listing objects from S3: ${folderDesc}${pageInfo}`);

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: maxKeys,
    });

    const response = await client.send(command);
    const duration = Date.now() - startTime;

    const objects: S3Object[] = (response.Contents || []).map((obj) => ({
      key: obj.Key!,
      lastModified: obj.LastModified!,
      size: obj.Size!,
      etag: obj.ETag!.replace(/"/g, ""),
    }));

    // Calculate actual HTTP response size
    const responseSize =
      JSON.stringify(objects).length +
      JSON.stringify({
        nextContinuationToken: response.NextContinuationToken,
        isTruncated: response.IsTruncated,
      }).length;

    // Log results count and HTTP response size
    const folderDescWithCount = prefix
      ? `${bucket}/${prefix}`
      : `${bucket} (root)`;
    const pageInfoWithCount = pageNumber > 1 ? ` (page ${pageNumber})` : "";
    const responseSizeKB = (responseSize / 1024).toFixed(1);
    logger.s3Connection(
      `Retrieved ${objects.length} objects from S3: ${folderDescWithCount}${pageInfoWithCount} (${duration}ms, ${responseSizeKB}KB)`,
    );

    await auditMiddleware.log({
      operation: "ListObjects",
      method: "GET",
      bucket,
      key: prefix,
      startTime,
      statusCode,
      bytesTransferred: responseSize,
      request,
    });

    const logContext = {
      bucket,
      prefix: prefix || "(root)",
      objectCount: objects.length,
      isTruncated: response.IsTruncated || false,
      hasNextToken: !!response.NextContinuationToken,
      duration,
      operation: "listObjects",
    };

    // In DEBUG mode, include sample objects for troubleshooting
    if (process.env.LOG_LEVEL === "DEBUG") {
      if (objects.length === 0) {
        const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;
        logger.debug(`No objects found in ${folderDesc} (${duration}ms)`);
      } else {
        const sampleObjects = objects.slice(0, 5).map((obj) => ({
          key: obj.key,
          size: obj.size,
          lastModified: obj.lastModified.toISOString(),
          etag: obj.etag.substring(0, 8) + "...", // Truncate etag for readability
        }));

        const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;
        const truncatedInfo = response.IsTruncated ? " (more available)" : "";
        logger.debug(
          `Found ${objects.length} objects in ${folderDesc}${truncatedInfo} (${duration}ms`,
        );

        // Show sample files in DEBUG mode
        sampleObjects.forEach((obj) => {
          logger.debug(`  ${obj.key} (${(obj.size / 1024).toFixed(1)}KB)`);
        });
      }
    } else {
      const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;
      const truncatedInfo = response.IsTruncated ? " (more available)" : "";
      logger.debug(
        `Found ${objects.length} objects in ${folderDesc}${truncatedInfo} (${duration}ms)`,
      );
    }

    // Keep original detailed logging for error investigation (DEBUG level only)
    if (process.env.LOG_LEVEL === "DEBUG") {
      const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;
      logger.debug(
        `S3 listing details: ${folderDesc}, ${objects.length} objects, ${duration}ms`,
      );
    }

    return {
      objects,
      nextContinuationToken: response.NextContinuationToken,
      isTruncated: response.IsTruncated || false,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const folderDesc = prefix ? `${bucket}/${prefix}` : `${bucket} (root)`;

    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: "ListObjects",
      method: "GET",
      bucket,
      key: prefix,
      startTime,
      statusCode,
      error: errorMessage,
      request,
    });

    logger.s3Error(
      `Failed to list objects from ${folderDesc} after ${duration}ms`,
      error as Error,
    );
    throw error;
  }
}

export async function getObjectMetadata(
  bucket: string,
  key: string,
  request?: Request,
) {
  const client = S3Manager.getInstance().getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    logger.s3Connection(`Getting metadata for ${key}`);

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const result = await client.send(command);

    // Audit logging
    await auditMiddleware.log({
      operation: "HeadObject",
      method: "HEAD",
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: 0, // HEAD requests don't transfer body data
      request,
    });

    logger.debug(
      `Successfully retrieved metadata for ${key} (${result.ContentLength} bytes)`,
    );

    return result;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: "HeadObject",
      method: "HEAD",
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request,
    });

    logger.s3Error("Failed to get object metadata", error as Error, {
      bucket,
      key,
      operation: "getObjectMetadata",
    });
    throw error;
  }
}

export async function getSignedDownloadUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600,
  request?: Request,
): Promise<string> {
  // Initialize cache cleanup on first use
  initializeCacheCleanup();

  const cacheKey = getCacheKey(bucket, key, expiresIn);
  const now = Date.now();

  // Check if we have a cached URL that's still valid with 10% buffer
  const cached = urlCache.get(cacheKey);
  if (cached) {
    const bufferTime = (cached.expiresAt - cached.createdAt) * 0.1; // 10% of original expiry time
    const effectiveExpiry = cached.expiresAt - bufferTime;

    if (now < effectiveExpiry) {
      logger.debug(
        `Using cached presigned URL for ${key} (expires in ${Math.round((cached.expiresAt - now) / 1000)}s)`,
      );
      return cached.url;
    } else {
      // Remove expired URL from cache
      urlCache.delete(cacheKey);
    }
  }

  const client = S3Manager.getInstance().getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    logger.s3Connection(
      `Generating new signed download URL for ${key} (expires in ${expiresIn}s)`,
    );

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(client, command, { expiresIn });

    // Cache the new URL
    const expiresAt = now + expiresIn * 1000;
    urlCache.set(cacheKey, {
      url: signedUrl,
      expiresAt,
      createdAt: now,
    });

    // Audit logging
    await auditMiddleware.log({
      operation: "GeneratePresignedUrl",
      method: "GET",
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: signedUrl.length, // Size of the generated URL
      request,
    });

    logger.debug(
      `Successfully generated and cached signed download URL for ${key} (${signedUrl.length} chars)`,
    );

    return signedUrl;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: "GeneratePresignedUrl",
      method: "GET",
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request,
    });

    logger.s3Error("Failed to generate signed download URL", error as Error, {
      bucket,
      key,
      expiresIn,
      operation: "getSignedDownloadUrl",
    });
    throw error;
  }
}

export async function getObjectStream(
  bucket: string,
  key: string,
  request?: Request,
) {
  const client = S3Manager.getInstance().getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    logger.debug(`[S3] Getting stream for ${key}`);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    // Audit logging
    await auditMiddleware.log({
      operation: "GetObject",
      method: "GET",
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: response.ContentLength,
      request,
    });

    logger.debug(
      `Successfully retrieved stream for ${key} (${response.ContentType}, ${response.ContentLength} bytes)`,
    );

    return response.Body;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: "GetObject",
      method: "GET",
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request,
    });

    logger.s3Error("Failed to get object stream", error as Error, {
      bucket,
      key,
      operation: "getObjectStream",
    });
    throw error;
  }
}

export interface PutObjectOptions {
  contentType?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  request?: Request;
}

export async function putObject(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  options: PutObjectOptions = {},
): Promise<void> {
  const client = S3Manager.getInstance().getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  const bytesTransferred = Buffer.isBuffer(body)
    ? body.length
    : typeof body === "string"
      ? Buffer.byteLength(body)
      : body.byteLength;

  try {
    logger.s3Connection(
      `Uploading object to ${bucket}/${key} (${bytesTransferred} bytes)`,
    );

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      Metadata: options.metadata,
    });

    await client.send(command);

    await auditMiddleware.log({
      operation: "PutObject",
      method: "PUT",
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred,
      request: options.request,
    });

    logger.debug(
      `Successfully uploaded object ${key} (${bytesTransferred} bytes)`,
    );
  } catch (error) {
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    await auditMiddleware.log({
      operation: "PutObject",
      method: "PUT",
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request: options.request,
    });

    logger.s3Error("Failed to upload object", error as Error, {
      bucket,
      key,
      operation: "putObject",
    });
    throw error;
  }
}

export async function deleteObject(
  bucket: string,
  key: string,
  request?: Request,
): Promise<void> {
  const client = S3Manager.getInstance().getS3Client();
  const startTime = Date.now();
  let statusCode = 204;
  let errorMessage: string | undefined;

  try {
    logger.s3Connection(`Deleting object ${bucket}/${key}`);

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);

    await auditMiddleware.log({
      operation: "DeleteObject",
      method: "DELETE",
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: 0,
      request,
    });

    logger.debug(`Deleted object ${key} from bucket ${bucket}`);
  } catch (error) {
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (typeof error === "object" && error !== null) {
      if (
        "$metadata" in error &&
        typeof (error as any).$metadata === "object"
      ) {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    await auditMiddleware.log({
      operation: "DeleteObject",
      method: "DELETE",
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request,
    });

    logger.s3Error("Failed to delete object", error as Error, {
      bucket,
      key,
      operation: "deleteObject",
    });
    throw error;
  }
}

// Centralized image format definitions
const IMAGE_FORMATS: Record<string, string> = {
  // Standard image formats
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".svg": "image/svg+xml",
  // RAW camera formats
  ".nef": "image/x-nikon-nef", // Nikon
  ".cr2": "image/x-canon-cr2", // Canon
  ".cr3": "image/x-canon-cr3", // Canon (newer)
  ".arw": "image/x-sony-arw", // Sony
  ".dng": "image/x-adobe-dng", // Adobe Digital Negative
  ".raf": "image/x-fuji-raf", // Fujifilm
  ".orf": "image/x-olympus-orf", // Olympus
  ".rw2": "image/x-panasonic-rw2", // Panasonic
  ".pef": "image/x-pentax-pef", // Pentax
  ".srw": "image/x-samsung-srw", // Samsung
  ".x3f": "image/x-sigma-x3f", // Sigma
  // Modern formats
  ".heic": "image/heic", // Apple
  ".heif": "image/heif", // High Efficiency Image Format
  ".avif": "image/avif", // AV1 Image File Format
};

// Video format definitions
const VIDEO_FORMATS: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".flv": "video/x-flv",
  ".ogv": "video/ogg",
  ".3gp": "video/3gpp",
  ".3g2": "video/3gpp2",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ts": "video/mp2t",
};

// Combined media formats
const MEDIA_FORMATS: Record<string, string> = {
  ...IMAGE_FORMATS,
  ...VIDEO_FORMATS,
};

export function isImageFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return ext in IMAGE_FORMATS;
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return ext in VIDEO_FORMATS;
}

export function isMediaFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return ext in MEDIA_FORMATS;
}

export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return MEDIA_FORMATS[ext] || "application/octet-stream";
}

export function getFolderFromKey(key: string): string {
  const lastSlashIndex = key.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return "";
  }
  return key.substring(0, lastSlashIndex);
}

export function getFilenameFromKey(key: string): string {
  const lastSlashIndex = key.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return key;
  }
  return key.substring(lastSlashIndex + 1);
}

// Auto-initializing wrapper functions that don't require manual config

/**
 * Get object stream with auto-initialization
 * No need to manually initialize S3 client or fetch config
 */
export async function getObjectStreamAuto(key: string, request?: Request) {
  const bucket = S3Manager.getInstance().getBucketName();
  return getObjectStream(bucket, key, request);
}

/**
 * List objects with auto-initialization
 * No need to manually initialize S3 client or fetch config
 */
export async function listObjectsAuto(
  prefix?: string,
  continuationToken?: string,
  maxKeys: number = 1000,
  pageNumber: number = 1,
  request?: Request,
) {
  const bucket = S3Manager.getInstance().getBucketName();
  return listObjects(
    bucket,
    prefix,
    continuationToken,
    maxKeys,
    pageNumber,
    request,
  );
}

/**
 * Get signed download URL with auto-initialization
 * No need to manually initialize S3 client or fetch config
 */
export async function getSignedDownloadUrlAuto(
  key: string,
  expiresIn: number = 3600,
  request?: Request,
): Promise<string> {
  const bucket = S3Manager.getInstance().getBucketName();
  return getSignedDownloadUrl(bucket, key, expiresIn, request);
}

/**
 * Test S3 connection with specific configuration
 * Used for testing new configurations before saving
 */
export async function testS3ConnectionWith(
  config: S3Config,
  request?: Request,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create a temporary S3Manager instance for testing
    const testManager = new S3Manager();
    const client = testManager.initializeClient(config);

    // Test with a simple list operation (1 item max)
    const command = new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: "",
      MaxKeys: 1,
    });

    await client.send(command);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
