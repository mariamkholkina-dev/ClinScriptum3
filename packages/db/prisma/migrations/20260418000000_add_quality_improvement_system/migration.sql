-- CreateEnum
CREATE TYPE "RuleSubStage" AS ENUM ('analysis', 'qa');

-- CreateEnum
CREATE TYPE "ContextStrategy" AS ENUM ('chunk', 'multi_chunk', 'full_document', 'multi_document');

-- CreateEnum
CREATE TYPE "GoldenSampleType" AS ENUM ('single_document', 'multi_document');

-- CreateEnum
CREATE TYPE "GoldenStageStatus" AS ENUM ('draft', 'in_review', 'approved');

-- CreateEnum
CREATE TYPE "EvaluationRunType" AS ENUM ('single', 'batch', 'llm_comparison', 'context_window_test');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "EvaluationResultStatus" AS ENUM ('pending', 'pass', 'fail', 'error', 'skipped');

-- CreateEnum
CREATE TYPE "CorrectionRecommendationStatus" AS ENUM ('pending', 'accepted', 'rejected', 'implemented');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('rule_change', 'prompt_change', 'golden_sample_approval', 'verdict_approval');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum: RuleSetType
ALTER TYPE "RuleSetType" ADD VALUE 'section_classification_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'fact_extraction_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'soa_detection';
ALTER TYPE "RuleSetType" ADD VALUE 'soa_detection_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'intra_audit';
ALTER TYPE "RuleSetType" ADD VALUE 'intra_audit_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'inter_audit';
ALTER TYPE "RuleSetType" ADD VALUE 'inter_audit_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'fact_audit_intra';
ALTER TYPE "RuleSetType" ADD VALUE 'fact_audit_intra_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'fact_audit_inter';
ALTER TYPE "RuleSetType" ADD VALUE 'fact_audit_inter_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'generation';
ALTER TYPE "RuleSetType" ADD VALUE 'generation_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'impact_analysis';
ALTER TYPE "RuleSetType" ADD VALUE 'impact_analysis_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'change_classification';
ALTER TYPE "RuleSetType" ADD VALUE 'change_classification_qa';
ALTER TYPE "RuleSetType" ADD VALUE 'correction_recommend';

-- AlterEnum: UserRole
ALTER TYPE "UserRole" ADD VALUE 'rule_approver';

-- AlterTable: rules (add new fields)
ALTER TABLE "rules" ADD COLUMN "document_type" "DocumentType",
ADD COLUMN "is_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "prompt_template" TEXT,
ADD COLUMN "requires_facts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requires_soa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "stage" TEXT,
ADD COLUMN "sub_stage" "RuleSubStage";

-- CreateTable: llm_configs
CREATE TABLE "llm_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "base_url" TEXT NOT NULL DEFAULT '',
    "api_key" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "max_output_tokens" INTEGER NOT NULL DEFAULT 2048,
    "max_input_tokens" INTEGER,
    "context_strategy" "ContextStrategy" NOT NULL DEFAULT 'chunk',
    "chunk_size_chars" INTEGER,
    "chunk_overlap_chars" INTEGER,
    "model_window_chars" INTEGER,
    "rate_limit" INTEGER,
    "timeout_ms" INTEGER,
    "cold_start_ms" INTEGER,
    "cost_per_input_k_tokens" DOUBLE PRECISION,
    "cost_per_output_k_tokens" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "llm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: golden_samples
