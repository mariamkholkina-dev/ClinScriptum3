import { describe, expect, it } from "vitest";
import {
  canonicalizeIntraAuditValue,
  buildDedupKey,
  enrichFindingWithCanonical,
} from "../canonicalize-finding-value.js";

describe("canonicalizeIntraAuditValue", () => {
  describe("null/empty handling", () => {
    it("returns null for null", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "")).toBeNull();
    });

    it("returns null for whitespace-only", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "   ")).toBeNull();
    });
  });

  describe("dose canonicalization", () => {
    it("normalizes мг/кг → mg/kg", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "60 мг/кг")).toBe("60mg/kg");
    });

    it("normalizes мг → mg", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "60 мг")).toBe("60mg");
    });

    it("normalizes мкг → mcg", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "500 мкг")).toBe("500mcg");
    });

    it("collapses space between number and unit", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "60 mg/kg")).toBe("60mg/kg");
      expect(canonicalizeIntraAuditValue("dose_mismatch", "60mg/kg")).toBe("60mg/kg");
    });

    it("normalizes µg → mcg", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "500 µg")).toBe("500mcg");
    });

    it("normalizes decimal comma to point", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "1,5 мг")).toBe("1.5mg");
    });

    it("preserves case insensitivity", () => {
      expect(canonicalizeIntraAuditValue("dose_mismatch", "60 MG")).toBe("60mg");
    });

    it("60 mg/kg === 60 мг/кг === 60mg/kg (all equivalent)", () => {
      const a = canonicalizeIntraAuditValue("dose_mismatch", "60 mg/kg");
      const b = canonicalizeIntraAuditValue("dose_mismatch", "60 мг/кг");
      const c = canonicalizeIntraAuditValue("dose_mismatch", "60mg/kg");
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it("applies dose canonicalization for strength_mismatch", () => {
      expect(canonicalizeIntraAuditValue("strength_mismatch", "10 мг")).toBe("10mg");
    });

    it("applies dose canonicalization for concentration_mismatch", () => {
      expect(canonicalizeIntraAuditValue("concentration_mismatch", "5 мг/мл")).toBe("5mg/ml");
    });
  });

  describe("duration / timeline canonicalization", () => {
    it("normalizes week synonyms via study_duration factKey", () => {
      const v1 = canonicalizeIntraAuditValue("duration_mismatch", "12 weeks");
      const v2 = canonicalizeIntraAuditValue("duration_mismatch", "12 wks");
      expect(v1).toContain("12");
      expect(v2).toContain("12");
      expect(v1).toBe(v2);
    });

    it("normalizes Russian week forms", () => {
      const v1 = canonicalizeIntraAuditValue("duration_mismatch", "12 недель");
      const v2 = canonicalizeIntraAuditValue("duration_mismatch", "12 weeks");
      expect(v1).toBe(v2);
    });

    it("normalizes SAE timeline (hours)", () => {
      // study_duration не знает 'hours' — попадёт в textCanonical fallback
      const v1 = canonicalizeIntraAuditValue("sae_reporting_timeline_conflict", "within 24 hours");
      const v2 = canonicalizeIntraAuditValue("sae_reporting_timeline_conflict", "within 72 hours");
      expect(v1).not.toBe(v2);
      expect(v1).toContain("24");
      expect(v2).toContain("72");
    });
  });

  describe("sample size canonicalization", () => {
    it("extracts numeric from 'Approximately 240 participants'", () => {
      expect(canonicalizeIntraAuditValue("sample_size_mismatch", "Approximately 240 participants")).toBe("240");
    });

    it("extracts numeric from 'N=180'", () => {
      expect(canonicalizeIntraAuditValue("sample_size_mismatch", "N=180")).toBe("180");
    });

    it("two equivalent sample size statements canonicalize to same string", () => {
      const v1 = canonicalizeIntraAuditValue("sample_size_mismatch", "240 participants");
      const v2 = canonicalizeIntraAuditValue("sample_size_mismatch", "n=240");
      expect(v1).toBe(v2);
    });
  });

  describe("text fallback (abbreviation / definition)", () => {
    it("lowercases and trims for abbreviation conflicts", () => {
      expect(canonicalizeIntraAuditValue("inconsistent_abbreviation_expansion", "Full Analysis Set"))
        .toBe("full analysis set");
    });

    it("collapses multiple spaces", () => {
      expect(canonicalizeIntraAuditValue("inconsistent_abbreviation_expansion", "Full   Analysis    Set"))
        .toBe("full analysis set");
    });

    it("normalizes Russian/English quotes", () => {
      expect(canonicalizeIntraAuditValue("inconsistent_abbreviation_expansion", '«Full Analysis Set»'))
        .toBe('"full analysis set"');
    });
  });

  describe("unknown issue_type fallback", () => {
    it("uses textCanonical for unknown types", () => {
      expect(canonicalizeIntraAuditValue("some_unknown_type", "Some Value Here"))
        .toBe("some value here");
    });

    it("uses textCanonical for editorial-prefixed types", () => {
      expect(canonicalizeIntraAuditValue("editorial_grammar_error", "Some Text"))
        .toBe("some text");
    });
  });
});

