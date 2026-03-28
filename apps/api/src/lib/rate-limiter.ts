import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;
const LLM_MAX_REQUESTS = 20;

export function rateLimiter(maxRequests = MAX_REQUESTS) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", entry.resetAt);

    if (entry.count > maxRequests) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    next();
  };
}

export const apiRateLimiter = rateLimiter(MAX_REQUESTS);
export const llmRateLimiter = rateLimiter(LLM_MAX_REQUESTS);
