import { s3AuditLogger } from "./s3Audit";
import { logger } from "./logger";
import * as cron from "node-cron";

export class AuditCleanupManager {
  private static instance: AuditCleanupManager;
  private retentionDays: number;
  private enabled: boolean;
  private schedule: string;
  private scheduledTask?: cron.ScheduledTask;

  private constructor() {
    // Configuration from environment variables
    this.retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS || "30");
    this.enabled = process.env.AUDIT_CLEANUP_ENABLED !== "false";
    this.schedule = process.env.AUDIT_CLEANUP_SCHEDULE || "0 2 * * *"; // Daily at 2 AM
  }

  static getInstance(): AuditCleanupManager {
    if (!AuditCleanupManager.instance) {
      AuditCleanupManager.instance = new AuditCleanupManager();
    }
    return AuditCleanupManager.instance;
  }

  /**
   * Perform automatic cleanup
   */
  private async performCleanup(): Promise<void> {
    try {
      logger.info(
        `Starting automatic S3 audit cleanup: deleting records older than ${this.retentionDays} days`,
      );

      const deletedCount = await s3AuditLogger.cleanupOldLogs(
        this.retentionDays,
      );

      if (deletedCount > 0) {
        logger.info(
          `S3 audit cleanup completed: ${deletedCount} records deleted (retention: ${this.retentionDays} days)`,
        );
      } else {
        logger.debug("S3 audit cleanup completed: no old records to delete");
      }
    } catch (error) {
      logger.error(
        "Failed to perform automatic S3 audit cleanup",
        error as Error,
      );
    }
  }

  /**
   * Start automatic scheduled cleanup
   */
  startScheduledCleanup(): void {
    if (!this.enabled || this.scheduledTask) {
      return;
    }

    try {
      this.scheduledTask = cron.schedule(
        this.schedule,
        async () => {
          await this.performCleanup();
        },
        {
          timezone: "UTC",
        },
      );

      logger.info(
        `S3 audit automatic cleanup started (schedule: ${this.schedule}, retention: ${this.retentionDays} days, timezone: UTC)`,
      );
    } catch (error) {
      logger.error(
        "Failed to start automatic S3 audit cleanup",
        error as Error,
      );
    }
  }

  /**
   * Stop automatic scheduled cleanup
   */
  stopScheduledCleanup(): void {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask.destroy();
      this.scheduledTask = undefined;

      logger.info("S3 audit automatic cleanup stopped");
    }
  }
}

// Export singleton instance
export const auditCleanupManager = AuditCleanupManager.getInstance();

// Auto-start cleanup if enabled (only in production)
if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "development") {
  // Delay startup to allow app to fully initialize
  setTimeout(() => {
    auditCleanupManager.startScheduledCleanup();
  }, 5000);
}
