-- Sprint 6 commit 4: continuation tables merge.
-- When the detector merges a SoA table that was split across multiple
-- consecutive <w:tbl> parts with a repeated header, all source
-- ContentBlock IDs are listed here. sourceBlockId scalar stays as the
-- first element for backward compatibility.

-- AlterTable
ALTER TABLE "soa_tables" ADD COLUMN "source_block_ids" JSONB NOT NULL DEFAULT '[]';
