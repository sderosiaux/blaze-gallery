import { Config } from "@/types";
import { logger } from "./logger";

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  logger.configInfo("Loading configuration from environment variables");

  const storageMode = (process.env.THUMBNAIL_STORAGE || "local").toLowerCase();
  const normalizedStorageMode: "local" | "s3" =
    storageMode === "s3" ? "s3" : "local";
  const thumbnailPrefix = process.env.THUMBNAIL_S3_PREFIX || "thumbnails";

  const defaultConfig: Config = {
    backblaze_endpoint: process.env.BACKBLAZE_ENDPOINT || "",
    backblaze_bucket: process.env.BACKBLAZE_BUCKET || "",
    backblaze_access_key: process.env.BACKBLAZE_ACCESS_KEY || "",
    backblaze_secret_key: process.env.BACKBLAZE_SECRET_KEY || "",
    thumbnail_storage: normalizedStorageMode,
    thumbnail_s3_endpoint: process.env.THUMBNAIL_S3_ENDPOINT || undefined,
    thumbnail_s3_bucket: process.env.THUMBNAIL_S3_BUCKET || undefined,
    thumbnail_s3_access_key: process.env.THUMBNAIL_S3_ACCESS_KEY || undefined,
    thumbnail_s3_secret_key: process.env.THUMBNAIL_S3_SECRET_KEY || undefined,
    thumbnail_s3_prefix: thumbnailPrefix,
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
    THUMBNAIL_STORAGE: !!process.env.THUMBNAIL_STORAGE,
    THUMBNAIL_S3_ENDPOINT: !!process.env.THUMBNAIL_S3_ENDPOINT,
    THUMBNAIL_S3_BUCKET: !!process.env.THUMBNAIL_S3_BUCKET,
    THUMBNAIL_S3_ACCESS_KEY: !!process.env.THUMBNAIL_S3_ACCESS_KEY,
    THUMBNAIL_S3_SECRET_KEY: !!process.env.THUMBNAIL_S3_SECRET_KEY,
    THUMBNAIL_S3_PREFIX: !!process.env.THUMBNAIL_S3_PREFIX,
    THUMBNAIL_MAX_AGE_DAYS: !!process.env.THUMBNAIL_MAX_AGE_DAYS,
    SYNC_INTERVAL_HOURS: !!process.env.SYNC_INTERVAL_HOURS,
    AUTO_METADATA_THRESHOLD_MB: !!process.env.AUTO_METADATA_THRESHOLD_MB,
    AUTO_THUMBNAIL_THRESHOLD_MB: !!process.env.AUTO_THUMBNAIL_THRESHOLD_MB,
    SYNC_THROTTLE_SECONDS: !!process.env.SYNC_THROTTLE_SECONDS,
  };

  logger.configOperation(
    `Environment variables loaded - ${
      Object.entries(envVarsSet)
        .filter(([_, set]) => set)
        .map(([key]) => key)
        .join(", ") || "none"
    }`,
  );

  // Configuration is now loaded entirely from environment variables
  logger.configOperation(
    "Configuration loaded from environment variables only",
  );
  cachedConfig = defaultConfig;

  // Validate the loaded configuration
  const validationErrors = validateConfig(cachedConfig);
  if (validationErrors.length > 0) {
    logger.configError(
      `Configuration validation failed: ${validationErrors.join(", ")}`,
      new Error("Invalid configuration"),
    );
    // Don't throw here - let the app start but log warnings
    logger.configInfo(
      `Configuration has validation errors but proceeding: ${validationErrors.join(", ")}`,
    );
  }

  logger.configInfo(
    `Configuration loaded successfully - endpoint:${!!cachedConfig.backblaze_endpoint} bucket:${!!cachedConfig.backblaze_bucket} credentials:${!!cachedConfig.backblaze_access_key && !!cachedConfig.backblaze_secret_key}${validationErrors.length > 0 ? " (with validation errors)" : ""}`,
  );

  return cachedConfig;
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

  if (!["local", "s3"].includes(config.thumbnail_storage)) {
    errors.push("Thumbnail storage must be either 'local' or 's3'");
  }

  if (config.thumbnail_storage === "s3") {
    if (!config.thumbnail_s3_prefix) {
      errors.push("Thumbnail S3 prefix is required when using S3 storage");
    }
    // Validate separate thumbnail S3 config if provided (for R2 or other S3-compatible storage)
    if (
      config.thumbnail_s3_endpoint ||
      config.thumbnail_s3_bucket ||
      config.thumbnail_s3_access_key ||
      config.thumbnail_s3_secret_key
    ) {
      // If any thumbnail S3 config is set, all must be set
      if (!config.thumbnail_s3_endpoint) {
        errors.push(
          "Thumbnail S3 endpoint is required when using separate thumbnail storage",
        );
      } else {
        try {
          new URL(config.thumbnail_s3_endpoint);
        } catch {
          errors.push("Thumbnail S3 endpoint must be a valid URL");
        }
      }
      if (!config.thumbnail_s3_bucket) {
        errors.push(
          "Thumbnail S3 bucket is required when using separate thumbnail storage",
        );
      }
      if (!config.thumbnail_s3_access_key) {
        errors.push(
          "Thumbnail S3 access key is required when using separate thumbnail storage",
        );
      }
      if (!config.thumbnail_s3_secret_key) {
        errors.push(
          "Thumbnail S3 secret key is required when using separate thumbnail storage",
        );
      }
    }
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

    const config = getConfig();
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
      `S3 connection test successful (read-only) - ${config.backblaze_bucket} at ${config.backblaze_endpoint} (${duration}ms)`,
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
