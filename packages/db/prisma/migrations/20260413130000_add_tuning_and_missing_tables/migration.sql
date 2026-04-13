-- AlterTable: findings — add missing columns
ALTER TABLE "findings"
  ADD COLUMN IF NOT EXISTS "extra_attributes" JSONB NOT NULL DEFAULT '{}';

-- CreateEnum: TuningType
DO $$ BEGIN
  CREATE TYPE "TuningType" AS ENUM ('section_classification', 'fact_extraction', 'soa_detection', 'icf_generation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum: TuningSessionStatus
DO $$ BEGIN
  CREATE TYPE "TuningSessionStatus" AS ENUM ('processing', 'pending_review', 'in_review', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable: tuning_sessions
CREATE TABLE IF NOT EXISTS "tuning_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "type" "TuningType" NOT NULL,
    "status" "TuningSessionStatus" NOT NULL DEFAULT 'processing',
    "is_golden_set" BOOLEAN NOT NULL DEFAULT false,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "generated_doc_id" UUID,

    CONSTRAINT "tuning_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: section_verdicts
CREATE TABLE IF NOT EXISTS "section_verdicts" (
    "id" UUID NOT NULL,
    "tuning_session_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "algo_result" TEXT,
    "algo_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "llm_result" TEXT,
    "llm_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "auditor_choice" TEXT,
    "auditor_agreed_with" TEXT,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "section_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: fact_verdicts
CREATE TABLE IF NOT EXISTS "fact_verdicts" (
    "id" UUID NOT NULL,
    "tuning_session_id" UUID NOT NULL,
    "fact_id" UUID,
    "fact_key" TEXT NOT NULL,
    "llm_value" TEXT,
    "llm_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_correct" BOOLEAN,
    "auditor_value" TEXT,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "fact_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: soa_verdicts
CREATE TABLE IF NOT EXISTS "soa_verdicts" (
    "id" UUID NOT NULL,
    "tuning_session_id" UUID NOT NULL,
    "soa_table_id" UUID,
    "is_correct_detection" BOOLEAN,
    "missed_tables" JSONB NOT NULL DEFAULT '[]',
    "false_positives" JSONB NOT NULL DEFAULT '[]',
    "cell_verdicts" JSONB NOT NULL DEFAULT '[]',
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "soa_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: generation_verdicts
CREATE TABLE IF NOT EXISTS "generation_verdicts" (
    "id" UUID NOT NULL,
    "tuning_session_id" UUID NOT NULL,
    "generated_doc_section_id" UUID NOT NULL,
    "section_title" TEXT NOT NULL DEFAULT '',
    "standard_section" TEXT,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "generation_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "tuning_sessions_tenant_id_idx" ON "tuning_sessions"("tenant_id");
CREATE INDEX IF NOT EXISTS "tuning_sessions_doc_version_id_idx" ON "tuning_sessions"("doc_version_id");
CREATE INDEX IF NOT EXISTS "section_verdicts_tuning_session_id_idx" ON "section_verdicts"("tuning_session_id");
CREATE INDEX IF NOT EXISTS "fact_verdicts_tuning_session_id_idx" ON "fact_verdicts"("tuning_session_id");
CREATE INDEX IF NOT EXISTS "soa_verdicts_tuning_session_id_idx" ON "soa_verdicts"("tuning_session_id");
CREATE INDEX IF NOT EXISTS "generation_verdicts_tuning_session_id_idx" ON "generation_verdicts"("tuning_session_id");

-- AddForeignKeys
ALTER TABLE "tuning_sessions" DROP CONSTRAINT IF EXISTS "tuning_sessions_doc_version_id_fkey";
ALTER TABLE "tuning_sessions" ADD CONSTRAINT "tuning_sessions_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tuning_sessions" DROP CONSTRAINT IF EXISTS "tuning_sessions_generated_doc_id_fkey";
ALTER TABLE "tuning_sessions" ADD CONSTRAINT "tuning_sessions_generated_doc_id_fkey" FOREIGN KEY ("generated_doc_id") REFERENCES "generated_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "section_verdicts" DROP CONSTRAINT IF EXISTS "section_verdicts_tuning_session_id_fkey";
ALTER TABLE "section_verdicts" ADD CONSTRAINT "section_verdicts_tuning_session_id_fkey" FOREIGN KEY ("tuning_session_id") REFERENCES "tuning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fact_verdicts" DROP CONSTRAINT IF EXISTS "fact_verdicts_tuning_session_id_fkey";
ALTER TABLE "fact_verdicts" ADD CONSTRAINT "fact_verdicts_tuning_session_id_fkey" FOREIGN KEY ("tuning_session_id") REFERENCES "tuning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "soa_verdicts" DROP CONSTRAINT IF EXISTS "soa_verdicts_tuning_session_id_fkey";
ALTER TABLE "soa_verdicts" ADD CONSTRAINT "soa_verdicts_tuning_session_id_fkey" FOREIGN KEY ("tuning_session_id") REFERENCES "tuning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "generation_verdicts" DROP CONSTRAINT IF EXISTS "generation_verdicts_tuning_session_id_fkey";
ALTER TABLE "generation_verdicts" ADD CONSTRAINT "generation_verdicts_tuning_session_id_fkey" FOREIGN KEY ("tuning_session_id") REFERENCES "tuning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
