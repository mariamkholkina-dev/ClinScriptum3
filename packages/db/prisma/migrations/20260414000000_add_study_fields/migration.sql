-- AlterTable: add missing columns to studies
ALTER TABLE "studies" ADD COLUMN "sponsor" TEXT;
ALTER TABLE "studies" ADD COLUMN "drug" TEXT;
ALTER TABLE "studies" ADD COLUMN "therapeutic_area" TEXT;
ALTER TABLE "studies" ADD COLUMN "protocol_title" TEXT;

-- Change phase from StudyPhase enum to plain text
ALTER TABLE "studies" ALTER COLUMN "phase" DROP DEFAULT;
ALTER TABLE "studies" ALTER COLUMN "phase" SET DATA TYPE TEXT USING "phase"::TEXT;
ALTER TABLE "studies" ALTER COLUMN "phase" SET DEFAULT '';
