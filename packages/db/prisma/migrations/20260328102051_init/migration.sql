-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('basic', 'extended');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('writer', 'qc_operator', 'rule_admin', 'tenant_admin');

-- CreateEnum
CREATE TYPE "StudyPhase" AS ENUM ('I', 'II', 'III', 'IV', 'I/II', 'II/III', 'unknown');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('protocol', 'icf', 'ib', 'csr');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('uploading', 'parsing', 'parsed', 'error');

-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('validated', 'not_validated', 'requires_rework');

-- CreateEnum
CREATE TYPE "ContentBlockType" AS ENUM ('paragraph', 'table', 'table_cell', 'footnote', 'list', 'image');

-- CreateEnum
CREATE TYPE "FactClass" AS ENUM ('general', 'phase_specific');

-- CreateEnum
CREATE TYPE "FactStatus" AS ENUM ('extracted', 'verified', 'validated', 'rejected');

-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('editorial', 'semantic');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('pending', 'confirmed', 'rejected', 'resolved');

-- CreateEnum
CREATE TYPE "ProcessingRunType" AS ENUM ('section_classification', 'fact_extraction', 'intra_doc_audit', 'inter_doc_audit', 'icf_generation', 'csr_generation', 'version_comparison');

-- CreateEnum
CREATE TYPE "ProcessingRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "PipelineLevel" AS ENUM ('deterministic', 'llm_check', 'llm_qa', 'operator_review', 'user_validation');

-- CreateEnum
CREATE TYPE "ProcessingStepStatus" AS ENUM ('pending', 'running', 'completed', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "RuleSetType" AS ENUM ('section_classification', 'fact_extraction', 'soa_identification', 'audit');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'basic',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'writer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "phase" "StudyPhase" NOT NULL DEFAULT 'unknown',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "study_id" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_url" TEXT NOT NULL,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'uploading',
    "digital_twin" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "standard_section" TEXT,
    "level" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "SectionStatus" NOT NULL DEFAULT 'not_validated',
    "source_anchor" JSONB NOT NULL,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "type" "ContentBlockType" NOT NULL,
    "content" TEXT NOT NULL,
    "raw_html" TEXT,
    "order" INTEGER NOT NULL,
    "source_anchor" JSONB NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "fact_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "fact_class" "FactClass" NOT NULL,
    "sources" JSONB NOT NULL,
    "has_contradiction" BOOLEAN NOT NULL DEFAULT false,
    "status" "FactStatus" NOT NULL DEFAULT 'extracted',

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "type" "FindingType" NOT NULL,
    "description" TEXT NOT NULL,
    "suggestion" TEXT,
    "source_ref" JSONB NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'pending',
    "extra_attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_runs" (
    "id" UUID NOT NULL,
    "study_id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "type" "ProcessingRunType" NOT NULL,
    "status" "ProcessingRunStatus" NOT NULL DEFAULT 'queued',
    "rule_set_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_steps" (
    "id" UUID NOT NULL,
    "processing_run_id" UUID NOT NULL,
    "level" "PipelineLevel" NOT NULL,
    "status" "ProcessingStepStatus" NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "processing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "type" "RuleSetType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_set_versions" (
    "id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_set_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "rule_set_version_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "studies_tenant_id_idx" ON "studies"("tenant_id");

-- CreateIndex
CREATE INDEX "documents_study_id_idx" ON "documents"("study_id");

-- CreateIndex
CREATE INDEX "document_versions_document_id_idx" ON "document_versions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_document_id_version_number_key" ON "document_versions"("document_id", "version_number");

-- CreateIndex
CREATE INDEX "sections_doc_version_id_idx" ON "sections"("doc_version_id");

-- CreateIndex
CREATE INDEX "content_blocks_section_id_idx" ON "content_blocks"("section_id");

-- CreateIndex
CREATE INDEX "facts_doc_version_id_idx" ON "facts"("doc_version_id");

-- CreateIndex
CREATE INDEX "findings_doc_version_id_idx" ON "findings"("doc_version_id");

-- CreateIndex
CREATE INDEX "processing_runs_study_id_idx" ON "processing_runs"("study_id");

-- CreateIndex
CREATE INDEX "processing_runs_doc_version_id_idx" ON "processing_runs"("doc_version_id");

-- CreateIndex
CREATE INDEX "processing_steps_processing_run_id_idx" ON "processing_steps"("processing_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "rule_set_versions_rule_set_id_version_key" ON "rule_set_versions"("rule_set_id", "version");

-- CreateIndex
CREATE INDEX "rules_rule_set_version_id_idx" ON "rules"("rule_set_version_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studies" ADD CONSTRAINT "studies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_steps" ADD CONSTRAINT "processing_steps_processing_run_id_fkey" FOREIGN KEY ("processing_run_id") REFERENCES "processing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_set_versions" ADD CONSTRAINT "rule_set_versions_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_rule_set_version_id_fkey" FOREIGN KEY ("rule_set_version_id") REFERENCES "rule_set_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
