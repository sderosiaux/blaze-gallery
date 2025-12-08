interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;

    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const key = identifier;
    const current = this.requests.get(key);

    if (!current) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (now > current.resetTime) {
      this.requests.set(key, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (current.count >= this.maxRequests) {
      return false;
    }

    current.count++;
    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  getStats(identifier: string): {
    count: number;
    remaining: number;
    resetTime: number;
  } {
    const entry = this.requests.get(identifier);
    if (!entry) {
      return {
        count: 0,
        remaining: this.maxRequests,
        resetTime: Date.now() + this.windowMs,
      };
    }

    return {
      count: entry.count,
      remaining: Math.max(0, this.maxRequests - entry.count),
      resetTime: entry.resetTime,
    };
  }
}

// Global rate limiter instances
export const thumbnailRateLimiter = new RateLimiter(60000, 200); // 200 requests per minute
export const strictRateLimiter = new RateLimiter(60000, 50); // 50 requests per minute for strict endpoints
