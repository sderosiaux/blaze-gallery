import type { S3Object } from "./s3";
import {
  listObjectsAuto,
  isMediaFile,
  getMimeType,
  getFolderFromKey,
  getFilenameFromKey,
} from "./s3";
import {
  createSyncJob,
  updateSyncJob,
  getActiveSyncJobs,
  createOrUpdateFolder,
  createOrUpdatePhoto,
  getFolderByPath,
  updateFolderCounts,
  updatePhotoStatus,
  updatePhotoMetadata,
  bulkCreateOrUpdatePhotos,
  bulkUpdateFolderCounts,
  bulkUpdateFoldersLastSynced,
  updateFolderLastSynced,
  query,
} from "./database";
import type { SyncJob } from "./database";
import { getConfig } from "./config";
import { logger } from "./logger";
import type { PhotoMetadata, Photo, Folder } from "@/types";
import type { MetadataStatus, ThumbnailStatus } from "@/types/common";

type ListPage = Awaited<ReturnType<typeof listObjectsAuto>>;

/** DB columns can hold NULL even where the row type says otherwise */
function isUnset(value: string | null | undefined): value is null | undefined {
  return value === undefined || value === null;
}

function orZero(value: number | null | undefined): number {
  return value ?? 0;
}

function nonZero(value: number | undefined): number | undefined {
  return value === 0 ? undefined : value;
}

/**
 * Progress tracking for sync operations
 */
interface SyncProgress {
  total: number;
  processed: number;
  images: number;
  skipped: number;
  currentPage: number;
}

/**
 * Pagination state for S3 listing operations
 */
interface PaginationState {
  continuationToken?: string;
  hasMorePages: boolean;
  currentObjects: S3Object[];
}

/**
 * Helper to update sync job progress and optionally log
 */
