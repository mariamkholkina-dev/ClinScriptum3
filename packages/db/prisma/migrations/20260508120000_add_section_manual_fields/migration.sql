-- Add manual section fields: allows annotators to create sections that the
-- automated parser missed, with attribution and source-anchor preserved across
-- re-parses (handleParseDocument deletes only is_manual=false sections).

ALTER TABLE "sections"
  ADD COLUMN "is_manual" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "manual_created_by_id" UUID NULL;

CREATE INDEX "sections_is_manual_idx" ON "sections"("is_manual");
