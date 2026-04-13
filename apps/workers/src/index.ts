import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { handleParseDocument } from "./handlers/parse-document.js";
import { handleClassifySections } from "./handlers/classify-sections.js";
import { handleExtractFacts } from "./handlers/extract-facts.js";
import { handleIntraDocAudit } from "./handlers/intra-doc-audit.js";
import { handleGenerateICF } from "./handlers/generate-icf.js";
import { handleGenerateCSR } from "./handlers/generate-csr.js";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const processingQueue = new Queue("processing", { connection });

const worker = new Worker(
  "processing",
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.name}`, job.data);

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
        console.warn(`Unknown job type: ${job.name}`);
    }
  },
  { connection, concurrency: 5 }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

console.log("Workers started, waiting for jobs...");
