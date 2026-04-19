-- Rename status → classification_status (preserves existing validation state)
ALTER TABLE "sections" RENAME COLUMN "status" TO "classification_status";

-- Add structure_status column
ALTER TABLE "sections" ADD COLUMN "structure_status" "SectionStatus" NOT NULL DEFAULT 'not_validated';

-- Add classification_comment (was review_comment, but may not exist in fresh DBs)
ALTER TABLE "sections" ADD COLUMN IF NOT EXISTS "classification_comment" TEXT;

-- Drop review_comment if it exists (in case of upgrade from older schema)
ALTER TABLE "sections" DROP COLUMN IF EXISTS "review_comment";

-- Add structure_comment column
ALTER TABLE "sections" ADD COLUMN "structure_comment" TEXT;
