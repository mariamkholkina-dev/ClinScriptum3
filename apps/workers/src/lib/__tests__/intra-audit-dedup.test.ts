import { describe, it, expect } from "vitest";
import { deduplicateByFamilyAndAnchor, pickDuplicateIds } from "../intra-audit-dedup.js";

type F = {
  id: string;
  issueFamily?: string | null;
  severity?: string | null;
  sourceRef: unknown;
};

function f(over: Partial<F> = {}): F {
  return {
    id: over.id ?? "f1",
    issueFamily: over.issueFamily ?? "NUMERIC",
    severity: over.severity ?? "medium",
    sourceRef: over.sourceRef ?? { anchorQuote: "120 пациентов" },
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