describe("buildDedupKey", () => {
  it("returns null if both canonicals are null", () => {
    expect(
      buildDedupKey({
        issueType: "dose_mismatch",
        referenceSectionId: "S1",
        targetSectionId: "S4",
        referenceCanonical: null,
        targetCanonical: null,
      }),
    ).toBeNull();
  });

  it("builds dedup key with all parts", () => {
    expect(
      buildDedupKey({
        issueType: "dose_mismatch",
        referenceSectionId: "S1:synopsis",
        targetSectionId: "S4:ip",
        referenceCanonical: "60mg/kg",
        targetCanonical: "40mg/kg",
      }),
    ).toBe("dose_mismatch|S1:synopsis|S4:ip|60mg/kg|40mg/kg");
  });

  it("uses '?' fallback for missing section ids", () => {
    expect(
      buildDedupKey({
        issueType: "dose_mismatch",
        referenceCanonical: "60mg/kg",
        targetCanonical: "40mg/kg",
      }),
    ).toBe("dose_mismatch|?|?|60mg/kg|40mg/kg");
  });

  it("produces same key for equivalent findings (different surface form)", () => {
    const a = buildDedupKey({
      issueType: "dose_mismatch",
      referenceSectionId: "S1",
      targetSectionId: "S4",
      referenceCanonical: canonicalizeIntraAuditValue("dose_mismatch", "60 мг/кг"),
      targetCanonical: canonicalizeIntraAuditValue("dose_mismatch", "40 мг/кг"),
    });
    const b = buildDedupKey({
      issueType: "dose_mismatch",
      referenceSectionId: "S1",
      targetSectionId: "S4",
      referenceCanonical: canonicalizeIntraAuditValue("dose_mismatch", "60 mg/kg"),
      targetCanonical: canonicalizeIntraAuditValue("dose_mismatch", "40 mg/kg"),
    });
    expect(a).toBe(b);
  });

  it("produces different keys for different values", () => {
    const a = buildDedupKey({
      issueType: "dose_mismatch",
      referenceSectionId: "S1",
      targetSectionId: "S4",
      referenceCanonical: "60mg/kg",
      targetCanonical: "40mg/kg",
    });
    const b = buildDedupKey({
      issueType: "dose_mismatch",
      referenceSectionId: "S1",
      targetSectionId: "S4",
      referenceCanonical: "60mg/kg",
      targetCanonical: "30mg/kg",
    });
    expect(a).not.toBe(b);
  });
});

describe("enrichFindingWithCanonical", () => {
  it("enriches finding with canonical values and dedup key", () => {
    const result = enrichFindingWithCanonical({
      issueType: "dose_mismatch",
      referenceSectionId: "S1:synopsis",
      targetSectionId: "S4:ip",
      referenceValue: "60 мг/кг",
      targetValue: "40 мг/кг",
    });
    expect(result.referenceValueCanonical).toBe("60mg/kg");
    expect(result.targetValueCanonical).toBe("40mg/kg");
    expect(result.dedupKey).toBe("dose_mismatch|S1:synopsis|S4:ip|60mg/kg|40mg/kg");
  });

  it("handles missing values", () => {
    const result = enrichFindingWithCanonical({
      issueType: "endpoint_definition_conflict",
      referenceSectionId: "S1",
      targetSectionId: "S2",
    });
    expect(result.referenceValueCanonical).toBeNull();
    expect(result.targetValueCanonical).toBeNull();
    expect(result.dedupKey).toBeNull();
  });

  it("handles only one value present", () => {
    const result = enrichFindingWithCanonical({
      issueType: "missing_parameter_in_target",
      referenceSectionId: "S1",
      targetSectionId: "S9",
      referenceValue: "240",
    });
    expect(result.referenceValueCanonical).toBe("240");
    expect(result.targetValueCanonical).toBeNull();
    expect(result.dedupKey).toContain("240");
    expect(result.dedupKey).toContain("?");
  });

  it("falls back to unknown_issue_type if issueType missing", () => {
    const result = enrichFindingWithCanonical({
      referenceValue: "Some Value",
      targetValue: "Other Value",
    });
    expect(result.referenceValueCanonical).toBe("some value");
    expect(result.targetValueCanonical).toBe("other value");
  });
});
