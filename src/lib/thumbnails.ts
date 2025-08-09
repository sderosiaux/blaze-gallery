import sharp from "sharp";
import path from "path";
import fs from "fs";
import { getObjectStream } from "./s3";
import { updatePhotoThumbnail } from "./database";
import { getConfig } from "./config";
import { logger } from "./logger";
import { ThumbnailOptions, ThumbnailStats } from "@/types/common";

export function getThumbnailsPath(customPath?: string): string {
  return customPath ||
         process.env.THUMBNAILS_PATH ||
         path.join(process.cwd(), "data", "thumbnails");
}

export function getDatabasePath(customPath?: string): string {
  return customPath ||
         process.env.DATABASE_PATH ||
         path.join(process.cwd(), "data", "database", "gallery.db");
}

const DEFAULT_THUMBNAIL_OPTIONS: Required<ThumbnailOptions> = {
  width: 400,
  height: 400,
  quality: 80,
  format: "jpeg",
};

export class ThumbnailService {
  private thumbnailsDir: string;

  constructor(thumbnailsDir?: string) {
    this.thumbnailsDir = getThumbnailsPath(thumbnailsDir);
    this.ensureThumbnailsDirectory();
  }

  private ensureThumbnailsDirectory() {
    if (!fs.existsSync(this.thumbnailsDir)) {
      fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    }
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
    const thumbnailPath = this.getThumbnailPath(photoId, opts.format);

    if (fs.existsSync(thumbnailPath)) {
      await updatePhotoThumbnail(photoId, thumbnailPath);
      return thumbnailPath;
    }

    // Check size threshold unless bypassed
    if (!bypassSizeCheck) {
      const { getConfig } = await import("./config");
      const { getPhoto } = await import("./database");

      const config = await getConfig();
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

          // Update status to indicate it was skipped due to size
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
      const filename = s3Key.split('/').pop() || s3Key;
      logger.debug(`[THUMBNAIL] Generating thumbnail for ${filename} (ID: ${photoId})`);

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

      await sharp(inputBuffer)
        .resize(opts.width, opts.height, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: opts.quality })
        .toFile(thumbnailPath);

      await updatePhotoThumbnail(photoId, thumbnailPath);

      logger.debug(`[THUMBNAIL] Generated thumbnail for ${filename} (ID: ${photoId})`);

      return thumbnailPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check for unsupported format errors
      if (errorMessage.includes('Input file contains unsupported image format') || 
          errorMessage.includes('unsupported image format') ||
          errorMessage.includes('Input buffer contains unsupported image format')) {
        
        const fileExt = s3Key.toLowerCase().split('.').pop() || 'unknown';
        
        logger.thumbnailOperation(
          `Thumbnail generation skipped - unsupported format: ${fileExt}`,
          {
            photoId,
            s3Key,
          },
        );

        // Update status to indicate it was skipped due to unsupported format
        const { updatePhotoStatus } = await import("./database");
        await updatePhotoStatus(photoId, {
          thumbnail_status: "skipped_size",
        });

        throw new Error(`Unsupported image format: ${fileExt.toUpperCase()} files are not supported by Sharp for thumbnail generation`);
      }

      // Log other errors as before
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

  async getThumbnailBuffer(thumbnailPath: string): Promise<Buffer | null> {
    try {
      if (!fs.existsSync(thumbnailPath)) {
        return null;
      }

      return fs.readFileSync(thumbnailPath);
    } catch (error) {
      logger.thumbnailError("Error reading thumbnail file", error as Error, {
        thumbnailPath,
      });
      return null;
    }
  }

  getThumbnailPath(photoId: number, format: string = "jpeg"): string {
    return path.join(this.thumbnailsDir, `${photoId}.${format}`);
  }

  async deleteThumbnail(thumbnailPath: string): Promise<void> {
    try {
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
    const { getPhoto } = await import("./database");
    const config = await getConfig();

    const fs = require("fs");
    const path = require("path");

    try {
      logger.thumbnailOperation("Checking for photos without thumbnails");

      const Database = require("better-sqlite3");
      const dbPath = getDatabasePath();
      const db = new Database(dbPath);

      const photosWithoutThumbnails = db
        .prepare(
          `
        SELECT id, s3_key FROM photos 
        WHERE thumbnail_path IS NULL OR thumbnail_path = ''
        ORDER BY id
      `,
        )
        .all();

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

      db.close();
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

  getThumbnailStats(): ThumbnailStats {
    try {
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
}

export const thumbnailService = new ThumbnailService();
