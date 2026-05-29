-- Add per-study toggle for intra-audit deterministic findings (level 1).
-- Default true keeps existing behaviour; set false to skip deterministic findings.
ALTER TABLE "studies" ADD COLUMN "intra_audit_deterministic_enabled" BOOLEAN NOT NULL DEFAULT true;
