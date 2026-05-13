import { describe, it, expect } from "vitest";
import { decidePrelabel, type PrelabelInputFinding } from "../intra-audit-prelabel.js";

function f(over: Partial<PrelabelInputFinding> = {}): PrelabelInputFinding {
  return {
    id: over.id ?? "f1",
    status: over.status ?? "pending",
    issueFamily: over.issueFamily ?? "NUMERIC",
    qaVerified: over.qaVerified ?? false,
    extraAttributes: over.extraAttributes ?? {},
  };
}

describe("decidePrelabel", () => {
  it("skips placeholder family (excluded from f1 by variant A)", () => {
    const r = decidePrelabel(f({ issueFamily: "PLACEHOLDER" }));
    expect(r.decision).toBe("skip");
    expect(r.source).toBe("skip_excluded_family");
  });

  it("skips editorial family", () => {
    const r = decidePrelabel(f({ issueFamily: "EDITORIAL" }));
    expect(r.decision).toBe("skip");
  });

  it("rejected: status=false_positive (dedup-flagged)", () => {
    const r = decidePrelabel(f({ status: "false_positive" }));
    expect(r.decision).toBe("rejected");
    expect(r.source).toBe("dedup_or_false_positive");
  });

  it("rejected: qaVerdict=deduplicated", () => {
    const r = decidePrelabel(f({ extraAttributes: { qaVerdict: "deduplicated" } }));
    expect(r.decision).toBe("rejected");
  });

  it("rejected: qaVerdict=dismissed", () => {
    const r = decidePrelabel(f({ extraAttributes: { qaVerdict: "dismissed" } }));
    expect(r.decision).toBe("rejected");
    expect(r.source).toBe("qa_dismissed");
  });

  it("accepted: qaVerdict=confirmed AND qaVerified=true", () => {
    const r = decidePrelabel(
      f({ extraAttributes: { qaVerdict: "confirmed" }, qaVerified: true }),
    );
    expect(r.decision).toBe("accepted");
    expect(r.source).toBe("qa_confirmed");
  });

  it("does NOT accept when qaVerdict=confirmed but qaVerified=false (incomplete signal)", () => {
    const r = decidePrelabel(
      f({ extraAttributes: { qaVerdict: "confirmed" }, qaVerified: false }),
    );
    expect(r.decision).toBe("skip");
    expect(r.source).toBe("skip_uncertain");
  });

  it("skip uncertain: no qaVerdict, no special status", () => {
    const r = decidePrelabel(f());
    expect(r.decision).toBe("skip");
    expect(r.source).toBe("skip_uncertain");
  });

  it("family check is case-insensitive", () => {
    expect(decidePrelabel(f({ issueFamily: "placeholder" })).decision).toBe("skip");
    expect(decidePrelabel(f({ issueFamily: "editorial" })).decision).toBe("skip");
  });

  it("priority: false_positive wins over uncertain extra", () => {
    const r = decidePrelabel(
      f({ status: "false_positive", extraAttributes: { qaVerdict: "confirmed" } }),
    );
    expect(r.decision).toBe("rejected");
  });
});
