-- Phase 0 fact-extraction roadmap: per-factKey coverage metric.
ALTER TABLE evaluation_runs
  ADD COLUMN IF NOT EXISTS fact_coverage DOUBLE PRECISION;

ALTER TABLE evaluation_results
  ADD COLUMN IF NOT EXISTS coverage_by_fact_key JSONB;
