import { Config } from "@/types";
import { logger } from "./logger";

let cachedConfig: Config | null = null;

export async function getConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  logger.configInfo("Loading configuration from environment and database");

  const defaultConfig: Config = {
    backblaze_endpoint: process.env.BACKBLAZE_ENDPOINT || "",
    backblaze_bucket: process.env.BACKBLAZE_BUCKET || "",
    backblaze_access_key: process.env.BACKBLAZE_ACCESS_KEY || "",
    backblaze_secret_key: process.env.BACKBLAZE_SECRET_KEY || "",
    thumbnail_max_age_days: parseInt(
      process.env.THUMBNAIL_MAX_AGE_DAYS || "30",
    ),
    sync_interval_hours: parseInt(process.env.SYNC_INTERVAL_HOURS || "24"),
    auto_metadata_threshold_mb: parseInt(
      process.env.AUTO_METADATA_THRESHOLD_MB || "5",
    ),
    auto_thumbnail_threshold_mb: parseInt(
      process.env.AUTO_THUMBNAIL_THRESHOLD_MB || "30",
    ),
    sync_throttle_seconds: parseInt(process.env.SYNC_THROTTLE_SECONDS || "30"),
  };

  // Log which environment variables are set (without exposing values)
  const envVarsSet = {
    BACKBLAZE_ENDPOINT: !!process.env.BACKBLAZE_ENDPOINT,
    BACKBLAZE_BUCKET: !!process.env.BACKBLAZE_BUCKET,
    BACKBLAZE_ACCESS_KEY: !!process.env.BACKBLAZE_ACCESS_KEY,
    BACKBLAZE_SECRET_KEY: !!process.env.BACKBLAZE_SECRET_KEY,
    THUMBNAIL_MAX_AGE_DAYS: !!process.env.THUMBNAIL_MAX_AGE_DAYS,
    SYNC_INTERVAL_HOURS: !!process.env.SYNC_INTERVAL_HOURS,
    AUTO_METADATA_THRESHOLD_MB: !!process.env.AUTO_METADATA_THRESHOLD_MB,
    AUTO_THUMBNAIL_THRESHOLD_MB: !!process.env.AUTO_THUMBNAIL_THRESHOLD_MB,
    SYNC_THROTTLE_SECONDS: !!process.env.SYNC_THROTTLE_SECONDS,
  };

  logger.configOperation(
    `Environment variables loaded - ${Object.entries(envVarsSet).filter(([_, set]) => set).map(([key]) => key).join(', ') || 'none'}`
  );

  try {
    const db = await import("./database");
    const dbConfig = await db.getConfig();

    logger.configOperation(
      `Database configuration loaded - keys: ${Object.keys(dbConfig).join(', ') || 'none'}`
    );

    cachedConfig = {
      ...defaultConfig,
      ...dbConfig,
    };
  } catch (error) {
    logger.configError(
      "Could not load config from database, using environment variables only",
      error as Error,
      {
        source: "database",
      },
    );
    cachedConfig = defaultConfig;
  }

  // Validate the loaded configuration
  const validationErrors = validateConfig(cachedConfig);
  if (validationErrors.length > 0) {
    logger.configError(
      `Configuration validation failed: ${validationErrors.join(', ')}`,
      new Error("Invalid configuration")
    );
    // Don't throw here - let the app start but log warnings
    logger.configInfo(
      `Configuration has validation errors but proceeding: ${validationErrors.join(', ')}`
    );
  }

  logger.configInfo(
    `Configuration loaded successfully - endpoint:${!!cachedConfig.backblaze_endpoint} bucket:${!!cachedConfig.backblaze_bucket} credentials:${!!cachedConfig.backblaze_access_key && !!cachedConfig.backblaze_secret_key}${validationErrors.length > 0 ? ' (with validation errors)' : ''}`
  );

  return cachedConfig;
}

export async function updateConfig(updates: Partial<Config>): Promise<void> {
  try {
    logger.configInfo(
      `Updating configuration - keys: ${Object.keys(updates).join(', ')}`
    );

    const db = await import("./database");
    await db.updateConfig(updates);

    cachedConfig = null;

    logger.configInfo(
      `Configuration updated successfully - keys: ${Object.keys(updates).join(', ')}`
    );
  } catch (error) {
    logger.configError(
      `Failed to update configuration - keys: ${Object.keys(updates).filter(key => !key.toLowerCase().includes('key') && !key.toLowerCase().includes('secret')).join(', ') || 'sensitive keys'}`,
      error as Error
    );
    throw error;
  }
}

