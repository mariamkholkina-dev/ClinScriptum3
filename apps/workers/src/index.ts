import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { handleParseDocument } from "./handlers/parse-document.js";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
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
        console.log("Section classification (Phase 3)");
        break;
      case "extract_facts":
        console.log("Fact extraction (Phase 3)");
        break;
      case "intra_doc_audit":
        console.log("Intra-document audit (Phase 4)");
        break;
      case "generate_icf":
        console.log("ICF generation (Phase 6)");
        break;
      case "generate_csr":
        console.log("CSR generation (Phase 6)");
        break;
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
