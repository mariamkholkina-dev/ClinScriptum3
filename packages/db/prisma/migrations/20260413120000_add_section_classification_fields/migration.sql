-- AlterTable: sections — add classification detail columns
ALTER TABLE "sections"
  ADD COLUMN IF NOT EXISTS "algo_section"    TEXT,
  ADD COLUMN IF NOT EXISTS "algo_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "llm_section"     TEXT,
  ADD COLUMN IF NOT EXISTS "llm_confidence"  DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: soa_tables — add source_html column
ALTER TABLE "soa_tables"
  ADD COLUMN IF NOT EXISTS "source_html" TEXT;
