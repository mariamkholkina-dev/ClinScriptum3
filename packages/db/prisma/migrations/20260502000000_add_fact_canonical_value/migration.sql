-- Phase 1.5 of fact-extraction roadmap: canonical aggregation fields.
-- canonical_value      — normalised form of `value` from rules-engine
--                        canonicalize(); equality target for voting
--                        and contradiction detection.
-- standard_section_code — free-form code of the section that produced
--                        the strongest source occurrence; decoupled
--                        from the section taxonomy enum so it survives
--                        parallel taxonomy work.
-- source_count          — number of distinct source occurrences that
--                        contributed to this aggregated fact (defaults
--                        to 1 for pre-Phase-1 rows).
ALTER TABLE facts
  ADD COLUMN IF NOT EXISTS canonical_value TEXT,
  ADD COLUMN IF NOT EXISTS standard_section_code TEXT,
  ADD COLUMN IF NOT EXISTS source_count INTEGER NOT NULL DEFAULT 1;
