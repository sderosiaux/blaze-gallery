import { syncService } from "@/lib/sync";
import { thumbnailService } from "@/lib/thumbnails";
import { getConfig, testS3Connection } from "@/lib/config";
import { logger } from "@/lib/logger";

// Global flag to ensure startup only runs once
let isStartupComplete = false;
let startupPromise: Promise<void> | null = null;

async function startup(): Promise<void> {
  // If startup is already complete, do nothing
  if (isStartupComplete) {
    logger.debug("Startup already completed, skipping...");
    return;
  }

  // If startup is already running, wait for it to complete
  if (startupPromise) {
    logger.debug("Startup already in progress, waiting for completion...");
    return startupPromise;
  }

  // Create the startup promise
  startupPromise = performStartup();

  try {
    await startupPromise;
  } catch (error) {
    // Reset the promise so startup can be retried
    startupPromise = null;
    throw error;
  }
}

async function performStartup(): Promise<void> {
  logger.info("Starting Blaze Gallery application...");

  try {
    logger.info("Testing configuration...");
    const config = getConfig();

    const configKeys = [
      "backblaze_endpoint",
      "backblaze_bucket",
      "backblaze_access_key",
      "backblaze_secret_key",
    ];
    const missingKeys = configKeys.filter(
      (key) => !config[key as keyof typeof config],
    );

    if (missingKeys.length > 0) {
      logger.warn(`Missing configuration: ${missingKeys.join(", ")}`);
      logger.warn(
        "Please set environment variables or update configuration via API",
      );
    } else {
      logger.info("Testing S3 connection...");
      const connectionTest = await testS3Connection();

      if (connectionTest.success) {
        logger.info("S3 connection successful");
      } else {
        logger.error(`S3 connection failed: ${connectionTest.error}`);
      }
    }

    logger.info("Checking thumbnail service...");
    const thumbnailStats = thumbnailService.getThumbnailStats();
    const sizeMB = (thumbnailStats.totalSize / 1024 / 1024).toFixed(1);
    logger.info(
      `Thumbnails: ${thumbnailStats.totalThumbnails} files (${sizeMB}MB)`,
    );

    logger.info("Starting sync service...");
    await syncService.start();
    logger.info("Sync service started");

    logger.info("Blaze Gallery startup completed successfully!");

    // Mark startup as complete
    isStartupComplete = true;
  } catch (error) {
    logger.error("Startup failed", error as Error);
    // In server environment, exit on startup failure
    if (typeof window === "undefined") {
      process.exit(1);
    }
    throw error;
  }
}

if (require.main === module) {
  startup();
}

// Utility function to check if startup is complete
export function isStartupReady(): boolean {
  return isStartupComplete;
}

// Utility function to wait for startup completion
export function waitForStartup(): Promise<void> {
  if (isStartupComplete) {
    return Promise.resolve();
  }

  if (startupPromise) {
    return startupPromise;
  }

  // If startup hasn't been initiated, start it
  return startup();
}

export { startup };
