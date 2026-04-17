import { describe, it, expect } from "vitest";
import { detectContradictions } from "../contradiction-detector.js";
import type { ExtractedFact } from "../fact-extractor.js";

function makeFact(
  factKey: string,
  value: string,
  sectionTitle = "Section"
): ExtractedFact {
  return {
    factKey,
    value,
    factClass: "general",
    source: { sectionTitle, textSnippet: value, method: "regex" },
  };
}

describe("detectContradictions", () => {
  it("returns empty array when no contradictions exist", () => {
    const facts = [
      makeFact("sample_size", "200", "Synopsis"),
      makeFact("sample_size", "200", "Statistics"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(0);
  });

  it("detects contradiction when same factKey has different values", () => {
    const facts = [
      makeFact("sample_size", "200", "Synopsis"),
      makeFact("sample_size", "250", "Study Design"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(1);
    expect(result[0].factKey).toBe("sample_size");
    expect(result[0].values).toHaveLength(2);
  });

  it("normalizes case when comparing values", () => {
    const facts = [
      makeFact("study_phase", "Phase III", "Synopsis"),
      makeFact("study_phase", "phase iii", "Introduction"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(0);
  });

  it("normalizes whitespace when comparing values", () => {
    const facts = [
      makeFact("study_drug", "Drug  X", "Synopsis"),
      makeFact("study_drug", "Drug X", "Treatments"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(0);
  });

  it("handles multiple contradictions across different fact keys", () => {
    const facts = [
      makeFact("sample_size", "200", "Synopsis"),
      makeFact("sample_size", "300", "Statistics"),
      makeFact("study_phase", "Phase II", "Synopsis"),
      makeFact("study_phase", "Phase III", "Introduction"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(2);
    const keys = result.map((c) => c.factKey).sort();
    expect(keys).toEqual(["sample_size", "study_phase"]);
  });

  it("does not flag facts with unique keys as contradictions", () => {
    const facts = [
      makeFact("sample_size", "200"),
      makeFact("study_phase", "Phase III"),
      makeFact("sponsor", "Acme Corp"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = detectContradictions([]);
    expect(result).toHaveLength(0);
  });

  it("includes all source values in contradiction report", () => {
    const facts = [
      makeFact("sample_size", "100", "Synopsis"),
      makeFact("sample_size", "200", "Design"),
      makeFact("sample_size", "300", "Statistics"),
    ];
    const result = detectContradictions(facts);
    expect(result).toHaveLength(1);
    expect(result[0].values).toHaveLength(3);
  });
});
