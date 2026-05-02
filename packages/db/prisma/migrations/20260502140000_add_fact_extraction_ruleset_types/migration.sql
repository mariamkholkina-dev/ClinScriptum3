-- Phase 2/3/5 fact-extraction roadmap: new RuleSet kinds.
-- fact_section_priors: which factKey to look for in which standardSection (Phase 2)
-- fact_anchors:        BM25 anchor keywords per factKey (Phase 3)
-- confidence_calibration: alpha/beta/gamma coefficients per factKey (Phase 5)
ALTER TYPE "RuleSetType" ADD VALUE IF NOT EXISTS 'fact_section_priors';
ALTER TYPE "RuleSetType" ADD VALUE IF NOT EXISTS 'fact_anchors';
ALTER TYPE "RuleSetType" ADD VALUE IF NOT EXISTS 'confidence_calibration';
