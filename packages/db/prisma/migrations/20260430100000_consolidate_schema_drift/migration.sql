-- Consolidating migration: closes drift between schema.prisma and the
-- migration history. Pre-existing fields and tables (operator_review_enabled,
-- llm_thinking_enabled, audit_mode, cross_check_pairs, tenant_configs, etc.)
-- were applied to dev DBs via `prisma db push` but never captured as
-- migrations. Without this consolidation `prisma migrate deploy` produces a
-- DB that is out-of-sync with the Prisma client, breaking integration tests
-- and any clean deploy.

-- CreateEnum
CREATE TYPE "ReasoningMode" AS ENUM ('DISABLED', 'ENABLED_HIDDEN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RuleSubStage" ADD VALUE 'self_check';
ALTER TYPE "RuleSubStage" ADD VALUE 'cross_check';
ALTER TYPE "RuleSubStage" ADD VALUE 'editorial';

-- AlterEnum
ALTER TYPE "SoaStatus" ADD VALUE 'not_soa';

-- AlterTable
ALTER TABLE "doc_templates" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "facts" ADD COLUMN     "variants" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "finding_review_logs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "finding_reviews" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "generated_doc_sections" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "generated_docs" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "golden_sample_stage_statuses" ADD COLUMN     "review_comment" TEXT;

-- AlterTable
ALTER TABLE "llm_configs" ADD COLUMN     "reasoning_mode" "ReasoningMode" NOT NULL DEFAULT 'DISABLED',
ALTER COLUMN "max_input_tokens" SET NOT NULL,
ALTER COLUMN "max_input_tokens" SET DEFAULT 16000;

-- AlterTable
ALTER TABLE "processing_steps" ADD COLUMN     "llm_config_snapshot" JSONB;

-- AlterTable
ALTER TABLE "rule_set_bundle_entries" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rule_set_bundles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "soa_cells" ADD COLUMN     "footnote_refs" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "soa_tables" DROP COLUMN "source_html";

-- AlterTable
ALTER TABLE "soa_verdicts" DROP COLUMN "cell_verdicts",
DROP COLUMN "false_positives",
DROP COLUMN "missed_tables",
ADD COLUMN     "cellVerdicts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "falsePositives" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "missedTables" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "studies" ADD COLUMN     "audit_mode" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "cross_check_pairs" JSONB,
ADD COLUMN     "excluded_section_prefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "llm_thinking_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operator_review_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "word_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- DropEnum
DROP TYPE "StudyPhase";

-- CreateTable
CREATE TABLE "tenant_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "excluded_section_prefixes" TEXT[] DEFAULT ARRAY['overview', 'admin', 'appendix', 'ip.preclinical_data']::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_configs_tenant_id_key" ON "tenant_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_configs" ADD CONSTRAINT "tenant_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
