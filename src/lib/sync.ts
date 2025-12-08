import {
  listObjectsAuto,
  isImageFile,
  isMediaFile,
  getMimeType,
  getFolderFromKey,
  getFilenameFromKey,
  S3Object,
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
  bulkCreateOrUpdateFolders,
  bulkCreateOrUpdatePhotos,
  bulkUpdateFolderCounts,
  bulkUpdateFoldersLastSynced,
  updateFolderLastSynced,
  query,
} from "./database";
import type { SyncJob } from "./database";
import { getConfig } from "./config";
import { logger } from "./logger";
import { PhotoMetadata, Photo } from "@/types";

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

    this.processQueue();
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
            processed: existingFullScan.processed_items ?? 0,
            total: existingFullScan.total_items ?? 0,
          },
        });
        return; // Don't create a new one, let existing job continue
      }

      // Check if we recently completed a full scan (within last hour)
      const recentCompleted = await query(
        `
        SELECT * FROM sync_jobs
        WHERE type = 'full_scan' AND status = 'completed'
        AND completed_at > NOW() - INTERVAL '1 hour'
        ORDER BY completed_at DESC LIMIT 1
      `,
        [],
      );

      if (recentCompleted.rows.length > 0) {
        logger.syncOperation(
          "Full scan completed recently, skipping startup scan",
          {
            component: "SyncService",
            lastCompletedAt: recentCompleted.rows[0].completed_at,
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
        if (folder && folder.last_synced) {
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
        this.start();
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
      const checkInterval = setInterval(async () => {
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
          reject(error);
        }
      }, 100); // Check every 100ms

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Job ${jobId} timeout after 30 seconds`));
      }, 30000);
    });
  }

  async stop() {
    this.isRunning = false;
    logger.syncOperation("Stopping sync service");
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
        default:
          throw new Error(`Unknown job type: ${job.type}`);
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

    let continuationToken: string | undefined;
    let totalObjects = 0;
    let processedObjects = 0;
    let imageObjects = 0;
    let skippedObjects = 0;
    let pageNumber = 1;

    const folderMap = new Map<string, number>();
    const seenFolders = new Set<string>();
    const foldersToCreate: any[] = [];
    const photosToCreate: any[] = [];
    const BATCH_SIZE = 100;

    // Pipeline S3 fetching with database processing
    let nextPagePromise: Promise<any> | null = null;
    let currentObjects: any[] = [];
    let hasMorePages = true;

    // Fetch first page
    const firstPage = await listObjectsAuto(
      "",
      continuationToken,
      1000,
      pageNumber,
    );
    currentObjects = firstPage.objects;
    continuationToken = firstPage.nextContinuationToken;
    hasMorePages = firstPage.isTruncated;

    while (currentObjects.length > 0 || hasMorePages) {
      // Start fetching next page while processing current page
      if (hasMorePages && continuationToken) {
        nextPagePromise = listObjectsAuto(
          "",
          continuationToken,
          1000,
          pageNumber + 1,
        );
      }

      totalObjects += currentObjects.length;

      await updateSyncJob(job.id, {
        total_items: totalObjects,
        processed_items: processedObjects,
      });

      for (const object of currentObjects) {
        try {
          const folderPath = getFolderFromKey(object.key);

          // Collect folders for bulk creation
          let folderId: number;
          if (folderPath === "") {
            folderId = await this.ensureRootFolder();
          } else {
            if (!folderMap.has(folderPath)) {
              folderId = await this.ensureFolderExists(
                folderPath,
                seenFolders,
                folderMap,
              );
              folderMap.set(folderPath, folderId);
            } else {
              folderId = folderMap.get(folderPath)!;
            }
          }

          // Skip non-media files for photo processing, but folder was still created
          if (!isMediaFile(object.key)) {
            processedObjects++;

            // DEBUG: Log non-media files that are creating folders
            if (process.env.LOG_LEVEL === "DEBUG") {
              logger.syncOperation(
                "Skipping non-media file, but folder was created",
                {
                  jobId: job.id,
                  s3Key: object.key,
                  folderPath: folderPath || "(root)",
                  fileSize: object.size,
                },
              );
            }
            continue;
          }

          const filename = getFilenameFromKey(object.key);
          const sizeMB = object.size / (1024 * 1024);

          // Determine processing status based on size thresholds
          const metadataStatus =
            sizeMB > config.auto_metadata_threshold_mb
              ? "skipped_size"
              : "none";
          const thumbnailStatus =
            sizeMB > config.auto_thumbnail_threshold_mb
              ? "skipped_size"
              : "none";

          // Collect photos for bulk creation
          photosToCreate.push({
            folder_id: folderId,
            filename: filename,
            s3_key: object.key,
            size: object.size,
            mime_type: getMimeType(filename),
            modified_at: object.lastModified.toISOString(),
            metadata_status: metadataStatus,
            thumbnail_status: thumbnailStatus,
          });

          processedObjects++;

          // Process batches for better performance
          if (photosToCreate.length >= BATCH_SIZE) {
            await bulkCreateOrUpdatePhotos(photosToCreate);
            photosToCreate.length = 0; // Clear array

            await updateSyncJob(job.id, {
              processed_items: processedObjects,
            });
            if (process.env.LOG_LEVEL === "DEBUG") {
              logger.syncOperation(
                "Full scan progress update (batch processed)",
                {
                  jobId: job.id,
                  progress: {
                    processed: processedObjects,
                    total: totalObjects,
                  },
                  percentComplete: Math.round(
                    (processedObjects / totalObjects) * 100,
                  ),
                },
              );
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
          processedObjects++;
        }
      }

      // Get next page if we started fetching it
      if (nextPagePromise) {
        const nextPage = await nextPagePromise;
        currentObjects = nextPage.objects;
        continuationToken = nextPage.nextContinuationToken;
        hasMorePages = nextPage.isTruncated;
        pageNumber++;
        nextPagePromise = null;
      } else {
        // No more pages
        currentObjects = [];
        hasMorePages = false;
      }
    }

    // Process remaining photos
    if (photosToCreate.length > 0) {
      await bulkCreateOrUpdatePhotos(photosToCreate);
    }

    await updateSyncJob(job.id, {
      processed_items: processedObjects,
      total_items: totalObjects,
    });

    // Bulk update folder counts and sync status for better performance
    const folderIds = Array.from(folderMap.values());
    await bulkUpdateFolderCounts(folderIds);
    await bulkUpdateFoldersLastSynced(folderIds);

    logger.syncOperation(
      `Full scan completed: processed ${processedObjects}/${totalObjects} objects, created ${folderMap.size} folders`,
    );
  }

  private async performFolderScan(job: SyncJob) {
    if (job.folder_path === undefined || job.folder_path === null) {
      throw new Error("Folder scan job missing folder_path");
    }

    const config = getConfig();
    // S3 client auto-initializes with config

    let folder = null;

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
    let allObjects: any[] = [];
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
      const parentId =
        job.folder_path === "" ? undefined : folder?.id || undefined;

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
          folder_id: folder?.id || 0, // Use 0 for root-level photos
          filename: filename,
          s3_key: object.key,
          size: object.size,
          mime_type: getMimeType(filename),
          modified_at: object.lastModified.toISOString(),
          metadata: metadata,
        });

        processedCount++;

        if (processedCount % 50 === 0) {
          await updateSyncJob(job.id, {
            processed_items: processedCount,
          });
          logger.syncOperation("Folder scan progress update", {
            jobId: job.id,
            folderPath: job.folder_path,
            progress: { processed: processedCount, total: imageObjects.length },
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

    await updateSyncJob(job.id, {
      processed_items: processedCount,
    });

    logger.syncOperation("Folder scan completed", {
      jobId: job.id,
      folderPath: job.folder_path,
      processedCount,
      totalObjects: imageObjects.length,
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
    const result = await query(
      `
      SELECT * FROM photos
      WHERE folder_id = $1
        AND metadata_status IN ('none', 'pending')
        AND size <= $2
      ORDER BY size ASC
    `,
      [folder.id, config.auto_metadata_threshold_mb * 1024 * 1024],
    );

    const photosToProcess = result.rows as Photo[];

    let processedCount = 0;

    await updateSyncJob(job.id, {
      total_items: photosToProcess.length,
    });

    logger.syncOperation("Found photos for metadata extraction", {
      jobId: job.id,
      folderPath: job.folder_path,
      totalPhotos: photosToProcess.length,
      maxSizeMB: config.auto_metadata_threshold_mb,
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
          await updatePhotoStatus(photo.id, { metadata_status: "extracted" });
        }

        processedCount++;

        if (processedCount % 10 === 0) {
          await updateSyncJob(job.id, {
            processed_items: processedCount,
          });
          logger.syncOperation("Metadata scan progress update", {
            jobId: job.id,
            folderPath: job.folder_path,
            progress: {
              processed: processedCount,
              total: photosToProcess.length,
            },
          });
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

    await updateSyncJob(job.id, {
      processed_items: processedCount,
    });

    logger.syncOperation("Metadata scan completed", {
      jobId: job.id,
      folderPath: job.folder_path,
      processedCount,
      totalPhotos: photosToProcess.length,
    });
  }

  private async performCleanup(job: SyncJob) {
    const config = getConfig();
    const { deleteOldThumbnails } = await import("./database");
    const fs = await import("fs");
    const path = await import("path");

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
          await updateSyncJob(job.id, {
            processed_items: deletedCount,
          });
          logger.syncOperation("Cleanup progress update", {
            jobId: job.id,
            deletedCount,
            totalThumbnails: thumbnailPaths.length,
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

    await updateSyncJob(job.id, {
      processed_items: deletedCount,
    });

    logger.syncOperation("Cleanup completed", {
      jobId: job.id,
      deletedCount,
      totalThumbnails: thumbnailPaths.length,
      maxAgeDays: config.thumbnail_max_age_days,
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
      return folderMap.get(folderPath)!;
    }

    const pathParts = folderPath.split("/");
    const foldersToCreate: any[] = [];
    let currentPath = "";
    let parentId: number | undefined;

    // First pass: identify which folders need to be created
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
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
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
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
        parentId = folderMap.get(currentPath)!;
      }
    }

    return parentId!;
  }

  private async getFoldersByPaths(paths: string[]): Promise<any[]> {
    if (paths.length === 0) return [];

    // Use IN clause to get multiple folders in one query
    const placeholders = paths.map((_, index) => `$${index + 1}`).join(",");
    const result = await query(
      `SELECT * FROM folders WHERE path IN (${placeholders})`,
      paths,
    );
    return result.rows;
  }

  private async extractMetadata(
    object: S3Object,
    bucket: string,
  ): Promise<PhotoMetadata | undefined> {
    let stream: any = null;

    try {
      const ExifReader = require("exifreader");
      const { getObjectStream } = await import("./s3");

      stream = await getObjectStream(bucket, object.key);

      if (!stream) return undefined;

      const chunks: Buffer[] = [];
      const MAX_SIZE = 512 * 1024; // Reduced to 512KB for memory efficiency
      let totalSize = 0;
      let isResolved = false;

      if (stream && typeof stream === "object" && "on" in stream) {
        return new Promise<PhotoMetadata | undefined>((resolve, reject) => {
          const cleanup = () => {
            if (stream && typeof stream.destroy === "function") {
              stream.destroy();
            }
            chunks.length = 0; // Clear array to free memory
          };

          const safeResolve = (result: PhotoMetadata | undefined) => {
            if (!isResolved) {
              isResolved = true;
              cleanup();
              resolve(result);
            }
          };

          // Set timeout to prevent hanging streams
          const timeout = setTimeout(() => {
            logger.warn("Metadata extraction timeout", {
              component: "SyncService",
              s3Key: object.key,
              bucket: bucket,
              totalSize,
            });
            safeResolve(undefined);
          }, 30000); // 30 second timeout

          stream.on("data", (chunk: Buffer) => {
            if (isResolved) return;

            const chunkSize = chunk.length;
            if (totalSize + chunkSize > MAX_SIZE) {
              // Take only what we need to reach MAX_SIZE
              const remainingSize = MAX_SIZE - totalSize;
              if (remainingSize > 0) {
                chunks.push(chunk.subarray(0, remainingSize));
                totalSize += remainingSize;
              }
              // Stop reading more data
              stream.destroy();
              return;
            }

            chunks.push(Buffer.from(chunk));
            totalSize += chunkSize;
          });

          stream.on("end", () => {
            if (isResolved) return;
            clearTimeout(timeout);

            try {
              if (chunks.length === 0) {
                safeResolve(undefined);
                return;
              }

              const buffer = Buffer.concat(chunks);
              const tags = ExifReader.load(buffer);

              const metadata: PhotoMetadata = {};

              if (tags.DateTime?.description) {
                const dateStr = tags.DateTime.description;
                const date = new Date(
                  dateStr
                    .replace(/:/g, "-")
                    .replace(/(\d{4})-(\d{2})-(\d{2}) /, "$1-$2-$3T") + "Z",
                );
                if (!isNaN(date.getTime())) {
                  metadata.date_taken = date.toISOString();
                }
              }

              if (
                tags.GPSLatitude?.description &&
                tags.GPSLongitude?.description
              ) {
                const lat = parseFloat(tags.GPSLatitude.description);
                const lon = parseFloat(tags.GPSLongitude.description);
                if (!isNaN(lat) && !isNaN(lon)) {
                  metadata.location = { latitude: lat, longitude: lon };
                }
              }

              if (tags["Image Width"]?.value && tags["Image Height"]?.value) {
                const width = parseInt(tags["Image Width"].value);
                const height = parseInt(tags["Image Height"].value);
                if (!isNaN(width) && !isNaN(height)) {
                  metadata.dimensions = { width, height };
                }
              }

              safeResolve(
                Object.keys(metadata).length > 0 ? metadata : undefined,
              );
            } catch (error) {
              logger.warn("Error parsing EXIF data", {
                component: "SyncService",
                s3Key: object.key,
                bucket: bucket,
                error: error instanceof Error ? error.message : "Unknown error",
              });
              safeResolve(undefined);
            }
          });

          stream.on("error", (error: Error) => {
            if (isResolved) return;
            clearTimeout(timeout);
            logger.warn("Stream error during metadata extraction", {
              component: "SyncService",
              s3Key: object.key,
              bucket: bucket,
              error: error.message,
            });
            safeResolve(undefined);
          });
        });
      } else {
        return undefined;
      }
    } catch (error) {
      // Ensure stream is cleaned up in case of exception
      if (stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
      logger.warn("Could not extract metadata from object", {
        component: "SyncService",
        s3Key: object.key,
        bucket: bucket,
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
