import { Worker } from "bullmq";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { asyncContext } from "@clinscriptum/shared";
import { logger } from "./lib/logger.js";
import { getRetryConfig } from "./lib/retry-config.js";
import { initDLQ, moveToDeadLetter } from "./dlq.js";
import { recoverStaleRuns } from "./lib/startup-recovery.js";
import { handleParseDocument } from "./handlers/parse-document.js";
import { handleClassifySections } from "./handlers/classify-sections.js";
import { handleExtractFacts } from "./handlers/extract-facts.js";
import { handleIntraDocAudit } from "./handlers/intra-doc-audit.js";
import { handleGenerateICF } from "./handlers/generate-icf.js";
import { handleGenerateCSR } from "./handlers/generate-csr.js";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const processingQueue = new Queue("processing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

initDLQ(connection);

const worker = new Worker(
  "processing",
  async (job) => {
    const correlationId = job.data.correlationId ?? job.id ?? "unknown";

    await asyncContext.run({ correlationId }, async () => {
      logger.info(`Processing job ${job.id}: ${job.name}`, {
        jobName: job.name,
        attempt: job.attemptsMade + 1,
      });

      switch (job.name) {
        case "parse_document":
          return handleParseDocument(job.data);
        case "classify_sections":
          return handleClassifySections(job.data);
        case "extract_facts":
          return handleExtractFacts(job.data);
        case "intra_doc_audit":
          return handleIntraDocAudit(job.data);
        case "generate_icf":
          return handleGenerateICF(job.data);
        case "generate_csr":
          return handleGenerateCSR(job.data);
        default:
          logger.warn(`Unknown job type: ${job.name}`);
      }
    });
  },
  { connection, concurrency: 5 },
);

worker.on("completed", (job) => {
  logger.info(`Job ${job.id} completed`, { jobName: job.name });
});

worker.on("failed", (job, err) => {
  if (!job) return;

  const config = getRetryConfig(job.name);

  if (job.attemptsMade >= config.attempts) {
    moveToDeadLetter(job, err).catch((dlqErr) => {
      logger.error("Failed to move job to DLQ", {
        jobId: job.id,
        error: (dlqErr as Error).message,
      });
    });
  } else {
    logger.warn(`Job ${job.id} failed (attempt ${job.attemptsMade}/${config.attempts}), will retry`, {
      jobName: job.name,
      error: err.message,
    });
  }
});

recoverStaleRuns().catch((err) => {
  logger.error("Startup recovery failed", { error: (err as Error).message });
});

logger.info("Workers started, waiting for jobs...");

export function addJob(name: string, data: Record<string, unknown>) {
  const config = getRetryConfig(name);
  return processingQueue.add(name, data, {
    attempts: config.attempts,
    backoff: config.backoff,
  });
}
