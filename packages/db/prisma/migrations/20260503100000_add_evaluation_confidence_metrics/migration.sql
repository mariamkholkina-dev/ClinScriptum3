-- Phase 5 fact-extraction roadmap: per-result confidence quality metrics
-- (Brier score, log-loss, etc.). Populated by run-evaluation when actual
-- ground-truth outcome and predicted confidence are both known.
ALTER TABLE "evaluation_results"
  ADD COLUMN "confidence_metrics" JSONB;
