import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./logger";
import { createS3AuditMiddleware } from "./s3Audit";
import crypto from "crypto";

// Initialize audit middleware
const auditMiddleware = createS3AuditMiddleware();

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

class S3Manager {
  private static instance: S3Manager;
  private s3Client: S3Client | null = null;
  private currentConfigHash: string | null = null;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): S3Manager {
    if (!S3Manager.instance) {
      S3Manager.instance = new S3Manager();
    }
    return S3Manager.instance;
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

export function getS3Client(): S3Client {
  return S3Manager.getInstance().getClient();
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

    // Calculate actual response size
    const responseSize = JSON.stringify(objects).length + 
                        JSON.stringify({
                          nextContinuationToken: response.NextContinuationToken,
                          isTruncated: response.IsTruncated
                        }).length;
    
    await auditMiddleware.log({
      operation: 'ListObjects',
      method: 'GET',
      bucket,
      key: prefix,
      startTime,
      statusCode,
      bytesTransferred: responseSize,
      request
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
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (typeof error === 'object' && error !== null) {
      if ('$metadata' in error && typeof (error as any).$metadata === 'object') {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }
    
    // Audit logging for error
    await auditMiddleware.log({
      operation: 'ListObjects',
      method: 'GET',
      bucket,
      key: prefix,
      startTime,
      statusCode,
      error: errorMessage,
      request
    });

    logger.s3Error(
      `Failed to list objects from ${folderDesc} after ${duration}ms`,
      error as Error,
    );
    throw error;
  }
}

export async function getObjectMetadata(bucket: string, key: string, request?: Request) {
  const client = getS3Client();
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
      operation: 'HeadObject',
      method: 'HEAD',
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: 0, // HEAD requests don't transfer body data
      request
    });

    logger.debug(
      `Successfully retrieved metadata for ${key} (${result.ContentLength} bytes)`,
    );

    return result;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (typeof error === 'object' && error !== null) {
      if ('$metadata' in error && typeof (error as any).$metadata === 'object') {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: 'HeadObject',
      method: 'HEAD',
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request
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
  const client = getS3Client();
  const startTime = Date.now();
  let statusCode = 200;
  let errorMessage: string | undefined;

  try {
    logger.s3Connection(
      `Generating signed download URL for ${key} (expires in ${expiresIn}s)`,
    );

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const signedUrl = await getSignedUrl(client, command, { expiresIn });

    // Audit logging
    await auditMiddleware.log({
      operation: 'GeneratePresignedUrl',
      method: 'GET',
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: signedUrl.length, // Size of the generated URL
      request
    });

    logger.debug(
      `Successfully generated signed download URL for ${key} (${signedUrl.length} chars)`,
    );

    return signedUrl;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (typeof error === 'object' && error !== null) {
      if ('$metadata' in error && typeof (error as any).$metadata === 'object') {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: 'GeneratePresignedUrl',
      method: 'GET',
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request
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

export async function getObjectStream(bucket: string, key: string, request?: Request) {
  const client = getS3Client();
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
      operation: 'GetObject',
      method: 'GET',
      bucket,
      key,
      startTime,
      statusCode,
      bytesTransferred: response.ContentLength,
      request
    });

    logger.debug(
      `Successfully retrieved stream for ${key} (${response.ContentType}, ${response.ContentLength} bytes)`,
    );

    return response.Body;
  } catch (error) {
    // Extract status code from error
    statusCode = 500;
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (typeof error === 'object' && error !== null) {
      if ('$metadata' in error && typeof (error as any).$metadata === 'object') {
        const httpStatusCode = (error as any).$metadata?.httpStatusCode;
        if (httpStatusCode) {
          statusCode = httpStatusCode;
        }
      }
    }

    // Audit logging for error
    await auditMiddleware.log({
      operation: 'GetObject',
      method: 'GET',
      bucket,
      key,
      startTime,
      statusCode,
      error: errorMessage,
      request
    });

    logger.s3Error("Failed to get object stream", error as Error, {
      bucket,
      key,
      operation: "getObjectStream",
    });
    throw error;
  }
}

export function isImageFile(filename: string): boolean {
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".tiff",
    ".svg",
  ];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return imageExtensions.includes(ext);
}

export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".svg": "image/svg+xml",
  };

  return mimeTypes[ext] || "application/octet-stream";
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
