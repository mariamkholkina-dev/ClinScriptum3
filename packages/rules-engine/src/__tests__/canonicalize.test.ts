import { describe, it, expect } from "vitest";
import { canonicalize, aggregateByCanonical } from "../canonicalize.js";
import type { ExtractedFact } from "../fact-extractor.js";

function makeFact(
  factKey: string,
  value: string,
  sectionTitle = "Section",
): ExtractedFact {
  return {
    factKey,
    value,
    factClass: "general",
    source: { sectionTitle, textSnippet: value, method: "regex" },
  };
}

describe("canonicalize", () => {
  describe("sample_size", () => {
    it("extracts integer from 'N pacients' phrasings", () => {
      expect(canonicalize("sample_size", "30 пациентов").canonical).toBe("30");
      expect(canonicalize("sample_size", "30 patients").canonical).toBe("30");
      expect(canonicalize("sample_size", "N=30").canonical).toBe("30");
      expect(canonicalize("sample_size", "Approximately 30 subjects").canonical).toBe("30");
    });

    it("falls back to text canonical for malformed input", () => {
      expect(canonicalize("sample_size", "TBD").canonical).toBe("tbd");
    });
  });

  describe("protocol_number", () => {
    it("uppercases and strips whitespace", () => {
      expect(canonicalize("protocol_number", "abc-123").canonical).toBe("ABC-123");
      expect(canonicalize("protocol_number", "ABC 123").canonical).toBe("ABC123");
    });
  });

  describe("study_phase", () => {
    it("normalises Roman to Arabic", () => {
      expect(canonicalize("study_phase", "III").canonical).toBe("3");
      expect(canonicalize("study_phase", "Phase III").canonical).toBe("3");
    });

    it("keeps Arabic numerals", () => {
      expect(canonicalize("study_phase", "Phase 3").canonical).toBe("3");
      expect(canonicalize("study_phase", "фаза 3").canonical).toBe("3");
    });

    it("handles compound phases", () => {
      expect(canonicalize("study_phase", "II/III").canonical).toBe("2/3");
      expect(canonicalize("study_phase", "Phase 2/3").canonical).toBe("2/3");
    });
  });

  describe("study_duration", () => {
    it("normalises week aliases", () => {
      expect(canonicalize("study_duration", "12 weeks").canonical).toBe("12 weeks");
      expect(canonicalize("study_duration", "12 wk").canonical).toBe("12 weeks");
      expect(canonicalize("study_duration", "12 нед").canonical).toBe("12 weeks");
      expect(canonicalize("study_duration", "12 недель").canonical).toBe("12 weeks");
    });

    it("normalises month aliases", () => {
      expect(canonicalize("study_duration", "6 months").canonical).toBe("6 months");
      expect(canonicalize("study_duration", "6 мес").canonical).toBe("6 months");
    });
  });

  describe("text fields", () => {
    it("normalises sponsor case and whitespace", () => {
      expect(canonicalize("sponsor", "Acme  Corp").canonical).toBe(
        canonicalize("sponsor", "acme corp").canonical,
      );
    });

    it("treats Russian inflectional variants of indication as equivalent", () => {
      const a = canonicalize("indication", "лечение диабета").canonical;
      const b = canonicalize("indication", "лечения диабета").canonical;
      expect(a).toBe(b);
    });
  });

  describe("empty input", () => {
    it("returns empty canonical for empty raw", () => {
      expect(canonicalize("sponsor", "").canonical).toBe("");
      expect(canonicalize("sponsor", "   ").canonical).toBe("");
    });
  });
});

describe("aggregateByCanonical", () => {
  it("collapses identical canonical values across sources", () => {
    const facts = [
      makeFact("sample_size", "30 пациентов", "Synopsis"),
      makeFact("sample_size", "N=30", "Statistics"),
      makeFact("sample_size", "30 patients", "Body"),
    ];
    const out = aggregateByCanonical(facts);
    expect(out).toHaveLength(1);
    expect(out[0].canonical).toBe("30");
    expect(out[0].sourceCount).toBe(3);
  });

  it("keeps distinct canonical values as separate aggregated facts", () => {
    const facts = [
      makeFact("sample_size", "30", "Synopsis"),
      makeFact("sample_size", "40", "Body"),
    ];
    const out = aggregateByCanonical(facts);
    expect(out).toHaveLength(2);
    const canonicals = out.map((f) => f.canonical).sort();
    expect(canonicals).toEqual(["30", "40"]);
  });

  it("boosts confidence with more sources", () => {
    const single = aggregateByCanonical([makeFact("sponsor", "Acme")]);
    const triple = aggregateByCanonical([
      makeFact("sponsor", "Acme", "Synopsis"),
      makeFact("sponsor", "Acme", "Body 1"),
      makeFact("sponsor", "Acme", "Body 2"),
    ]);
    expect(triple[0].confidence).toBeGreaterThan(single[0].confidence);
    expect(triple[0].confidence).toBeLessThanOrEqual(0.95);
  });

  it("weights synopsis double when scoring confidence", () => {
    const synOnly = aggregateByCanonical([
      makeFact("sponsor", "Acme", "Synopsis"),
    ]);
    const bodyOnly = aggregateByCanonical([
      makeFact("sponsor", "Acme", "Body Section"),
    ]);
    expect(synOnly[0].confidence).toBeGreaterThan(bodyOnly[0].confidence);
  });

  it("prefers synopsis source as the representative when both confirm same canonical", () => {
    const out = aggregateByCanonical([
      makeFact("sponsor", "Acme Corp", "Body Section"),
      makeFact("sponsor", "Acme Corp", "Synopsis"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].source.sectionTitle).toBe("Synopsis");
    expect(out[0].sources).toHaveLength(2);
  });

  it("preserves order of first occurrence for distinct canonicals", () => {
    const out = aggregateByCanonical([
      makeFact("protocol_number", "AAA-111"),
      makeFact("protocol_number", "BBB-222"),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].canonical).toBe("AAA-111");
    expect(out[1].canonical).toBe("BBB-222");
  });

  it("collects all sources in `sources` array", () => {
    const out = aggregateByCanonical([
      makeFact("sponsor", "Acme", "Synopsis"),
      makeFact("sponsor", "Acme", "Body"),
    ]);
    expect(out[0].sources).toHaveLength(2);
    expect(out[0].sources.map((s) => s.sectionTitle)).toEqual(["Synopsis", "Body"]);
  });

  it("handles empty input", () => {
    expect(aggregateByCanonical([])).toEqual([]);
  });
});