CREATE TABLE "golden_samples" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sample_type" "GoldenSampleType" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "golden_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable: golden_sample_documents
CREATE TABLE "golden_sample_documents" (
    "id" UUID NOT NULL,
    "golden_sample_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "golden_sample_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: golden_sample_stage_statuses
CREATE TABLE "golden_sample_stage_statuses" (
    "id" UUID NOT NULL,
    "golden_sample_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "GoldenStageStatus" NOT NULL DEFAULT 'draft',
    "expected_results" JSONB NOT NULL DEFAULT '{}',
    "reviewed_by_id" UUID,
    "approved_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    CONSTRAINT "golden_sample_stage_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable: evaluation_runs
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT,
    "type" "EvaluationRunType" NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'queued',
    "rule_set_version_id" UUID,
    "llm_config_id" UUID,
    "context_strategy_override" "ContextStrategy",
    "chunk_size_chars_override" INTEGER,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "cost" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "total_samples" INTEGER NOT NULL DEFAULT 0,
    "passed_samples" INTEGER NOT NULL DEFAULT 0,
    "failed_samples" INTEGER NOT NULL DEFAULT 0,
    "compared_to_run_id" UUID,
    "delta" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: evaluation_results
CREATE TABLE "evaluation_results" (
    "id" UUID NOT NULL,
    "evaluation_run_id" UUID NOT NULL,
    "golden_sample_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "status" "EvaluationResultStatus" NOT NULL DEFAULT 'pending',
    "expected" JSONB NOT NULL DEFAULT '{}',
    "actual" JSONB NOT NULL DEFAULT '{}',
    "diff" JSONB NOT NULL DEFAULT '{}',
    "algo_result" JSONB,
    "llm_result" JSONB,
    "algo_llm_agreement" BOOLEAN,
    "precision" DOUBLE PRECISION,
    "recall" DOUBLE PRECISION,
    "f1" DOUBLE PRECISION,
    "latency_ms" INTEGER,
    "token_cost" DOUBLE PRECISION,
    CONSTRAINT "evaluation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable: correction_records
CREATE TABLE "correction_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" TEXT NOT NULL,
    "document_version_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "original_value" JSONB NOT NULL,
    "corrected_value" JSONB NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "is_processed" BOOLEAN NOT NULL DEFAULT false,
    "recommendation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "correction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable: correction_recommendations
CREATE TABLE "correction_recommendations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "suggested_change" TEXT NOT NULL,
    "affected_rule_id" UUID,
    "status" "CorrectionRecommendationStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "correction_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: approval_requests
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requested_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "comment" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_configs_task_id_idx" ON "llm_configs"("task_id");
CREATE INDEX "golden_samples_tenant_id_idx" ON "golden_samples"("tenant_id");
CREATE INDEX "golden_sample_documents_golden_sample_id_idx" ON "golden_sample_documents"("golden_sample_id");
CREATE UNIQUE INDEX "golden_sample_stage_statuses_golden_sample_id_stage_key" ON "golden_sample_stage_statuses"("golden_sample_id", "stage");
CREATE INDEX "evaluation_runs_tenant_id_idx" ON "evaluation_runs"("tenant_id");
CREATE INDEX "evaluation_results_evaluation_run_id_idx" ON "evaluation_results"("evaluation_run_id");
CREATE INDEX "evaluation_results_golden_sample_id_idx" ON "evaluation_results"("golden_sample_id");
CREATE INDEX "correction_records_tenant_id_idx" ON "correction_records"("tenant_id");
CREATE INDEX "correction_records_stage_idx" ON "correction_records"("stage");
CREATE INDEX "correction_records_is_processed_idx" ON "correction_records"("is_processed");
CREATE INDEX "correction_recommendations_tenant_id_idx" ON "correction_recommendations"("tenant_id");
CREATE INDEX "correction_recommendations_status_idx" ON "correction_recommendations"("status");
CREATE INDEX "approval_requests_tenant_id_idx" ON "approval_requests"("tenant_id");
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- AddForeignKey
ALTER TABLE "golden_samples" ADD CONSTRAINT "golden_samples_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "golden_sample_documents" ADD CONSTRAINT "golden_sample_documents_golden_sample_id_fkey" FOREIGN KEY ("golden_sample_id") REFERENCES "golden_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "golden_sample_documents" ADD CONSTRAINT "golden_sample_documents_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "golden_sample_stage_statuses" ADD CONSTRAINT "golden_sample_stage_statuses_golden_sample_id_fkey" FOREIGN KEY ("golden_sample_id") REFERENCES "golden_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "golden_sample_stage_statuses" ADD CONSTRAINT "golden_sample_stage_statuses_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "golden_sample_stage_statuses" ADD CONSTRAINT "golden_sample_stage_statuses_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_llm_config_id_fkey" FOREIGN KEY ("llm_config_id") REFERENCES "llm_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_compared_to_run_id_fkey" FOREIGN KEY ("compared_to_run_id") REFERENCES "evaluation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_run_id_fkey" FOREIGN KEY ("evaluation_run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_golden_sample_id_fkey" FOREIGN KEY ("golden_sample_id") REFERENCES "golden_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "correction_records" ADD CONSTRAINT "correction_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "correction_records" ADD CONSTRAINT "correction_records_document_version_id_fkey" FOREIGN KEY ("document_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "correction_records" ADD CONSTRAINT "correction_records_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "correction_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "correction_recommendations" ADD CONSTRAINT "correction_recommendations_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
