-- Phase 2 fact-extraction roadmap: persist parsed table AST so downstream
-- extractors can read structured rows/headers instead of CSV-collapsed text.
ALTER TABLE content_blocks
  ADD COLUMN IF NOT EXISTS table_ast JSONB;
