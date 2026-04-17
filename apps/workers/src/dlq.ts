import { Queue } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { prisma } from "@clinscriptum/db";
import { logger } from "./lib/logger.js";

let dlqQueue: Queue | null = null;

export function initDLQ(connection: Redis): Queue {
  dlqQueue = new Queue("processing-dlq", { connection });
  return dlqQueue;
}

export function getDLQ(): Queue {
  if (!dlqQueue) throw new Error("DLQ not initialized");
  return dlqQueue;
}

export async function moveToDeadLetter(
  job: Job,
  error: Error,
): Promise<void> {
  const dlq = getDLQ();

  await dlq.add("dead_letter", {
    originalJobName: job.name,
    originalJobData: job.data,
    error: error.message,
    attemptsMade: job.attemptsMade,
    failedAt: new Date().toISOString(),
  });

  if (job.data.processingRunId) {
    await prisma.processingRun.update({
      where: { id: job.data.processingRunId },
      data: {
        status: "failed",
        lastError: `Exhausted ${job.attemptsMade} attempts: ${error.message}`,
      },
    }).catch((e) => {
      logger.warn("Failed to update processing run after DLQ move", {
        processingRunId: job.data.processingRunId,
        error: (e as Error).message,
      });
    });
  }

  logger.error("Job moved to dead-letter queue", {
    originalJobName: job.name,
    attemptsMade: job.attemptsMade,
    error: error.message,
  });
}

export async function listDeadLetters(limit = 50, offset = 0) {
  const dlq = getDLQ();
  const jobs = await dlq.getJobs(["waiting", "delayed", "completed", "failed"], offset, offset + limit - 1);
  return jobs.map((j) => ({
    id: j.id,
    data: j.data,
    timestamp: j.timestamp,
  }));
}
