import sharp from "sharp";
import path from "path";
import fs from "fs";
import {
  deleteObject,
  getObjectMetadata,
  getObjectStream,
  listObjects,
  putObject,
  getThumbnailS3Client,
  getThumbnailBucketName,
  S3Object,
} from "./s3";
import {
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { updatePhotoThumbnail } from "./database";
import { getConfig } from "./config";
import { logger } from "./logger";
import { ThumbnailOptions, ThumbnailStats } from "@/types/common";

export function getThumbnailsPath(customPath?: string): string {
  return (
    customPath ||
    process.env.THUMBNAILS_PATH ||
    path.join(process.cwd(), "data", "thumbnails")
  );
}

export interface ThumbnailStorageInfo {
  mode: "local" | "s3";
  location: string;
  prefix?: string;
  bucket?: string;
}

export function normalizeThumbnailS3Prefix(prefix?: string): string {
  const fallback = "thumbnails";
  if (!prefix) {
    return fallback;
  }

  const trimmed = prefix.trim();
  if (!trimmed) {
    return fallback;
  }

  const sanitized = trimmed.replace(/^\/+/g, "").replace(/\/+$/g, "");
  return sanitized || fallback;
}

export function getThumbnailStorageInfo(): ThumbnailStorageInfo {
  const config = getConfig();

  if (config.thumbnail_storage === "s3") {
    const prefix = normalizeThumbnailS3Prefix(config.thumbnail_s3_prefix);
    const bucket = getThumbnailBucketName();
    return {
      mode: "s3",
      location: `s3://${bucket}/${prefix}`,
      prefix,
      bucket,
    };
  }

  const localPath = getThumbnailsPath();
  return { mode: "local", location: localPath };
}

export function getDatabasePath(customPath?: string): string {
  return (
    customPath ||
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data", "database", "gallery.db")
  );
}

const DEFAULT_THUMBNAIL_OPTIONS: Required<ThumbnailOptions> = {
  width: 400,
  height: 400,
  quality: 80,
  format: "jpeg",
};

export class ThumbnailService {
  private thumbnailsDir: string;
  private storageMode: "local" | "s3";
  private s3Prefix: string;
  private s3ListPrefix: string;
  private bucket: string;

  constructor(thumbnailsDir?: string) {
    const config = getConfig();
    this.storageMode = config.thumbnail_storage;
    this.bucket = getThumbnailBucketName();
    this.s3Prefix = normalizeThumbnailS3Prefix(config.thumbnail_s3_prefix);
    this.s3ListPrefix = this.s3Prefix ? `${this.s3Prefix}/` : "";
    this.thumbnailsDir = thumbnailsDir || getThumbnailsPath();

    this.ensureThumbnailsDirectory();
  }

  /**
   * Get the S3 client for thumbnail operations
   * Uses separate credentials if configured
   */
  private getS3Client() {
    return getThumbnailS3Client();
  }

  private ensureThumbnailsDirectory() {
    if (this.storageMode !== "local") {
      return;
    }

    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }
  }

  private isS3Storage(): boolean {
    return this.storageMode === "s3";
  }

  private getS3ThumbnailKey(
    photoId: number,
    format: string,
    originalKey: string,
  ): string {
    const normalizedOriginal = originalKey.replace(/^\/+/, "");
    const dir = path.posix.dirname(normalizedOriginal);
    const baseName = path.posix.basename(
      normalizedOriginal,
      path.posix.extname(normalizedOriginal),
    );
    const fileName = `${baseName}-${photoId}.${format}`;

    const segments = [] as string[];
    if (this.s3Prefix) {
      segments.push(this.s3Prefix);
    }
    if (dir && dir !== ".") {
      segments.push(dir);
    }
    segments.push(fileName);

    return path.posix.join(...segments.filter(Boolean));
  }

  private isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const metadata = (error as any).$metadata;
    if (metadata?.httpStatusCode === 404) {
      return true;
    }

    const name = (error as any).name;
    const code = (error as any).Code || (error as any).code;
    return name === "NotFound" || code === "NotFound";
  }

  private async doesThumbnailExist(location: string): Promise<boolean> {
    if (!this.isS3Storage()) {
      return fs.existsSync(location);
    }

    try {
      const client = this.getS3Client();
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: location,
      });
      await client.send(command);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async writeThumbnail(
    thumbnailPath: string,
    buffer: Buffer,
  ): Promise<void> {
    if (!this.isS3Storage()) {
      await fs.promises.writeFile(thumbnailPath, buffer);
      return;
    }

    const client = this.getS3Client();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: thumbnailPath,
      Body: buffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    });
    await client.send(command);
    logger.debug(`Uploaded thumbnail to ${this.bucket}/${thumbnailPath}`);
  }

  private async listAllThumbnails(): Promise<S3Object[]> {
    if (!this.isS3Storage()) {
      return [];
    }

    const client = this.getS3Client();
    const allObjects: S3Object[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.s3ListPrefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response = await client.send(command);

      const objects: S3Object[] = (response.Contents || []).map((obj) => ({
        key: obj.Key!,
        lastModified: obj.LastModified!,
        size: obj.Size!,
        etag: obj.ETag!.replace(/"/g, ""),
      }));

      allObjects.push(...objects);
      continuationToken = response.NextContinuationToken;

      if (!response.IsTruncated) {
        break;
      }
    } while (continuationToken);

    return allObjects;
  }

  async generateThumbnail(
    bucket: string,
    s3Key: string,
    photoId: number,
    options: ThumbnailOptions = {},
    bypassSizeCheck: boolean = false,
    request?: Request,
  ): Promise<string> {
    const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };
    const thumbnailPath = this.getThumbnailPath(photoId, opts.format, s3Key);

    try {
      if (await this.doesThumbnailExist(thumbnailPath)) {
        await updatePhotoThumbnail(photoId, thumbnailPath);
        return thumbnailPath;
      }
    } catch (error) {
      logger.thumbnailError(
        "Failed to check existing thumbnail",
        error as Error,
        {
          photoId,
          thumbnailPath,
        },
      );
      // Continue with generation attempt after logging
    }

    // Check size threshold unless bypassed
    if (!bypassSizeCheck) {
      const { getPhoto } = await import("./database");

      const config = getConfig();
      const photo = await getPhoto(photoId);

      if (photo) {
        const sizeMB = photo.size / (1024 * 1024);
        if (sizeMB > config.auto_thumbnail_threshold_mb) {
          logger.thumbnailOperation(
            "Thumbnail generation skipped due to size threshold",
            {
              photoId,
              sizeMB,
              thresholdMB: config.auto_thumbnail_threshold_mb,
              s3Key,
            },
          );

          const { updatePhotoStatus } = await import("./database");
          await updatePhotoStatus(photoId, {
            thumbnail_status: "skipped_size",
          });

          throw new Error(
            `Photo too large for automatic thumbnail generation (${sizeMB.toFixed(1)}MB > ${config.auto_thumbnail_threshold_mb}MB)`,
          );
        }
      }
    }

    try {
      const filename = s3Key.split("/").pop() || s3Key;
      logger.debug(
        `[THUMBNAIL] Generating thumbnail for ${filename} (ID: ${photoId})`,
      );

      const stream = await getObjectStream(bucket, s3Key, request);
      if (!stream) {
        throw new Error("Failed to get object stream from S3");
      }

      const chunks: Buffer[] = [];

      await new Promise<void>((resolve, reject) => {
        if (stream && typeof stream === "object" && "on" in stream) {
          (stream as any).on("data", (chunk: Buffer) => {
            chunks.push(Buffer.from(chunk));
          });
          (stream as any).on("end", () => {
            resolve();
          });
          (stream as any).on("error", (error: Error) => {
            reject(error);
          });
        } else {
          reject(new Error("Invalid stream type from S3"));
        }
      });

      const inputBuffer = Buffer.concat(chunks);

      const thumbnailBuffer = await sharp(inputBuffer)
        .resize(opts.width, opts.height, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: opts.quality })
        .toBuffer();

      await this.writeThumbnail(thumbnailPath, thumbnailBuffer);
      await updatePhotoThumbnail(photoId, thumbnailPath);

      logger.debug(
        `[THUMBNAIL] Generated thumbnail for ${filename} (ID: ${photoId})`,
      );

      return thumbnailPath;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (
        errorMessage.includes("VipsJpeg: Invalid SOS parameters") ||
        errorMessage.includes("Invalid SOS parameters for sequential JPEG") ||
        errorMessage.includes("VipsJpeg:") ||
        errorMessage.includes("premature end of JPEG file") ||
        errorMessage.includes("JPEG datastream contains no image")
      ) {
        logger.thumbnailOperation(
          `Thumbnail generation skipped - corrupted JPEG file`,
          {
            photoId,
            s3Key,
          },
        );

        const { updatePhotoStatus } = await import("./database");
        await updatePhotoStatus(photoId, {
          thumbnail_status: "skipped_corrupted",
        });

        logger.debug(`[THUMBNAIL] Skipping corrupted JPEG: ${s3Key}`);
        return "";
      }

      if (
        errorMessage.includes("Input file contains unsupported image format") ||
        errorMessage.includes("unsupported image format") ||
        errorMessage.includes("Input buffer contains unsupported image format")
      ) {
        const fileExt = s3Key.toLowerCase().split(".").pop() || "unknown";

        logger.thumbnailOperation(
          `Thumbnail generation skipped - unsupported format: ${fileExt}`,
          {
            photoId,
            s3Key,
          },
        );

        const { updatePhotoStatus } = await import("./database");
        await updatePhotoStatus(photoId, {
          thumbnail_status: "skipped_unsupported",
        });

        throw new Error(
          `Unsupported image format: ${fileExt.toUpperCase()} files are not supported by Sharp for thumbnail generation`,
        );
      }

      logger.thumbnailError(
        "Error generating thumbnail for photo",
        error as Error,
        {
          photoId,
          s3Key,
        },
      );
      throw error;
    }
  }

  async getThumbnailBuffer(
    thumbnailPath: string,
    request?: Request,
  ): Promise<Buffer | null> {
    try {
      if (!this.isS3Storage()) {
        if (!fs.existsSync(thumbnailPath)) {
          return null;
        }

        return fs.readFileSync(thumbnailPath);
      }

      const client = this.getS3Client();
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: thumbnailPath,
      });

      const response = await client.send(command);
      const stream = response.Body;

      if (!stream) {
        return null;
      }

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        if (stream && typeof stream === "object" && "on" in stream) {
          (stream as any).on("data", (chunk: Buffer) => {
            chunks.push(Buffer.from(chunk));
          });
          (stream as any).on("end", () => resolve());
          (stream as any).on("error", (error: Error) => reject(error));
        } else {
          reject(new Error("Invalid stream type from S3"));
        }
      });

      return Buffer.concat(chunks);
    } catch (error) {
      logger.thumbnailError("Error reading thumbnail file", error as Error, {
        thumbnailPath,
      });
      return null;
    }
  }

  getThumbnailPath(
    photoId: number,
    format: string = "jpeg",
    originalKey?: string,
  ): string {
    if (this.isS3Storage()) {
      if (!originalKey) {
        throw new Error("Original S3 key is required for S3 thumbnail storage");
      }
      return this.getS3ThumbnailKey(photoId, format, originalKey);
    }

    return path.join(this.thumbnailsDir, `${photoId}.${format}`);
  }

  async deleteThumbnail(thumbnailPath: string): Promise<void> {
    try {
      if (!thumbnailPath) {
        return;
      }

      if (this.isS3Storage()) {
        const client = this.getS3Client();
        const command = new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: thumbnailPath,
        });
        await client.send(command);
        logger.thumbnailOperation("Deleted thumbnail object from S3", {
          thumbnailPath,
        });
        return;
      }

      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
        logger.thumbnailOperation("Deleted thumbnail file");
      }
    } catch (error) {
      logger.thumbnailError("Error deleting thumbnail file", error as Error, {
        thumbnailPath,
      });
    }
  }

  async generateMissingThumbnails(): Promise<void> {
    const { query } = await import("./database");
    const config = getConfig();

    try {
      logger.thumbnailOperation("Checking for photos without thumbnails");

      const result = await query(`
        SELECT id, s3_key FROM photos
        WHERE thumbnail_path IS NULL OR thumbnail_path = ''
        ORDER BY id
      `);

      const photosWithoutThumbnails = result.rows;

      logger.thumbnailOperation("Found photos without thumbnails", {
        count: photosWithoutThumbnails.length,
      });

      for (const photo of photosWithoutThumbnails) {
        try {
          await this.generateThumbnail(
            config.backblaze_bucket,
            photo.s3_key,
            photo.id,
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          logger.thumbnailError(
            "Failed to generate thumbnail for photo",
            error as Error,
            {
              photoId: photo.id,
              s3Key: photo.s3_key,
            },
          );
        }
      }
    } catch (error) {
      logger.thumbnailError(
        "Error in generateMissingThumbnails operation",
        error as Error,
      );
    }
  }

  async cleanupOldThumbnails(maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    let deletedCount = 0;

    try {
      if (this.isS3Storage()) {
        const client = this.getS3Client();
        const thumbnails = await this.listAllThumbnails();

        for (const obj of thumbnails) {
          if (obj.lastModified < cutoffDate) {
            const command = new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: obj.key,
            });
            await client.send(command);
            deletedCount++;

            if (deletedCount % 100 === 0) {
              logger.thumbnailOperation("Cleanup progress update", {
                deletedCount,
                maxAgeDays,
              });
            }
          }
        }
      } else {
        const files = fs.readdirSync(this.thumbnailsDir);

        for (const file of files) {
          const filePath = path.join(this.thumbnailsDir, file);
          const stats = fs.statSync(filePath);

          if (stats.mtime < cutoffDate) {
            fs.unlinkSync(filePath);
            deletedCount++;

            if (deletedCount % 100 === 0) {
              logger.thumbnailOperation("Cleanup progress update", {
                deletedCount,
                maxAgeDays,
              });
            }
          }
        }
      }

      logger.thumbnailOperation("Cleanup completed", {
        deletedCount,
        maxAgeDays,
      });
    } catch (error) {
      logger.thumbnailError("Error during thumbnail cleanup", error as Error, {
        maxAgeDays,
      });
    }

    return deletedCount;
  }

  async getThumbnailStats(): Promise<ThumbnailStats> {
    try {
      if (this.isS3Storage()) {
        const objects = await this.listAllThumbnails();
        let totalSize = 0;
        let oldestDate: Date | undefined;
        let newestDate: Date | undefined;

        for (const obj of objects) {
          totalSize += obj.size;

          if (!oldestDate || obj.lastModified < oldestDate) {
            oldestDate = obj.lastModified;
          }

          if (!newestDate || obj.lastModified > newestDate) {
            newestDate = obj.lastModified;
          }
        }

        return {
          totalThumbnails: objects.length,
          totalSize,
          oldestThumbnail: oldestDate,
          newestThumbnail: newestDate,
        };
      }

      const files = fs.readdirSync(this.thumbnailsDir);
      let totalSize = 0;
      let oldestDate: Date | undefined;
      let newestDate: Date | undefined;

      for (const file of files) {
        const filePath = path.join(this.thumbnailsDir, file);
        const stats = fs.statSync(filePath);

        totalSize += stats.size;

        if (!oldestDate || stats.mtime < oldestDate) {
          oldestDate = stats.mtime;
        }

        if (!newestDate || stats.mtime > newestDate) {
          newestDate = stats.mtime;
        }
      }

      return {
        totalThumbnails: files.length,
        totalSize,
        oldestThumbnail: oldestDate,
        newestThumbnail: newestDate,
      };
    } catch (error) {
      logger.thumbnailError("Error getting thumbnail stats", error as Error);
      return {
        totalThumbnails: 0,
        totalSize: 0,
      };
    }
  }

  async serveThumbnail(
    photo: any,
    request?: Request,
    forceGenerate: boolean = false,
  ): Promise<
    | { buffer: Buffer; headers: Record<string, string> }
    | { error: string; status: number }
  > {
    const config = getConfig();

    if (photo.thumbnail_path) {
      const thumbnailBuffer = await this.getThumbnailBuffer(
        photo.thumbnail_path,
        request,
      );
      if (thumbnailBuffer) {
        return {
          buffer: thumbnailBuffer,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": thumbnailBuffer.length.toString(),
          },
        };
      }
    }

    let thumbnailPath;
    try {
      thumbnailPath = await this.generateThumbnail(
        config.backblaze_bucket,
        photo.s3_key,
        photo.id,
        {},
        forceGenerate,
        request,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Unsupported image format")
      ) {
        logger.thumbnailOperation(
          `Thumbnail request for unsupported format: ${
            photo.s3_key.toLowerCase().split(".").pop() || "unknown"
          }`,
          {
            photoId: photo.id,
            s3Key: photo.s3_key,
          },
        );
        return { error: "Unsupported image format", status: 415 };
      }

      if (error instanceof Error && error.message.includes("Photo too large")) {
        const sizeMB = photo.size / (1024 * 1024);
        logger.thumbnailOperation(
          `Thumbnail request for large photo (${sizeMB.toFixed(1)}MB) - not generating`,
          {
            photoId: photo.id,
            sizeMB,
            s3Key: photo.s3_key,
          },
        );

        if (forceGenerate) {
          return {
            error: `This photo is ${sizeMB.toFixed(1)}MB, which exceeds the ${config.auto_thumbnail_threshold_mb}MB threshold. Add ?force=true to generate anyway.`,
            status: 413,
          };
        } else {
          return {
            error: "Photo too large for thumbnail generation",
            status: 413,
          };
        }
      }

      throw error;
    }

    const thumbnailBuffer = await this.getThumbnailBuffer(
      thumbnailPath,
      request,
    );
    if (!thumbnailBuffer) {
      return { error: "Failed to generate thumbnail", status: 500 };
    }

    return {
      buffer: thumbnailBuffer,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": thumbnailBuffer.length.toString(),
      },
    };
  }
}

export const thumbnailService = new ThumbnailService();
