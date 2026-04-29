import { Redis } from "ioredis";
import type { Request, Response } from "express";
import { PROCESSING_EVENTS_CHANNEL } from "@clinscriptum/shared";
import type { ProcessingEvent } from "@clinscriptum/shared";
import { verifyAccessToken } from "./auth.js";
import { logger } from "./logger.js";

export function handleProcessingSSE(req: Request, res: Response) {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    (req.query.token as string);

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let user: { userId: string; tenantId: string };
  try {
    user = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const { docVersionId } = req.params;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":\n\n");
  res.flushHeaders();

  const subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  subscriber.subscribe(PROCESSING_EVENTS_CHANNEL).catch((err) => {
    logger.warn("SSE Redis subscribe failed", { error: err.message });
  });

  subscriber.on("message", (_channel: string, message: string) => {
    try {
      const event: ProcessingEvent = JSON.parse(message);
      if (event.tenantId !== user.tenantId) return;
      if (docVersionId && event.docVersionId !== docVersionId) return;

      res.write(`event: ${event.type}\ndata: ${message}\n\n`);
    } catch {
      // ignore malformed messages
    }
  });

  const heartbeat = setInterval(() => {
    res.write(":\n\n");
  }, 30_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe().catch(() => {});
    subscriber.disconnect();
  };

  req.on("close", cleanup);
  req.on("error", cleanup);
}
