-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "classified_by" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0;
