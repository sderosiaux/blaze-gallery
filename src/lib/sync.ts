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
  failStaleSyncJobs,
  claimSyncJob,
  createOrUpdateFolder,
  createOrUpdatePhoto,
  getFolderByPath,
  updateFolderCounts,
  updatePhotoStatus,
  updatePhotoMetadata,
  bulkCreateOrUpdateFolders,
  deletePhotos,
  getFolderIdsByPath,
  getPhotoFiles,
  insertNewPhotos,
  markFoldersSynced,
  recountDriftedFolders,
  resetReplacedPhotos,
  updateFolderLastSynced,
  query,
} from "./database";
import type { NewPhoto, SyncJob, SyncJobStats } from "./database";
import type {
  BucketDiff,
  FolderToCreate,
  KnownPhoto,
  ListingPage,
} from "./bucketDiff";
import {
  BucketDiffer,
  MAX_REMOVED_SHARE,
  folderDepth,
  isMassRemoval,
  missingFolders,
} from "./bucketDiff";
import { getConfig } from "./config";
import { logger } from "./logger";
import type { PhotoMetadata, Photo, Folder } from "@/types";
import type { ThumbnailStatus } from "@/types/common";

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

/** Rows per statement when a full scan applies its diff */
const CHUNK = 1000;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}

/** Runs of folders at the same depth, from a list sorted by depth */
function depthLevels(folders: readonly FolderToCreate[]): FolderToCreate[][] {
  const levels: FolderToCreate[][] = [];
  let depth = -1;
  for (const folder of folders) {
    const folderLevel = folderDepth(folder.path);
    if (folderLevel !== depth) {
      levels.push([]);
      depth = folderLevel;
    }
    levels[levels.length - 1]?.push(folder);
  }
  return levels;
}

function requireFolderId(
  folderIds: ReadonlyMap<string, number>,
  folderPath: string,
): number {
  const id = folderIds.get(folderPath);
  if (id === undefined) {
    throw new Error(`Folder id missing for path: ${folderPath}`);
  }
  return id;
}

function thumbnailStatusFor(
  size: number,
  thresholdMb: number,
): ThumbnailStatus {
  return size / (1024 * 1024) > thresholdMb ? "skipped_size" : "none";
}

function newPhoto(
  object: S3Object,
  folderId: number,
  thresholdMb: number,
): NewPhoto {
  const filename = getFilenameFromKey(object.key);
  return {
    folder_id: folderId,
    filename,
    s3_key: object.key,
    size: object.size,
    mime_type: getMimeType(filename),
    modified_at: object.lastModified.toISOString(),
    // Metadata has no size threshold: the head probe reads 64 KB whatever the file size
    metadata_status: "none",
    thumbnail_status: thumbnailStatusFor(object.size, thresholdMb),
  };
}

/** What a full scan would change, computed without writing anything */
export interface SyncPlan {
  diff: BucketDiff;
  /** Photos in the database before the scan */
  knownPhotos: number;
  /** Folder ids by path before the scan */
  folderIds: ReadonlyMap<string, number>;
  foldersToCreate: FolderToCreate[];
  pages: number;
}

export interface PlanOptions {
  /** Only this folder and those under it; the whole bucket when unset */
  folder?: string;
  /** Record the listing calls in s3_audit_logs; a dry run writes nothing */
  audit: boolean;
  /** Called after each listing page with the objects taken in so far */
  onPage?: (listed: number, pageNumber: number) => Promise<void>;
}

/**
 * Lists the whole bucket against what the database knows. Reads only: the
 * dry run (`npm run sync -- --dry-run`) prints the plan, a full scan applies
 * it. Throws IncompleteListingError when the listing stops before its last
 * page, so a cut listing never reads as deleted files.
 */
