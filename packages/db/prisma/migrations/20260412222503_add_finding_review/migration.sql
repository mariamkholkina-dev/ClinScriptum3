-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'findings_reviewer';

-- CreateEnum
CREATE TYPE "FindingReviewStatus" AS ENUM ('pending', 'in_review', 'published');

-- AlterTable: add reviewer fields to findings
ALTER TABLE "findings" ADD COLUMN "hidden_by_reviewer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "findings" ADD COLUMN "original_severity" "AuditSeverity";
ALTER TABLE "findings" ADD COLUMN "reviewer_note" TEXT;

-- CreateTable: finding_reviews
CREATE TABLE "finding_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "doc_version_id" UUID NOT NULL,
    "audit_type" "FindingType" NOT NULL,
    "protocol_version_id" UUID,
    "reviewer_id" UUID,
    "status" "FindingReviewStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "finding_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable: finding_review_logs
CREATE TABLE "finding_review_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finding_reviews_tenant_id_idx" ON "finding_reviews"("tenant_id");
CREATE INDEX "finding_reviews_status_idx" ON "finding_reviews"("status");
CREATE UNIQUE INDEX "finding_reviews_doc_version_id_audit_type_key" ON "finding_reviews"("doc_version_id", "audit_type");

-- CreateIndex
CREATE INDEX "finding_review_logs_review_id_idx" ON "finding_review_logs"("review_id");
CREATE INDEX "finding_review_logs_finding_id_idx" ON "finding_review_logs"("finding_id");

-- AddForeignKey
ALTER TABLE "finding_reviews" ADD CONSTRAINT "finding_reviews_doc_version_id_fkey" FOREIGN KEY ("doc_version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finding_reviews" ADD CONSTRAINT "finding_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_review_logs" ADD CONSTRAINT "finding_review_logs_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "finding_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
