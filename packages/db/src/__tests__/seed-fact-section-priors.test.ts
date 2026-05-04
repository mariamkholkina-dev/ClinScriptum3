import { describe, it, expect } from "vitest";
import { FACT_SECTION_PRIORS_BUILDER } from "../seed-fact-section-priors.js";

describe("FACT_SECTION_PRIORS_BUILDER", () => {
  const priors = FACT_SECTION_PRIORS_BUILDER();

  it("produces a non-empty list", () => {
    expect(priors.length).toBeGreaterThanOrEqual(60);
  });

  it("each entry has factKey and ≥1 expectedSection", () => {
    for (const p of priors) {
      expect(p.factKey).toBeTruthy();
      expect(p.factKey.length).toBeGreaterThan(0);
      expect(Array.isArray(p.expectedSections)).toBe(true);
      expect(p.expectedSections.length).toBeGreaterThan(0);
    }
  });

  it("includes deterministic-only factKeys (those not in YAML under same name)", () => {
    const keys = new Set(priors.map((p) => p.factKey));
    // These come from DEFAULT_FACT_RULES in fact-extractor.ts but aren't in
    // fact-registry.yaml under the same name — they must be added by the
    // hardcoded mapping in seed-fact-section-priors.ts.
    for (const k of [
      "protocol_number",
      "study_phase",
      "sponsor",
      "sample_size",
      "study_drug",
      "study_duration",
      "primary_endpoint",
      "secondary_endpoint",
      "study_title",
      "indication",
    ]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("includes YAML-side factKeys (read from fact-registry.yaml)", () => {
    const keys = new Set(priors.map((p) => p.factKey));
    // Sampling: keys that exist only in YAML under those names.
    for (const k of [
      "protocol_id",
      "phase",
      "sponsor_name",
      "planned_n_total",
      "duration",
      "ip_name",
      "primary",
      "secondary",
      "inclusion_criteria",
      "exclusion_criteria",
    ]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("merges topics when factKey appears in both YAML and hardcoded mapping", () => {
    // inclusion_criteria / exclusion_criteria exist in BOTH (YAML population
    // group + DETERMINISTIC_ONLY_PRIORS would skip them). They should still
    // have non-empty expectedSections from YAML.
    const inc = priors.find((p) => p.factKey === "inclusion_criteria");
    expect(inc).toBeDefined();
    expect(inc!.expectedSections).toContain("population_eligibility");
  });

  it("expectedSections are deduplicated and sorted", () => {
    for (const p of priors) {
      const sorted = [...p.expectedSections].sort();
      expect(p.expectedSections).toEqual(sorted);
      expect(new Set(p.expectedSections).size).toBe(p.expectedSections.length);
    }
  });

  it("priors are sorted by factKey", () => {
    const keys = priors.map((p) => p.factKey);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });
});