async function updateJobProgress(
  jobId: number,
  processed: number,
  total?: number,
  logOptions?: {
    message: string;
    folderPath?: string;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const update: { processed_items: number; total_items?: number } = {
    processed_items: processed,
  };
  if (total !== undefined) {
    update.total_items = total;
  }
  await updateSyncJob(jobId, update);

  if (logOptions) {
    logger.syncOperation(logOptions.message, {
      jobId,
      ...(logOptions.folderPath && { folderPath: logOptions.folderPath }),
      progress: { processed, total: total ?? 0 },
      ...(logOptions.extra ?? {}),
    });
  }
}

/**
 * Photo data prepared for batch insertion
 */
interface PhotoBatchItem {
  folder_id: number;
  filename: string;
  s3_key: string;
  size: number;
  mime_type: string;
  modified_at: string;
  metadata_status: MetadataStatus;
  thumbnail_status: ThumbnailStatus;
}

/**
 * Flush a batch of photos to the database and update progress
 */
async function flushPhotoBatch(
  photosToCreate: PhotoBatchItem[],
  jobId: number,
  progress: SyncProgress,
): Promise<void> {
  if (photosToCreate.length === 0) return;

  await bulkCreateOrUpdatePhotos(photosToCreate);

  await updateSyncJob(jobId, {
    processed_items: progress.processed,
  });

  if (process.env.LOG_LEVEL === "DEBUG") {
    logger.syncOperation("Full scan progress update (batch processed)", {
      jobId,
      progress: {
        processed: progress.processed,
        total: progress.total,
      },
      percentComplete: Math.round((progress.processed / progress.total) * 100),
    });
  }
}

/**
 * Context for processing scan objects
 */
interface ScanContext {
  jobId: number;
  folderMap: Map<string, number>;
  seenFolders: Set<string>;
  config: ReturnType<typeof getConfig>;
  ensureRootFolder: () => Promise<number>;
  ensureFolderExists: (
    folderPath: string,
    seenFolders: Set<string>,
    folderMap: Map<string, number>,
  ) => Promise<number>;
}

/**
 * Process a single S3 object during full scan
 * Returns photo data if it's a media file, null otherwise
 */
async function processScanObject(
  object: S3Object,
  ctx: ScanContext,
): Promise<PhotoBatchItem | null> {
  const folderPath = getFolderFromKey(object.key);

  // Ensure folder exists
  let folderId: number;
  if (folderPath === "") {
    folderId = await ctx.ensureRootFolder();
  } else {
    const cachedFolderId = ctx.folderMap.get(folderPath);
    if (cachedFolderId === undefined) {
      folderId = await ctx.ensureFolderExists(
        folderPath,
        ctx.seenFolders,
        ctx.folderMap,
      );
      ctx.folderMap.set(folderPath, folderId);
    } else {
      folderId = cachedFolderId;
    }
  }

  // Skip non-media files for photo processing, but folder was still created
  if (!isMediaFile(object.key)) {
    if (process.env.LOG_LEVEL === "DEBUG") {
      logger.syncOperation("Skipping non-media file, but folder was created", {
        jobId: ctx.jobId,
        s3Key: object.key,
        folderPath: folderPath || "(root)",
        fileSize: object.size,
      });
    }
    return null;
  }

  const filename = getFilenameFromKey(object.key);
  const sizeMB = object.size / (1024 * 1024);

  // Metadata has no size threshold: the head probe reads 64 KB whatever the file size
  const metadataStatus: MetadataStatus = "none";
  const thumbnailStatus: ThumbnailStatus =
    sizeMB > ctx.config.auto_thumbnail_threshold_mb ? "skipped_size" : "none";

  return {
    folder_id: folderId,
    filename: filename,
    s3_key: object.key,
    size: object.size,
    mime_type: getMimeType(filename),
    modified_at: object.lastModified.toISOString(),
    metadata_status: metadataStatus,
    thumbnail_status: thumbnailStatus,
  };
}

function logQueueFailure(error: unknown): void {
  logger.syncError(
    "Sync queue stopped unexpectedly",
    error instanceof Error ? error : new Error(String(error)),
  );
}

export class SyncService {
  private isRunning = false;
  private currentJob: SyncJob | null = null;
  private recentSyncRequests = new Map<string, number>();

  async start() {
    if (this.isRunning) {
      logger.syncOperation("Sync service already running");
      return;
    }

    this.isRunning = true;
    logger.syncOperation("Starting sync service");

    // Auto-create initial full sync job if no active jobs exist
    await this.ensureInitialSync();

    // Long-running loop that handles its own errors; the catch is a last resort
    this.processQueue().catch(logQueueFailure);
  }

  private async ensureInitialSync() {
    try {
      const activeJobs = await getActiveSyncJobs();

      // Check for existing pending/running jobs - don't cancel them, let them continue
      const existingFullScan = activeJobs.find(
        (job) =>
          job.type === "full_scan" &&
          (job.status === "pending" || job.status === "running"),
      );

      if (existingFullScan) {
        logger.syncOperation("Found existing full_scan job, resuming", {
          component: "SyncService",
          jobId: existingFullScan.id,
          progress: {
            processed: orZero(existingFullScan.processed_items),
            total: orZero(existingFullScan.total_items),
          },
        });
        return; // Don't create a new one, let existing job continue
      }

      // Check if we recently completed a full scan (within last hour)
      const recentCompleted = await query<SyncJob>(
        `
        SELECT * FROM sync_jobs
        WHERE type = 'full_scan' AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '1 hour'
        ORDER BY completed_at DESC LIMIT 1
      `,
        [],
      );

      const [lastCompleted] = recentCompleted.rows;
      if (lastCompleted !== undefined) {
        logger.syncOperation(
          "Full scan completed recently, skipping startup scan",
          {
            component: "SyncService",
            lastCompletedAt: lastCompleted.completed_at,
          },
        );
        return;
      }

      // No active or recent full scan - create a new one
      logger.syncOperation("Creating fresh full scan on startup", {
        component: "SyncService",
      });

      await createSyncJob({
        type: "full_scan",
        folder_path: "/",
      });

      logger.syncOperation("Created startup full scan job", {
        component: "SyncService",
      });
    } catch (error) {
      logger.syncError("Failed to ensure initial sync", error as Error, {
        component: "SyncService",
      });
    }
  }

  // Add method to sync a specific folder on-demand
  async syncFolder(folderPath: string): Promise<void> {
    try {
      const config = getConfig();
      const throttleMs = config.sync_throttle_seconds * 1000;

      // Check if we recently synced this folder (configurable threshold)
      const now = Date.now();
      const recentRequest = this.recentSyncRequests.get(folderPath);

      // First check in-memory recent requests
      if (recentRequest && now - recentRequest < throttleMs) {
        logger.debug("Skipping duplicate sync request - too recent", {
          component: "SyncService",
          folderPath,
          lastRequest: now - recentRequest,
          thresholdMs: throttleMs,
          thresholdSeconds: config.sync_throttle_seconds,
        });
        return;
      }

      // Also check database last_synced timestamp for folder
      try {
        const { getFolderByPath } = await import("@/lib/database");
        const folder = await getFolderByPath(folderPath);
        if (folder?.last_synced) {
          const lastSyncTime = new Date(folder.last_synced).getTime();
          if (now - lastSyncTime < throttleMs) {
            const secondsAgo = Math.round((now - lastSyncTime) / 1000);
            logger.debug(
              `Skipping sync of '${folderPath}' - last synced ${secondsAgo}s ago (throttle: ${config.sync_throttle_seconds}s)`,
            );
            return;
          }
        }
      } catch (error) {
        // If database check fails, continue with sync - don't block on this
        logger.debug(
          `Could not check last sync time for '${folderPath}', continuing anyway`,
        );
      }

      logger.syncOperation("Creating and waiting for folder sync", {
        component: "SyncService",
        folderPath,
      });

      const job = await createSyncJob({
        type: "folder_scan",
        folder_path: folderPath,
      });

      // Start the sync service if not running
      if (!this.isRunning) {
        // start() returns once the queue loop is launched; failures are logged
        this.start().catch(logQueueFailure);
      }

      // Wait for this specific job to complete
      await this.waitForJobCompletion(job.id);

      // Track this request
      this.recentSyncRequests.set(folderPath, now);

      // Clean up old entries (older than double the throttle threshold)
      const cleanupThresholdMs = throttleMs * 2;
      for (const [path, timestamp] of this.recentSyncRequests.entries()) {
        if (now - timestamp > cleanupThresholdMs) {
          this.recentSyncRequests.delete(path);
        }
      }

      logger.syncOperation("Folder sync completed", {
        component: "SyncService",
        folderPath,
        jobId: job.id,
      });
    } catch (error) {
      logger.syncError("Failed to sync folder", error as Error, {
        component: "SyncService",
        folderPath,
      });
      throw error;
    }
  }

  private async waitForJobCompletion(jobId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = async () => {
        try {
          const { getSyncJob } = await import("@/lib/database");
          const job = await getSyncJob(jobId);

          if (!job) {
            clearInterval(checkInterval);
            reject(new Error(`Job ${jobId} not found`));
            return;
          }

          if (job.status === "completed") {
            clearInterval(checkInterval);
            resolve();
          } else if (job.status === "failed") {
            clearInterval(checkInterval);
            reject(new Error(`Job ${jobId} failed: ${job.error_message}`));
          }
          // Continue waiting if status is 'pending' or 'running'
        } catch (error) {
          clearInterval(checkInterval);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const checkInterval = setInterval(() => {
        void check();
      }, 100); // Check every 100ms

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Job ${jobId} timeout after 30 seconds`));
      }, 30000);
    });
  }

  stop(): Promise<void> {
    this.isRunning = false;
    logger.syncOperation("Stopping sync service");
    return Promise.resolve();
  }

  private async processQueue() {
    logger.syncOperation("Sync queue processing started");

    while (this.isRunning) {
      try {
        const activeJobs = await getActiveSyncJobs();

        // Separate jobs by priority: folder_scan/metadata_scan > full_scan > cleanup
        const pendingJobs = activeJobs.filter(
          (job) => job.status === "pending",
        );
        const runningJob = activeJobs.find((job) => job.status === "running");

        // Sort pending jobs by priority (folder_scan first, then full_scan)
        const priorityOrder = {
          folder_scan: 1,
          metadata_scan: 2,
          full_scan: 3,
          cleanup: 4,
        };
        pendingJobs.sort(
          (a, b) =>
            (priorityOrder[a.type] || 99) - (priorityOrder[b.type] || 99),
        );

        const highPriorityPending = pendingJobs.find(
          (job) => job.type === "folder_scan" || job.type === "metadata_scan",
        );

        // If a full_scan is running but we have a high-priority pending job, pause full_scan
        if (
          runningJob &&
          runningJob.type === "full_scan" &&
          highPriorityPending
        ) {
          logger.syncOperation("Pausing full_scan for higher priority job", {
            pausedJobId: runningJob.id,
            priorityJobId: highPriorityPending.id,
            priorityJobType: highPriorityPending.type,
          });
          // Mark full_scan as pending again so it resumes later
          await updateSyncJob(runningJob.id, { status: "pending" });
          this.currentJob = null;
          // Execute the high-priority job
          await this.executeJob(highPriorityPending);
          continue;
        }

        // Check if any job is currently running - if so, wait
        if (runningJob) {
          await this.sleep(5000);
          continue;
        }

        // Get the next pending job (already sorted by priority)
        const nextJob = pendingJobs[0];
        if (nextJob) {
          await this.executeJob(nextJob);
        } else {
          await this.sleep(5000);
        }
      } catch (error) {
        logger.syncError("Error in sync queue processing", error as Error);
        await this.sleep(10000);
      }
    }

    logger.syncOperation("Sync queue processing stopped");
  }

  private async executeJob(job: SyncJob) {
    this.currentJob = job;

    try {
      await updateSyncJob(job.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });

      logger.syncOperation("Starting sync job", {
        jobId: job.id,
        jobType: job.type,
        folderPath: job.folder_path,
      });

      switch (job.type) {
        case "full_scan":
          await this.performFullScan(job);
          break;
        case "folder_scan":
          await this.performFolderScan(job);
          break;
        case "metadata_scan":
          await this.performMetadataScan(job);
          break;
        case "cleanup":
          await this.performCleanup(job);
          break;
        default: {
          // job.type is `never` here by type, but rows come from the database
          const unknownType: string = job.type;
          throw new Error(`Unknown job type: ${unknownType}`);
        }
      }

      await updateSyncJob(job.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });

      logger.syncOperation(`Completed ${job.type} job #${job.id}`);
    } catch (error) {
      logger.syncError("Error executing sync job", error as Error, {
        jobId: job.id,
        jobType: job.type,
      });

      await updateSyncJob(job.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      this.currentJob = null;
    }
  }

  private async performFullScan(job: SyncJob) {
    const config = getConfig();
    // S3 client auto-initializes with config

    logger.syncOperation("Starting full bucket scan (read-only mode)", {
      jobId: job.id,
      bucket: config.backblaze_bucket,
      endpoint: config.backblaze_endpoint,
    });

    const progress: SyncProgress = {
      total: 0,
      processed: 0,
      images: 0,
      skipped: 0,
      currentPage: 1,
    };

    const folderMap = new Map<string, number>();
    const seenFolders = new Set<string>();
    const photosToCreate: PhotoBatchItem[] = [];
    const BATCH_SIZE = 100;

    // Create scan context for helper functions
    const scanContext: ScanContext = {
      jobId: job.id,
      folderMap,
      seenFolders,
      config,
      ensureRootFolder: () => this.ensureRootFolder(),
      ensureFolderExists: (fp, sf, fm) => this.ensureFolderExists(fp, sf, fm),
    };

    // Pipeline S3 fetching with database processing
    let nextPagePromise: Promise<ListPage> | null = null;
    const pagination: PaginationState = {
      continuationToken: undefined,
      hasMorePages: true,
      currentObjects: [],
    };

    // Fetch first page
    const firstPage = await listObjectsAuto(
      "",
      pagination.continuationToken,
      1000,
      progress.currentPage,
    );
    pagination.currentObjects = firstPage.objects;
    pagination.continuationToken = firstPage.nextContinuationToken;
    pagination.hasMorePages = firstPage.isTruncated;

    while (pagination.currentObjects.length > 0 || pagination.hasMorePages) {
      // Start fetching next page while processing current page
      if (pagination.hasMorePages && pagination.continuationToken) {
        nextPagePromise = listObjectsAuto(
          "",
          pagination.continuationToken,
          1000,
          progress.currentPage + 1,
        );
      }

      progress.total += pagination.currentObjects.length;

      await updateSyncJob(job.id, {
        total_items: progress.total,
        processed_items: progress.processed,
      });

      for (const object of pagination.currentObjects) {
        try {
          const photoData = await processScanObject(object, scanContext);

          progress.processed++;

          if (photoData) {
            photosToCreate.push(photoData);
            progress.images++;

            // Flush batch when full
            if (photosToCreate.length >= BATCH_SIZE) {
              await flushPhotoBatch(photosToCreate, job.id, progress);
              photosToCreate.length = 0;
            }
          }
        } catch (error) {
          logger.syncError(
            "Error processing object during full scan",
            error as Error,
            {
              jobId: job.id,
              s3Key: object.key,
            },
          );
          progress.processed++;
          progress.skipped++;
        }
      }

      // Get next page if we started fetching it
      if (nextPagePromise) {
        const nextPage = await nextPagePromise;
        pagination.currentObjects = nextPage.objects;
        pagination.continuationToken = nextPage.nextContinuationToken;
        pagination.hasMorePages = nextPage.isTruncated;
        progress.currentPage++;
        nextPagePromise = null;
      } else {
        // No more pages
        pagination.currentObjects = [];
        pagination.hasMorePages = false;
      }
    }

    // Flush remaining photos
    await flushPhotoBatch(photosToCreate, job.id, progress);

    await updateSyncJob(job.id, {
      processed_items: progress.processed,
      total_items: progress.total,
    });

    // Bulk update folder counts and sync status for better performance
    const folderIds = Array.from(folderMap.values());
    await bulkUpdateFolderCounts(folderIds);
    await bulkUpdateFoldersLastSynced(folderIds);

    logger.syncOperation(
      `Full scan completed: processed ${progress.processed}/${progress.total} objects (${progress.images} images, ${progress.skipped} errors), created ${folderMap.size} folders`,
    );
  }

  private async performFolderScan(job: SyncJob) {
    if (isUnset(job.folder_path)) {
      throw new Error("Folder scan job missing folder_path");
    }

    const config = getConfig();
    // S3 client auto-initializes with config

    let folder: Folder | null = null;

    // For root folder sync, we don't need a folder record - we're just discovering top-level folders
    if (job.folder_path !== "") {
      folder = await getFolderByPath(job.folder_path);
      if (!folder) {
        throw new Error(`Folder not found: ${job.folder_path}`);
      }
    }

    logger.syncOperation("Starting folder scan", {
      jobId: job.id,
      folderPath: job.folder_path,
      jobType: job.type,
    });

    const prefix = job.folder_path === "" ? "" : `${job.folder_path}/`;

    // Handle pagination to get all objects in the folder
    const allObjects: S3Object[] = [];
    let continuationToken: string | undefined;
    let isTruncated = true;
    let pageNumber = 1;

    while (isTruncated) {
      const {
        objects,
        nextContinuationToken,
        isTruncated: truncated,
      } = await listObjectsAuto(prefix, continuationToken, 1000, pageNumber);

      allObjects.push(...objects);
      continuationToken = nextContinuationToken;
      isTruncated = truncated;
      pageNumber++;

      logger.debug("Fetched objects batch from S3", {
        batchSize: objects.length,
        totalSoFar: allObjects.length,
        hasMore: isTruncated,
      });
    }

    // Discover immediate subfolders by looking at all objects and extracting folder paths
    const immediateSubfolders = new Set<string>();

    for (const obj of allObjects) {
      const relativePath = obj.key.startsWith(prefix)
        ? obj.key.slice(prefix.length)
        : obj.key;
      const slashIndex = relativePath.indexOf("/");

      if (slashIndex > 0) {
        // This object is in a subfolder - extract the immediate subfolder name
        const immediateSubfolder = relativePath.substring(0, slashIndex);
        immediateSubfolders.add(immediateSubfolder);
      }
    }

    // Create folder entries for discovered subfolders
    for (const subfolderName of immediateSubfolders) {
      const subfolderPath =
        job.folder_path === ""
          ? subfolderName
          : `${job.folder_path}/${subfolderName}`;

      // For root-level subfolders, parent_id should be null
      // For nested subfolders, parent_id should be the current folder's id
      const parentId = job.folder_path === "" ? undefined : nonZero(folder?.id);

      try {
        await createOrUpdateFolder({
          path: subfolderPath,
          name: subfolderName,
          parent_id: parentId,
        });

        logger.debug("Created/updated subfolder during folder scan", {
          folderPath: subfolderPath,
          parentPath: job.folder_path,
        });
      } catch (error) {
        logger.syncError("Failed to create subfolder", error as Error, {
          folderPath: subfolderPath,
          component: "SyncService",
        });
      }
    }

    // For folder scan, only process files directly in this folder level, not in subfolders
    const directObjects = allObjects.filter((obj) => {
      // Remove the prefix to get the relative path
      const relativePath = obj.key.startsWith(prefix)
        ? obj.key.slice(prefix.length)
        : obj.key;
      // Only include files that don't contain '/' (i.e., not in a subfolder)
      return !relativePath.includes("/");
    });

    const imageObjects = directObjects.filter((obj) => isMediaFile(obj.key));
    let processedCount = 0;

    await updateSyncJob(job.id, {
      total_items: imageObjects.length,
    });

    logger.syncOperation("Processing folder scan images", {
      jobId: job.id,
      folderPath: job.folder_path,
      imageObjects: imageObjects.length,
    });

    for (const object of imageObjects) {
      try {
        const filename = getFilenameFromKey(object.key);
        logger.debug("Processing image in folder scan", {
          jobId: job.id,
          folderPath: job.folder_path,
          s3Key: object.key,
          filename,
        });
        const metadata = await this.extractMetadata(
          object,
          config.backblaze_bucket,
        );

        await createOrUpdatePhoto({
          folder_id: folder?.id ?? 0, // Use 0 for root-level photos
          filename: filename,
          s3_key: object.key,
          size: object.size,
          mime_type: getMimeType(filename),
          modified_at: object.lastModified.toISOString(),
          metadata: metadata,
        });

        processedCount++;

        if (processedCount % 50 === 0) {
          await updateJobProgress(job.id, processedCount, imageObjects.length, {
            message: "Folder scan progress update",
            folderPath: job.folder_path,
          });
        }
      } catch (error) {
        logger.syncError(
          "Error processing object during folder scan",
          error as Error,
          {
            jobId: job.id,
            s3Key: object.key,
            folderPath: job.folder_path,
          },
        );
      }
    }

    // Only update folder counts/timestamps for non-root scans
    if (folder) {
      await updateFolderCounts(folder.id);
      await updateFolderLastSynced(folder.id);
    }

    await updateJobProgress(job.id, processedCount, imageObjects.length, {
      message: "Folder scan completed",
      folderPath: job.folder_path,
    });
  }

  private async performMetadataScan(job: SyncJob) {
    if (!job.folder_path) {
      throw new Error("Metadata scan job missing folder_path");
    }

    const config = getConfig();
    // S3 client auto-initializes with config

    const folder = await getFolderByPath(job.folder_path);
    if (!folder) {
      throw new Error(`Folder not found: ${job.folder_path}`);
    }

    logger.syncOperation("Starting metadata scan for folder (on-demand)", {
      jobId: job.id,
      folderPath: job.folder_path,
    });

    // Get photos in this folder that need metadata extraction
    const result = await query<Photo>(
      `
      SELECT * FROM photos
      WHERE folder_id = $1
        AND metadata IS NULL
        AND metadata_status IN ('none', 'pending', 'skipped_size')
        AND mime_type LIKE 'image/%'
      ORDER BY id
    `,
      [folder.id],
    );

    const photosToProcess = result.rows;

    let processedCount = 0;

    await updateSyncJob(job.id, {
      total_items: photosToProcess.length,
    });

    logger.syncOperation("Found photos for metadata extraction", {
      jobId: job.id,
      folderPath: job.folder_path,
      totalPhotos: photosToProcess.length,
    });

    for (const photo of photosToProcess) {
      try {
        // Update status to pending
        await updatePhotoStatus(photo.id, { metadata_status: "pending" });

        const metadata = await this.extractMetadata(
          {
            key: photo.s3_key,
            size: photo.size,
            lastModified: new Date(photo.modified_at),
            etag: "",
          },
          config.backblaze_bucket,
        );

        if (metadata) {
          await updatePhotoMetadata(photo.id, metadata);
        } else {
          await updatePhotoStatus(photo.id, { metadata_status: "failed" });
        }

        processedCount++;

        if (processedCount % 10 === 0) {
          await updateJobProgress(
            job.id,
            processedCount,
            photosToProcess.length,
            {
              message: "Metadata scan progress update",
              folderPath: job.folder_path,
            },
          );
        }
      } catch (error) {
        logger.syncError(
          "Error extracting metadata during folder scan",
          error as Error,
          {
            jobId: job.id,
            photoId: photo.id,
            s3Key: photo.s3_key,
            folderPath: job.folder_path,
          },
        );
        await updatePhotoStatus(photo.id, { metadata_status: "none" });
      }
    }

    await updateJobProgress(job.id, processedCount, photosToProcess.length, {
      message: "Metadata scan completed",
      folderPath: job.folder_path,
    });
  }

  private async performCleanup(job: SyncJob) {
    const config = getConfig();
    const { deleteOldThumbnails } = await import("./database");
    const fs = await import("fs");

    logger.syncOperation("Starting cleanup process");

    const thumbnailPaths = await deleteOldThumbnails(
      config.thumbnail_max_age_days,
    );
    let deletedCount = 0;

    await updateSyncJob(job.id, {
      total_items: thumbnailPaths.length,
    });

    for (const thumbnailPath of thumbnailPaths) {
      try {
        if (fs.existsSync(thumbnailPath)) {
          fs.unlinkSync(thumbnailPath);
          deletedCount++;
        }

        if (deletedCount % 100 === 0) {
          await updateJobProgress(job.id, deletedCount, thumbnailPaths.length, {
            message: "Cleanup progress update",
          });
        }
      } catch (error) {
        logger.syncError(
          "Error deleting thumbnail during cleanup",
          error as Error,
          {
            jobId: job.id,
            thumbnailPath,
          },
        );
      }
    }

    await updateJobProgress(job.id, deletedCount, thumbnailPaths.length, {
      message: "Cleanup completed",
      extra: { maxAgeDays: config.thumbnail_max_age_days },
    });
  }

  private async ensureRootFolder(): Promise<number> {
    let folder = await getFolderByPath("");

    if (!folder) {
      folder = await createOrUpdateFolder({
        path: "",
        name: "Root",
        parent_id: undefined,
      });
    }

    return folder.id;
  }

  private async ensureFolderExists(
    folderPath: string,
    seenFolders: Set<string>,
    folderMap: Map<string, number>,
  ): Promise<number> {
    if (seenFolders.has(folderPath)) {
      return this.requireFolderId(folderMap, folderPath);
    }

    const pathParts = folderPath.split("/");
    const foldersToCreate: {
      path: string;
      name: string;
      parent_path: string;
    }[] = [];
    let currentPath = "";
    let parentId: number | undefined;

    // First pass: identify which folders need to be created
    for (const [i, part] of pathParts.entries()) {
      currentPath = i === 0 ? part : `${currentPath}/${part}`;

      if (!seenFolders.has(currentPath) && !folderMap.has(currentPath)) {
        foldersToCreate.push({
          path: currentPath,
          name: part,
          parent_path: i === 0 ? "" : pathParts.slice(0, i).join("/"),
        });
      }
    }

    // Batch check existing folders to minimize database queries
    // Only check paths that aren't already in our cache
    const uncachedPaths = foldersToCreate
      .map((f) => f.path)
      .filter((path) => !folderMap.has(path) && !seenFolders.has(path));

    if (uncachedPaths.length > 0) {
      const existingFolders = await this.getFoldersByPaths(uncachedPaths);

      // Update maps with existing folders
      for (const folder of existingFolders) {
        folderMap.set(folder.path, folder.id);
        seenFolders.add(folder.path);
      }
    }

    // Second pass: create folders that don't exist, ensuring proper parent relationships
    for (const [i, part] of pathParts.entries()) {
      currentPath = i === 0 ? part : `${currentPath}/${part}`;

      if (!seenFolders.has(currentPath)) {
        // Get parent ID from previous iteration or map
        if (i > 0) {
          const parentPath = pathParts.slice(0, i).join("/");
          parentId = folderMap.get(parentPath);
        } else {
          parentId = undefined;
        }

        const folder = await createOrUpdateFolder({
          path: currentPath,
          name: part,
          parent_id: parentId,
        });

        folderMap.set(currentPath, folder.id);
        seenFolders.add(currentPath);
        parentId = folder.id;
      } else {
        parentId = this.requireFolderId(folderMap, currentPath);
      }
    }

    if (parentId === undefined) {
      throw new Error(`No folder resolved for path: ${folderPath}`);
    }
    return parentId;
  }

  /** Folders in seenFolders are always added to folderMap alongside */
  private requireFolderId(
    folderMap: Map<string, number>,
    folderPath: string,
  ): number {
    const id = folderMap.get(folderPath);
    if (id === undefined) {
      throw new Error(`Folder id missing from cache: ${folderPath}`);
    }
    return id;
  }

  private async getFoldersByPaths(paths: string[]): Promise<Folder[]> {
    if (paths.length === 0) return [];

    // Use IN clause to get multiple folders in one query
    const placeholders = paths.map((_, index) => `$${index + 1}`).join(",");
    const result = await query<Folder>(
      `SELECT * FROM folders WHERE path IN (${placeholders})`,
      paths,
    );
    return result.rows;
  }

  private async extractMetadata(
    object: S3Object,
    bucket: string,
  ): Promise<PhotoMetadata | undefined> {
    if (!getMimeType(object.key).startsWith("image/")) {
      return undefined;
    }
    try {
      const { probeImageHead } = await import("./imageProbe");
      return (await probeImageHead(object.key)).metadata;
    } catch (error) {
      logger.warn("Could not extract metadata from object", {
        component: "SyncService",
        s3Key: object.key,
        bucket,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return undefined;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getCurrentJob(): SyncJob | null {
    return this.currentJob;
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

export const syncService = new SyncService();
