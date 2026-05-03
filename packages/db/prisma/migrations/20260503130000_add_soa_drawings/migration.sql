-- Sprint 3: graphic markers (arrows / lines / brackets over SoA cells).
-- Adds raw drawings on SoaTable and per-cell marker_sources to track
-- which signal contributed to each cell's mark.

-- AlterTable
ALTER TABLE "soa_tables"
  ADD COLUMN "drawings" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "soa_cells"
  ADD COLUMN "marker_sources" JSONB NOT NULL DEFAULT '["text"]';
