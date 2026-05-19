/**
 * Sliding-window rate limiter.
 *
 * Tracks request timestamps per key in memory. Each check() call prunes
 * timestamps older than the window, then either allows or rejects.
 * Safe for single-process use; no persistence needed.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** How many requests remain in the current window. */
  remaining: number;
  /** How many ms until the oldest request falls outside the window. */
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string | number, number[]>();
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    /** Maximum requests allowed in the window. */
    private readonly maxRequests: number,
    /** Window length in milliseconds. */
    private readonly windowMs: number,
  ) {
    // Prune stale entries every 5 minutes to prevent unbounded memory growth.
    this.pruneTimer = setInterval(() => this.prune(), 5 * 60 * 1000);
    this.pruneTimer.unref?.();
  }

  check(key: string | number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    const prev = this.windows.get(key) ?? [];
    const active = prev.filter((t) => t > cutoff);

    if (active.length >= this.maxRequests) {
      const oldest = active[0]!;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: oldest + this.windowMs - now,
      };
    }

    active.push(now);
    this.windows.set(key, active);
    return {
      allowed: true,
      remaining: this.maxRequests - active.length,
      retryAfterMs: 0,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) this.windows.delete(key);
      else this.windows.set(key, filtered);
    }
  }

  dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    this.windows.clear();
  }
}
