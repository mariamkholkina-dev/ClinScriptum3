-- AlterTable: Add retry/DLQ fields to processing_runs
ALTER TABLE "processing_runs" ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "processing_runs" ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "processing_runs" ADD COLUMN "last_error" TEXT;
ALTER TABLE "processing_runs" ADD COLUMN "retried_from_id" UUID;

-- AlterTable: Add idempotency fields to processing_steps
ALTER TABLE "processing_steps" ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "processing_steps" ADD COLUMN "idempotency_key" TEXT;
