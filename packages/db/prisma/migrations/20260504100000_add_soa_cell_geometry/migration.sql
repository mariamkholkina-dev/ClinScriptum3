-- Sprint 6 commit 2: cell EMU geometry per SoA table.
-- Filled by extractTableGeometry → mapDrawingsToCells in detectSoaForVersion.
-- Used by the UI to render an SVG overlay of arrows/lines over cells.

-- AlterTable
ALTER TABLE "soa_tables" ADD COLUMN "cell_geometry" JSONB;
