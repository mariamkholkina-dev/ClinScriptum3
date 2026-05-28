import { describe, it, expect } from "vitest";
import { deduplicateByFamilyAndAnchor, pickDuplicateIds } from "../intra-audit-dedup.js";

type F = {
  id: string;
  issueFamily?: string | null;
  issueType?: string | null;
  severity?: string | null;
  sourceRef: unknown;
  extraAttributes?: unknown;
};

function f(over: Partial<F> = {}): F {
  return {
    id: over.id ?? "f1",
    issueFamily: over.issueFamily ?? "NUMERIC",
    issueType: over.issueType,
    severity: over.severity ?? "medium",
    sourceRef: over.sourceRef ?? { anchorQuote: "120 пациентов" },
    extraAttributes: over.extraAttributes,
  };
}

describe("deduplicateByFamilyAndAnchor", () => {
  it("keeps single finding unchanged", () => {
    const r = deduplicateByFamilyAndAnchor([f()]);
    expect(r).toHaveLength(1);
  });

  it("merges 5 dupes of same (family, anchor) → 1 (max severity)", () => {
    const dupes: F[] = [
      f({ id: "p1", severity: "low" }),
      f({ id: "p2", severity: "medium" }),
      f({ id: "p3", severity: "critical" }),
      f({ id: "p4", severity: "high" }),
      f({ id: "p5", severity: "info" }),
    ];
    const r = deduplicateByFamilyAndAnchor(dupes);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("p3");
    expect(r[0]!.severity).toBe("critical");
  });

  it("does not merge across families", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "n", issueFamily: "NUMERIC" }),
      f({ id: "t", issueFamily: "TEXT_CONTRADICTION" }),
    ]);
    expect(r).toHaveLength(2);
  });

  it("does not merge findings without anchorQuote", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "a", sourceRef: {} }),
      f({ id: "b", sourceRef: {} }),
    ]);
    expect(r).toHaveLength(2);
  });

  it("normalizes anchor whitespace and case before grouping", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "a", sourceRef: { anchorQuote: "120 ПАЦИЕНТОВ" } }),
      f({ id: "b", sourceRef: { anchorQuote: "  120   пациентов  " } }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("family is case-insensitive", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "a", issueFamily: "numeric" }),
      f({ id: "b", issueFamily: "NUMERIC" }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("stable tiebreak on equal severity → smallest id wins", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "b1", severity: "high" }),
      f({ id: "a1", severity: "high" }),
    ]);
    expect(r[0]!.id).toBe("a1");
  });

  /* ─────── v2: dedup по explicit dedupKey (Приоритет 1) ─────── */

  it("merges findings with same extraAttributes.dedupKey (different quotes)", () => {
    // Та же причина (одинаковый dedupKey), но цитаты разные — должны объединиться.
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "v2a",
        severity: "medium",
        sourceRef: { anchorQuote: "60 мг/кг" },
        extraAttributes: { dedupKey: "dose_mismatch|S1|S4|60mg/kg|40mg/kg" },
      }),
      f({
        id: "v2b",
        severity: "high",
        sourceRef: { anchorQuote: "доза 60 mg/kg в дизайне" },
        extraAttributes: { dedupKey: "dose_mismatch|S1|S4|60mg/kg|40mg/kg" },
      }),
      f({
        id: "v2c",
        severity: "critical",
        sourceRef: { anchorQuote: "60mg/kg" },
        extraAttributes: { dedupKey: "dose_mismatch|S1|S4|60mg/kg|40mg/kg" },
      }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("v2c"); // максимальная severity
  });

  it("does not merge across different dedupKey (different canonical values)", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "k1",
        sourceRef: { anchorQuote: "X" },
        extraAttributes: { dedupKey: "dose_mismatch|S1|S4|60mg/kg|40mg/kg" },
      }),
      f({
        id: "k2",
        sourceRef: { anchorQuote: "Y" },
        extraAttributes: { dedupKey: "dose_mismatch|S1|S4|60mg/kg|30mg/kg" },
      }),
    ]);
    expect(r).toHaveLength(2);
  });

  /* ─────── v2: computed key из canonical values (Приоритет 2) ─────── */

  it("computes group key from section_ids + canonical values when dedupKey missing", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "c1",
        severity: "medium",
        issueType: "dose_mismatch",
        sourceRef: { anchorQuote: "60 мг/кг", referenceSectionId: "S1", targetSectionId: "S4" },
        extraAttributes: { referenceValueCanonical: "60mg/kg", targetValueCanonical: "40mg/kg" },
      }),
      f({
        id: "c2",
        severity: "high",
        issueType: "dose_mismatch",
        sourceRef: { anchorQuote: "the dose is 60mg/kg in synopsis", referenceSectionId: "S1", targetSectionId: "S4" },
        extraAttributes: { referenceValueCanonical: "60mg/kg", targetValueCanonical: "40mg/kg" },
      }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe("c2");
  });

  it("computed key path: different sections → not merged even with same canonical", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "s1",
        issueType: "dose_mismatch",
        sourceRef: { referenceSectionId: "S1", targetSectionId: "S4" },
        extraAttributes: { referenceValueCanonical: "60mg/kg", targetValueCanonical: "40mg/kg" },
      }),
      f({
        id: "s2",
        issueType: "dose_mismatch",
        sourceRef: { referenceSectionId: "S2", targetSectionId: "S4" },
        extraAttributes: { referenceValueCanonical: "60mg/kg", targetValueCanonical: "40mg/kg" },
      }),
    ]);
    expect(r).toHaveLength(2);
  });

  /* ─────── Backward-compat: legacy anchor для v1 findings (Приоритет 3) ─────── */

  it("falls back to legacy anchor when no canonical/dedupKey is present", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({ id: "L1", sourceRef: { anchorQuote: "120 пациентов" } }),
      f({ id: "L2", sourceRef: { anchorQuote: "120 пациентов" } }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("mixed batch: v2 (canonical) + v1 (anchor only) co-exist independently", () => {
    const r = deduplicateByFamilyAndAnchor([
      // v2 — dedupKey
      f({
        id: "v2x",
        severity: "high",
        extraAttributes: { dedupKey: "dose|S1|S4|60mg|40mg" },
      }),
      // v1 — anchor only
      f({ id: "v1a", sourceRef: { anchorQuote: "X" } }),
      f({ id: "v1b", sourceRef: { anchorQuote: "X" } }),
      // v1 — другая anchor
      f({ id: "v1c", sourceRef: { anchorQuote: "Y" } }),
    ]);
    expect(r).toHaveLength(3); // v2x + (v1a/v1b merged into one) + v1c
    expect(r.map((x) => x.id).sort()).toContain("v2x");
    expect(r.map((x) => x.id).sort()).toContain("v1c");
  });

  it("dedupKey takes precedence over canonical values when both present", () => {
    // Если есть и dedupKey, и canonical — группировка по dedupKey.
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "p1",
        issueType: "dose_mismatch",
        sourceRef: { referenceSectionId: "S1", targetSectionId: "S4" },
        extraAttributes: {
          dedupKey: "explicit-key-A",
          referenceValueCanonical: "60mg/kg",
          targetValueCanonical: "40mg/kg",
        },
      }),
      f({
        id: "p2",
        issueType: "dose_mismatch",
        sourceRef: { referenceSectionId: "S1", targetSectionId: "S4" },
        extraAttributes: {
          dedupKey: "explicit-key-A", // тот же ключ
          referenceValueCanonical: "60mg/kg",
          targetValueCanonical: "40mg/kg",
        },
      }),
    ]);
    expect(r).toHaveLength(1);
  });

  it("survives findings where canonical is null (treats as legacy fallback)", () => {
    const r = deduplicateByFamilyAndAnchor([
      f({
        id: "nul1",
        sourceRef: { anchorQuote: "same anchor" },
        extraAttributes: { referenceValueCanonical: null, targetValueCanonical: null },
      }),
      f({
        id: "nul2",
        sourceRef: { anchorQuote: "same anchor" },
        extraAttributes: { referenceValueCanonical: null, targetValueCanonical: null },
      }),
    ]);
    expect(r).toHaveLength(1);
  });
});

describe("pickDuplicateIds", () => {
  it("returns ids that were removed by dedup", () => {
    const before: F[] = [f({ id: "p1" }), f({ id: "p2" }), f({ id: "p3" })];
    const after: F[] = [f({ id: "p1" })];
    expect(pickDuplicateIds(before, after).sort()).toEqual(["p2", "p3"]);
  });
  it("empty when nothing removed", () => {
    const arr = [f({ id: "p1" })];
    expect(pickDuplicateIds(arr, arr)).toEqual([]);
  });
});