export function validateConfig(config: Config): string[] {
  const errors: string[] = [];

  if (!config.backblaze_endpoint) {
    errors.push("Backblaze endpoint is required");
  } else {
    // Validate URL format
    try {
      new URL(config.backblaze_endpoint);
    } catch {
      errors.push(
        "Backblaze endpoint must be a valid URL (e.g., https://s3.us-east-005.backblazeb2.com)",
      );
    }

    // Check for common protocol issues
    if (
      !config.backblaze_endpoint.startsWith("http://") &&
      !config.backblaze_endpoint.startsWith("https://")
    ) {
      errors.push(
        "Backblaze endpoint must include protocol (https:// or http://)",
      );
    }
  }

  if (!config.backblaze_bucket) {
    errors.push("Backblaze bucket is required");
  }

  if (!config.backblaze_access_key) {
    errors.push("Backblaze access key is required");
  }

  if (!config.backblaze_secret_key) {
    errors.push("Backblaze secret key is required");
  }

  if (config.thumbnail_max_age_days < 1) {
    errors.push("Thumbnail max age must be at least 1 day");
  }

  if (config.sync_interval_hours < 1) {
    errors.push("Sync interval must be at least 1 hour");
  }

  if (config.sync_throttle_seconds < 1) {
    errors.push("Sync throttle must be at least 1 second");
  }

  if (config.sync_throttle_seconds > 300) {
    errors.push("Sync throttle should not exceed 5 minutes (300 seconds)");
  }

  return errors;
}

export async function testS3Connection(): Promise<{
  success: boolean;
  error?: string;
  isReadOnly?: boolean;
}> {
  try {
    logger.configInfo("Testing S3 connection (read-only mode)");

    const config = await getConfig();
    const validationErrors = validateConfig(config);

    if (validationErrors.length > 0) {
      const errorMessage = `Configuration validation failed: ${validationErrors.join(", ")}`;
      logger.configError(
        "S3 connection test failed - invalid configuration",
        new Error(errorMessage),
        {
          operation: "testConnection",
          validationErrors,
        },
      );
      return { success: false, error: errorMessage };
    }

    const { testS3ConnectionWith } = await import("./s3");

    const startTime = Date.now();
    const testResult = await testS3ConnectionWith({
      endpoint: config.backblaze_endpoint,
      bucket: config.backblaze_bucket,
      accessKeyId: config.backblaze_access_key,
      secretAccessKey: config.backblaze_secret_key,
    });
    const duration = Date.now() - startTime;
    
    if (!testResult.success) {
      throw new Error(testResult.error);
    }

    logger.configInfo(
      `S3 connection test successful (read-only) - ${config.backblaze_bucket} at ${config.backblaze_endpoint} (${duration}ms)`
    );

    return { success: true, isReadOnly: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Provide helpful error messages for common Backblaze issues
    let detailedError = errorMessage;
    if (errorMessage.includes("Invalid URL")) {
      detailedError =
        "Invalid endpoint URL format. Please ensure your BACKBLAZE_ENDPOINT includes the protocol (e.g., https://s3.us-east-005.backblazeb2.com).";
    } else if (errorMessage.includes("InvalidAccessKeyId")) {
      detailedError =
        "Invalid Backblaze Access Key ID. Please check your credentials.";
    } else if (errorMessage.includes("SignatureDoesNotMatch")) {
      detailedError =
        "Invalid Backblaze Secret Key. Please check your credentials.";
    } else if (errorMessage.includes("NoSuchBucket")) {
      detailedError =
        "Bucket not found. Please check your bucket name and ensure it exists.";
    } else if (errorMessage.includes("AccessDenied")) {
      detailedError =
        "Access denied. Please check your Backblaze key permissions and bucket access settings.";
    } else if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED")
    ) {
      detailedError =
        "Network connection failed. Please check your endpoint URL and internet connectivity.";
    }

    logger.configError(
      `❌ S3 connection test failed: ${detailedError || errorMessage}`,
      error as Error,
    );

    return {
      success: false,
      error: detailedError,
    };
  }
}