export async function planBucketSync(options: PlanOptions): Promise<SyncPlan> {
  const prefix = options.folder ? `${options.folder}/` : undefined;
  // Read before listing: a photo recorded meanwhile can only look new (and
  // the insert skips it), never removed.
  const [files, folderIds] = await Promise.all([
    getPhotoFiles(prefix),
    getFolderIdsByPath(),
  ]);
  const known = new Map<string, KnownPhoto>(
    files.map((file) => [
      file.s3_key,
      { id: file.id, size: file.size, modifiedAt: file.modified_at.getTime() },
    ]),
  );
  const differ = new BucketDiffer(known);

  let pageNumber = 0;
  let page: ListingPage;
  let continuationToken: string | undefined;
  do {
    pageNumber++;
    page = await listObjectsAuto({
      prefix,
      continuationToken,
      maxKeys: 1000,
      pageNumber,
      audit: options.audit,
    });
    differ.addPage(page);
    continuationToken = page.nextContinuationToken;
    await options.onPage?.(differ.listed, pageNumber);
  } while (page.isTruncated && continuationToken !== undefined);

  const diff = differ.finish();
  return {
    diff,
    knownPhotos: known.size,
    folderIds,
    foldersToCreate: missingFolders(diff.folders, folderIds),
    pages: pageNumber,
  };
}

/**
 * The folder a full scan covers: none (the whole bucket) for "/", the path
 * every full scan was queued with, or for an empty path.
 */
export function scanFolder(folderPath: string | undefined): string | undefined {
  const folder = folderPath?.replace(/^\/+|\/+$/g, "");
  return folder === undefined || folder === "" ? undefined : folder;
}

function planStats(plan: SyncPlan): SyncJobStats {
  return {
    listed: plan.diff.listed,
    added: plan.diff.added.length,
    changed: plan.diff.changed.length,
    removed: plan.diff.removed.length,
    folders_created: plan.foldersToCreate.length,
    changed_photo_ids: plan.diff.changed.map((change) => change.id),
    removed_keys: plan.diff.removed.map((photo) => photo.key),
  };
}

function logQueueFailure(error: unknown): void {
  logger.syncError(
    "Sync queue stopped unexpectedly",
    error instanceof Error ? error : new Error(String(error)),
  );
}

/** A running job silent for this long belongs to a process that died. */
const STALE_AFTER_MINUTES = 15;
const HEARTBEAT_MS = 60_000;

const PRIORITY: Record<SyncJob["type"], number> = {
  folder_scan: 1,
  metadata_scan: 2,
  full_scan: 3,
  cleanup: 4,
};

/** Pending jobs, folder and metadata scans first, then full scans, then cleanup. */
function pendingByPriority(jobs: SyncJob[]): SyncJob[] {
  return jobs
    .filter((job) => job.status === "pending")
    .sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
}

async function failStaleJobs(): Promise<void> {
  const failed = await failStaleSyncJobs(STALE_AFTER_MINUTES);
  if (failed.length > 0)
    logger.syncOperation(
      `Failed sync jobs left by a stopped process: #${failed.join(", #")}`,
    );
}

export class SyncService {
  private isRunning = false;
  /** Set by drain(): lets a full scan remove more than MAX_REMOVED_SHARE */
  private allowMassRemoval = false;
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
      await failStaleJobs();
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
        await failStaleJobs();
        const activeJobs = await getActiveSyncJobs();
        const pendingJobs = pendingByPriority(activeJobs);
        const runningJob = activeJobs.find((job) => job.status === "running");

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
    if (!(await claimSyncJob(job.id))) return;
    this.currentJob = job;
    // Proves this process is alive even through a long listing or a slow
    // batch, so other processes don't take the job for abandoned.
    const heartbeat = setInterval(() => {
      updateSyncJob(job.id, {}).catch((error: unknown) => {
        logger.syncError("Sync heartbeat failed", error as Error, {
          jobId: job.id,
        });
      });
    }, HEARTBEAT_MS);

