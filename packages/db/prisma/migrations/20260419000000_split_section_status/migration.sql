-- Rename status → classification_status (preserves existing validation state)
ALTER TABLE "sections" RENAME COLUMN "status" TO "classification_status";

-- Add structure_status column
ALTER TABLE "sections" ADD COLUMN "structure_status" "SectionStatus" NOT NULL DEFAULT 'not_validated';

-- Rename review_comment → classification_comment
ALTER TABLE "sections" RENAME COLUMN "review_comment" TO "classification_comment";

-- Add structure_comment column
ALTER TABLE "sections" ADD COLUMN "structure_comment" TEXT;
