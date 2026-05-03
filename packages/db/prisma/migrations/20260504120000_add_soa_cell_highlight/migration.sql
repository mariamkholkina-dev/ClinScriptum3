-- Sprint 6 commit 6: yellow cell highlighting.
-- Stores the source-DOCX cell background color as a hex string with
-- leading "#" (e.g. "#FFFF00"). Null means the source had no highlight.

-- AlterTable
ALTER TABLE "soa_cells" ADD COLUMN "cell_highlight" TEXT;