    try {
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
      clearInterval(heartbeat);
      this.currentJob = null;
    }
  }

  /**
   * Runs pending jobs, by priority, until none is left, then returns. For a
   * long-lived process outside the web server (`npm run sync`): unlike the
   * startup loop it ends, so it can run from cron. Waits while another live
   * process holds a running job. `allowMassRemoval` lets its full scans
   * remove more than MAX_REMOVED_SHARE of the photos.
   */
  async drain(options: { allowMassRemoval?: boolean } = {}): Promise<void> {
    this.allowMassRemoval = options.allowMassRemoval ?? false;
    for (;;) {
      await failStaleJobs();
      const activeJobs = await getActiveSyncJobs();
      if (activeJobs.some((job) => job.status === "running")) {
        await this.sleep(5000);
        continue;
      }
      const next = pendingByPriority(activeJobs)[0];
      if (!next) return;
      await this.executeJob(next);
    }
  }

  /**
   * Lists the bucket, diffs it against the database and writes only the
   * differences: new folders, new photos, replaced files, files gone. A
   * listing that stops early fails the job before anything is written.
   * Covers the whole bucket, or the job's folder and those under it.
   * Progress counts the objects compared, then the changes applied.
   */
  private async performFullScan(job: SyncJob) {
    const config = getConfig();
    const scope = scanFolder(job.folder_path);
    logger.syncOperation("Starting full scan: bucket against database", {
      jobId: job.id,
      bucket: config.backblaze_bucket,
      folderPath: scope ?? "(whole bucket)",
    });

    const plan = await planBucketSync({
      folder: scope,
      audit: true,
      onPage: async (listed, pageNumber) => {
        if (pageNumber % 10 === 0) {
          await updateSyncJob(job.id, {
            processed_items: listed,
            total_items: listed,
          });
        }
      },
    });
    const { diff } = plan;

    let processed = diff.listed;
    const total =
      diff.listed +
      plan.foldersToCreate.length +
      diff.added.length +
      diff.changed.length +
      diff.removed.length;
    const stats = planStats(plan);
    // Before any change: a database without the stats column fails here, not halfway
    await updateSyncJob(job.id, {
      processed_items: processed,
      total_items: total,
      stats,
    });

    if (
      isMassRemoval(diff.removed.length, plan.knownPhotos) &&
      !this.allowMassRemoval
    ) {
      throw new Error(
        `${diff.removed.length} of ${plan.knownPhotos} photos are no longer in the bucket ` +
          `(more than ${MAX_REMOVED_SHARE * 100}%): nothing was changed. Check the bucket, ` +
          `then run npm run sync -- --allow-mass-removal`,
      );
    }

    const advance = async (count: number) => {
      processed += count;
      await updateSyncJob(job.id, { processed_items: processed });
    };
    const folderIds = new Map(plan.folderIds);

    for (const level of depthLevels(plan.foldersToCreate)) {
      for (const chunk of chunks(level)) {
        const created = await bulkCreateOrUpdateFolders(
          chunk.map((folder) => ({
            path: folder.path,
            name: folder.name,
            parent_id:
              folder.parentPath === null
                ? undefined
                : requireFolderId(folderIds, folder.parentPath),
          })),
        );
        for (const folder of created) {
          // bigserial: pg hands the id back as a string
          folderIds.set(folder.path, Number(folder.id));
        }
        await advance(chunk.length);
      }
    }

    for (const chunk of chunks(diff.added)) {
      await insertNewPhotos(
        chunk.map((object) =>
          newPhoto(
            object,
            requireFolderId(folderIds, getFolderFromKey(object.key)),
            config.auto_thumbnail_threshold_mb,
          ),
        ),
      );
      await advance(chunk.length);
    }

    for (const chunk of chunks(diff.changed)) {
      await resetReplacedPhotos(
        chunk.map(({ id, object }) => ({
          id,
          size: object.size,
          modified_at: object.lastModified.toISOString(),
          thumbnail_status: thumbnailStatusFor(
            object.size,
            config.auto_thumbnail_threshold_mb,
          ),
        })),
      );
      await advance(chunk.length);
    }

    for (const chunk of chunks(diff.removed)) {
      await deletePhotos(chunk.map((photo) => photo.id));
      await advance(chunk.length);
    }

    // Folders are never deleted, even when emptied: shares point at them
    const recounted = await recountDriftedFolders();
    await markFoldersSynced(scope);
    await updateSyncJob(job.id, {
      stats: { ...stats, folders_recounted: recounted },
    });

    if (diff.changed.length > 0) {
      logger.warn(
        "Full scan: replaced files keep their faces and descriptions until analysed again",
        { jobId: job.id, photoIds: diff.changed.map((change) => change.id) },
      );
    }
    logger.syncOperation(
      `Full scan completed: ${diff.listed} objects compared, ${diff.added.length} added, ` +
        `${diff.changed.length} changed, ${diff.removed.length} removed, ` +
        `${plan.foldersToCreate.length} folders created, ${recounted} folder counts corrected`,
      { jobId: job.id },
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
      } = await listObjectsAuto({
        prefix,
        continuationToken,
        maxKeys: 1000,
        pageNumber,
      });

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
