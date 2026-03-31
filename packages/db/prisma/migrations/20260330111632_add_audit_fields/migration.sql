-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('critical', 'high', 'medium', 'low', 'info');

-- AlterEnum
ALTER TYPE "FindingStatus" ADD VALUE 'false_positive';

-- AlterEnum
ALTER TYPE "FindingType" ADD VALUE 'intra_audit';

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "anchor_zone" TEXT,
ADD COLUMN     "audit_category" TEXT,
ADD COLUMN     "issue_family" TEXT,
ADD COLUMN     "issue_type" TEXT,
ADD COLUMN     "qa_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "severity" "AuditSeverity",
ADD COLUMN     "target_zone" TEXT;

-- AlterTable
ALTER TABLE "soa_cells" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "soa_tables" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "findings_doc_version_id_type_idx" ON "findings"("doc_version_id", "type");
