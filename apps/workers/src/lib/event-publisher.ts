import { Redis } from "ioredis";
import { PROCESSING_EVENTS_CHANNEL } from "@clinscriptum/shared";
import type { ProcessingEvent } from "@clinscriptum/shared";
import { logger } from "./logger.js";

let publisher: Redis | null = null;

export function initEventPublisher(redisUrl: string) {
  publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  publisher.on("error", (err) => {
    logger.warn("Event publisher Redis error", { error: err.message });
  });
}

export async function publishProcessingEvent(event: ProcessingEvent): Promise<void> {
  if (!publisher) return;
  try {
    await publisher.publish(PROCESSING_EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn("Failed to publish processing event", { error: (err as Error).message });
  }
}

export function closeEventPublisher() {
  publisher?.disconnect();
  publisher = null;
}
