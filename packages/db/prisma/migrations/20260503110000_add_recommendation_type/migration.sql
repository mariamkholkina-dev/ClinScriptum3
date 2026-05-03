-- Phase 5 fact-extraction roadmap: typed CorrectionRecommendation.
-- Adds an enum classifier so active-learning UI can offer apply-buttons
-- per recommendation kind, and a JSONB column for the structured
-- suggested change (e.g. { factKey, keyword, weight } for anchor_keyword).
CREATE TYPE "RecommendationType" AS ENUM (
  'anchor_keyword',
  'synonym',
  'section_prior',
  'prompt_template',
  'other'
);

ALTER TABLE "correction_recommendations"
  ADD COLUMN "recommendation_type" "RecommendationType",
  ADD COLUMN "suggested_change_data" JSONB;
