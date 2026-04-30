import { Worker } from "bullmq";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { asyncContext } from "@clinscriptum/shared";
import { logger } from "./lib/logger.js";
import { getRetryConfig } from "./lib/retry-config.js";
import { initDLQ, moveToDeadLetter } from "./dlq.js";
import { recoverStaleRuns } from "./lib/startup-recovery.js";
import { initEventPublisher, closeEventPublisher } from "./lib/event-publisher.js";
import { handleParseDocument } from "./handlers/parse-document.js";
import { handleClassifySections } from "./handlers/classify-sections.js";
import { handleExtractFacts } from "./handlers/extract-facts.js";
import { handleIntraDocAudit } from "./handlers/intra-doc-audit.js";
import { handleGenerateICF } from "./handlers/generate-icf.js";
import { handleGenerateCSR } from "./handlers/generate-csr.js";
import { handleRunEvaluation } from "./handlers/run-evaluation.js";
import { handleRunBatchEvaluation } from "./handlers/run-batch-evaluation.js";
import { handleAnalyzeCorrections } from "./handlers/analyze-corrections.js";
import { handleRunPipeline } from "./handlers/run-pipeline.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

initEventPublisher(redisUrl);

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
        case "run_evaluation":
          return handleRunEvaluation(job.data);
        case "run_batch_evaluation":
          return handleRunBatchEvaluation(job.data);
        case "analyze_corrections":
          return handleAnalyzeCorrections(job.data);
        case "run_pipeline":
          return handleRunPipeline(job.data);
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

async function shutdown() {
  logger.info("Worker shutting down...");
  await worker.close();
  closeEventPublisher();
  connection.disconnect();
  const { prisma } = await import("@clinscriptum/db");
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { error: String(reason) });
});

logger.info("Workers started, waiting for jobs...");

export function addJob(name: string, data: Record<string, unknown>) {
  const config = getRetryConfig(name);
  return processingQueue.add(name, data, {
    attempts: config.attempts,
    backoff: config.backoff,
  });
}
