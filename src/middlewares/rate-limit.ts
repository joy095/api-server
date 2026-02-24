import { Context, Next } from "hono";
import { AppError } from "../lib/response";

type RateLimitOptions = {
  windowMs: number; // window duration in ms
  max: number; // max requests per window
  keyFn?: (c: Context) => string; // defaults to IP
  message?: string;
};

type BucketEntry = {
  count: number;
  resetAt: number;
};

/**
 * In-memory rate limiter.
 * For multi-instance deployments, swap the Map for a Redis-backed store.
 */
export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = "Too many requests, please slow down.",
  } = options;

  const store = new Map<string, BucketEntry>();

  return async (c: Context, next: Next) => {
    const key = options.keyFn
      ? options.keyFn(c)
      : (c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for") ??
        "unknown");

    const now = Date.now();

    const entry = store.get(key);

    // Remove expired entry
    if (entry && now > entry.resetAt) {
      store.delete(key);
    }

    const current = store.get(key);

    if (!current) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      c.header("X-RateLimit-Limit", String(max));
      c.header("X-RateLimit-Remaining", String(max - 1));
      return next();
    }

    if (current.count >= max) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(max));
      c.header("X-RateLimit-Remaining", "0");
      throw new AppError(message, 429);
    }

    current.count++;
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(max - current.count));

    return next();
  };
}

// ── Preset limiters ────────────────────────────────────────────────────────────

/** General API: 100 req / min */
export const apiLimiter = rateLimit({ windowMs: 60_000, max: 100 });

/** Auth endpoints: 10 req / 15 min */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Too many auth attempts. Try again in 15 minutes.",
});

/** Booking creation: 20 req / min per IP */
export const bookingLimiter = rateLimit({ windowMs: 60_000, max: 20 });
