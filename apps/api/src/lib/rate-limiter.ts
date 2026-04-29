import type { Request, Response, NextFunction } from "express";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

let redisReady = false;
redis.connect().then(() => { redisReady = true; }).catch(() => {});

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;
const LLM_MAX_REQUESTS = 20;

function getRateLimitKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = JSON.parse(
        Buffer.from(authHeader.slice(7).split(".")[1], "base64url").toString(),
      );
      if (payload.userId) return `rl:user:${payload.userId}`;
    } catch {
      // fall through to IP-based key
    }
  }
  return `rl:ip:${req.ip ?? "unknown"}`;
}

export function rateLimiter(maxRequests = MAX_REQUESTS) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!redisReady) {
      next();
      return;
    }

    const key = getRateLimitKey(req);
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    try {
      const results = await redis
        .multi()
        .zremrangebyscore(key, 0, windowStart)
        .zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
        .zcard(key)
        .pexpire(key, WINDOW_MS)
        .exec();

      const count = (results?.[2]?.[1] as number) ?? 0;

      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - count));
      res.setHeader("X-RateLimit-Reset", now + WINDOW_MS);

      if (count > maxRequests) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
    } catch {
      // Redis error — fail open
    }

    next();
  };
}

export const apiRateLimiter = rateLimiter(MAX_REQUESTS);
export const llmRateLimiter = rateLimiter(LLM_MAX_REQUESTS);
