-- Add per-section heading number rendered by Word (e.g. "1.2.3").
-- Source priority in parser:
--   1) Word auto-numbering resolved from word/numbering.xml
--   2) Manual numeric prefix in the title (regex)
--   3) NULL when neither applies (e.g. bold-only visual heading)
ALTER TABLE "sections" ADD COLUMN "heading_number" TEXT;
