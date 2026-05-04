-- Sprint 7 commit 1: SoA snapshot for fast cross-version diff + new
-- finding types driven by SoA-aware audit.
--
-- snapshot_json caches a stable serialized form of (visits, procedures,
-- cells, footnotes) so comparing two DocumentVersions does not require
-- re-loading and re-projecting all SoaCell rows on every diff request.
--
-- The new FindingType values are emitted by:
--   * comparison.compareSoa → soa_procedure_added / soa_procedure_removed
--   * intra-doc audit       → soa_inconsistent_with_text
--   * inter-doc audit       → icf_missing_soa_procedure

-- AlterTable
ALTER TABLE "soa_tables" ADD COLUMN "snapshot_json" JSONB;

-- AlterEnum
ALTER TYPE "FindingType" ADD VALUE 'soa_procedure_added';
ALTER TYPE "FindingType" ADD VALUE 'soa_procedure_removed';
ALTER TYPE "FindingType" ADD VALUE 'soa_inconsistent_with_text';
ALTER TYPE "FindingType" ADD VALUE 'icf_missing_soa_procedure';
