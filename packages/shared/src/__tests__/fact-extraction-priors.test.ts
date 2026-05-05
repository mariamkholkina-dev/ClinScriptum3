import { describe, it, expect } from "vitest";
import { factMatchesSectionPriors } from "../fact-extraction-core.js";

const titleToStd = new Map<string, string>([
  ["Synopsis", "synopsis"],
  ["Study Design", "design_plan"],
  ["Population", "population_eligibility"],
  ["Random Section", "appendix"],
  ["Inclusion Criteria", "population_eligibility.inclusion"],
]);

const priors = new Map<string, Set<string>>([
  ["study_phase", new Set(["overview_objectives", "design_plan"])],
  ["sample_size", new Set(["stats_sample_size", "population_eligibility"])],
]);

function makeFact(factKey: string, sectionTitle: string) {
  return { factKey, source: { sectionTitle } } as Parameters<typeof factMatchesSectionPriors>[0];
}

describe("factMatchesSectionPriors", () => {
  it("allows fact when factKey has no prior", () => {
    expect(
      factMatchesSectionPriors(makeFact("unknown_key", "Some Section"), priors, titleToStd),
    ).toBe(true);
  });

  it("allows fact when section is not classified (titleToStandard miss)", () => {
    expect(
      factMatchesSectionPriors(makeFact("study_phase", "Unknown Section"), priors, titleToStd),
    ).toBe(true);
  });

  it("REGRESSION 2026-05-05: allows synopsis facts even when synopsis is NOT in expectedSections", () => {
    // study_phase priors are [overview_objectives, design_plan] — no synopsis.
    // But the deterministic extractor weighs synopsis sources 2x and finds
    // most facts there. Without the synopsis bypass, all 4 golden samples
    // dropped to 0 deterministic facts after priors were seeded.
    expect(
      factMatchesSectionPriors(makeFact("study_phase", "Synopsis"), priors, titleToStd),
    ).toBe(true);
    expect(
      factMatchesSectionPriors(makeFact("sample_size", "Synopsis"), priors, titleToStd),
    ).toBe(true);
  });

  it("allows fact in an exactly-matching expected section", () => {
    expect(
      factMatchesSectionPriors(makeFact("study_phase", "Study Design"), priors, titleToStd),
    ).toBe(true);
  });

  it("allows fact in a subsection of expected (dot-prefix match)", () => {
    expect(
      factMatchesSectionPriors(
        makeFact("sample_size", "Inclusion Criteria"),
        priors,
        titleToStd,
      ),
    ).toBe(true);
  });

  it("rejects fact in a wrong section", () => {
    // study_phase shouldn't appear in 'population_eligibility'
    expect(
      factMatchesSectionPriors(makeFact("study_phase", "Population"), priors, titleToStd),
    ).toBe(false);
  });

  it("rejects fact in an unrelated section (e.g. appendix)", () => {
    expect(
      factMatchesSectionPriors(makeFact("study_phase", "Random Section"), priors, titleToStd),
    ).toBe(false);
  });
});
