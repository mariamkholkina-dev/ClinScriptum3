-- Sprint 5 cleanup: drop the deprecated Json columns that backed the
-- old SoA footnote APIs. SoaFootnote / SoaFootnoteAnchor (Sprint 1)
-- have been the canonical store since 2026-05-03; these columns were
-- kept as backward-compat fallback. With the deprecated endpoints
-- removed in this sprint, the columns are no longer needed.

-- AlterTable
ALTER TABLE "soa_tables" DROP COLUMN "footnotes";

-- AlterTable
ALTER TABLE "soa_cells" DROP COLUMN "footnote_refs";
