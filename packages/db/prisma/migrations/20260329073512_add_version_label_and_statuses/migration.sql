-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentVersionStatus" ADD VALUE 'classifying_sections';
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'extracting_facts';
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'ready';
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'intra_audit';
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'inter_audit';
ALTER TYPE "DocumentVersionStatus" ADD VALUE 'impact_assessment';

-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "is_current" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version_label" TEXT;
