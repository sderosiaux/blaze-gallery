import { query } from "./database";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Database-backed rate limiter for serverless deployments
 * Uses PostgreSQL to store rate limit state across instances
 */
class DatabaseRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly tableName = "rate_limits";
  private initialized = false;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Ensure the rate_limits table exists
   */
  private async ensureTable(): Promise<void> {
    if (this.initialized) return;

    try {
      await query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          identifier VARCHAR(255) PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 1,
          reset_time BIGINT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index for cleanup queries
      await query(`
        CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_time
        ON rate_limits(reset_time)
      `);

      this.initialized = true;
    } catch (error) {
      // Table might already exist, that's fine
      console.error("[RATE_LIMITER] Error ensuring table:", error);
      this.initialized = true;
    }
  }

  async isAllowed(identifier: string): Promise<boolean> {
    await this.ensureTable();

    const now = Date.now();
    const resetTime = now + this.windowMs;

    try {
      // Try to insert or update the rate limit entry atomically
      const result = await query(
        `
        INSERT INTO rate_limits (identifier, count, reset_time)
        VALUES ($1, 1, $2)
        ON CONFLICT (identifier) DO UPDATE
        SET
          count = CASE
            WHEN rate_limits.reset_time < $3 THEN 1
            ELSE rate_limits.count + 1
          END,
          reset_time = CASE
            WHEN rate_limits.reset_time < $3 THEN $2
            ELSE rate_limits.reset_time
          END
        RETURNING count, reset_time
      `,
        [identifier, resetTime, now]
      );

      const entry = result.rows[0];
      return entry.count <= this.maxRequests;
    } catch (error) {
      console.error("[RATE_LIMITER] Error checking rate limit:", error);
      // On error, allow the request (fail open)
      return true;
    }
  }

  async getStats(identifier: string): Promise<{
    count: number;
    remaining: number;
    resetTime: number;
  }> {
    await this.ensureTable();

    const now = Date.now();

    try {
      const result = await query(
        `SELECT count, reset_time FROM rate_limits WHERE identifier = $1`,
        [identifier]
      );

      if (result.rows.length === 0 || result.rows[0].reset_time < now) {
        return {
          count: 0,
          remaining: this.maxRequests,
          resetTime: now + this.windowMs,
        };
      }

      const entry = result.rows[0];
      return {
        count: entry.count,
        remaining: Math.max(0, this.maxRequests - entry.count),
        resetTime: parseInt(entry.reset_time),
      };
    } catch (error) {
      console.error("[RATE_LIMITER] Error getting stats:", error);
      return {
        count: 0,
        remaining: this.maxRequests,
        resetTime: now + this.windowMs,
      };
    }
  }

  /**
   * Cleanup expired entries (call periodically from a cron job or API route)
   */
  async cleanup(): Promise<number> {
    await this.ensureTable();

    const now = Date.now();

    try {
      const result = await query(
        `DELETE FROM rate_limits WHERE reset_time < $1`,
        [now]
      );
      return result.rowCount || 0;
    } catch (error) {
      console.error("[RATE_LIMITER] Error during cleanup:", error);
      return 0;
    }
  }
}

// Global rate limiter instances
export const thumbnailRateLimiter = new DatabaseRateLimiter(5000, 200); // 200 requests per 5 seconds (for browsing large folders)
export const strictRateLimiter = new DatabaseRateLimiter(60000, 50); // 50 requests per minute for strict endpoints
