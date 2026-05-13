import { describe, it, expect, vi } from "vitest";
import type {
  ExpectedFinding,
  ExpectedProblem,
  PredictedFinding,
} from "@clinscriptum/shared";
import {
  applyFamilyScope,
  computePerFamily,
  isExcludedFromMetric,
  matchCascade,
  matchCoverage,
  matchLLMJudge,
  normalizeQuote,
  quoteOverlap,
  type LLMJudge,
} from "../intra-audit-match.js";

// ─── factories ───────────────────────────────────────────────

function pred(over: Partial<PredictedFinding> = {}): PredictedFinding {
  return {
    id: over.id ?? "p1",
    issueFamily: over.issueFamily ?? "NUMERIC",
    issueType: over.issueType ?? "sample_size_pop_vs_stats",
    severity: over.severity ?? "critical",
    anchorZone: over.anchorZone ?? "POPULATION",
    targetZone: over.targetZone ?? null,
    anchorQuote: over.anchorQuote ?? "120 пациентов",
    targetQuote: over.targetQuote ?? null,
    description: over.description ?? "n=120 vs n=130",
    method: over.method ?? "llm",
  };
}

function exp(over: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return {
    id: over.id ?? "e1",
    issueFamily: over.issueFamily ?? "NUMERIC",
    issueType: over.issueType ?? "sample_size_pop_vs_stats",
    severity: over.severity ?? "critical",
    anchorZone: over.anchorZone ?? "POPULATION",
    targetZone: over.targetZone,
    anchorQuote: over.anchorQuote ?? "120 пациентов",
    targetQuote: over.targetQuote,
    description: over.description ?? "sample size mismatch",
    mustDetect: over.mustDetect ?? true,
    notes: over.notes,
  };
}

function problem(over: Partial<ExpectedProblem> = {}): ExpectedProblem {
  return {
    id: over.id ?? "pr1",
    problemDescription: over.problemDescription ?? "sample_size mismatch",
    issueFamily: over.issueFamily ?? "NUMERIC",
    anchorZone: over.anchorZone ?? "POPULATION",
    exampleQuote: over.exampleQuote,
    mustDetect: over.mustDetect ?? true,
  };
}

// ─── normalizeQuote / quoteOverlap ───────────────────────────

describe("normalizeQuote", () => {
  it("lower-case + collapse spaces + strip pretty punctuation", () => {
    expect(normalizeQuote("«120  Пациентов»  ")).toBe("120 пациентов");
    expect(normalizeQuote('"120-130", n=2')).toBe("120130 n=2");
  });
  it("empty / nullish → empty string", () => {
    expect(normalizeQuote(null)).toBe("");
    expect(normalizeQuote(undefined)).toBe("");
    expect(normalizeQuote("")).toBe("");
  });
});

describe("quoteOverlap (Jaccard)", () => {
  it("identical → 1", () => {
    expect(quoteOverlap("120 пациентов", "120 пациентов")).toBe(1);
  });
  it("partial — 1 word common of 3 → 1/3", () => {
    expect(quoteOverlap("120 пациентов будет", "пациентов")).toBeCloseTo(1 / 3, 5);
  });
  it("disjoint → 0", () => {
    expect(quoteOverlap("120 пациентов", "non conform")).toBe(0);
  });
  it("either side empty → 0", () => {
    expect(quoteOverlap("", "anything")).toBe(0);
  });
});

// ─── exclusion filter (variant A) ────────────────────────────

describe("isExcludedFromMetric", () => {
  it("excludes method=deterministic", () => {
    expect(isExcludedFromMetric(pred({ method: "deterministic" }))).toBe(true);
  });
  it("excludes family=PLACEHOLDER regardless of case", () => {
    expect(isExcludedFromMetric(pred({ issueFamily: "PLACEHOLDER", method: "llm" }))).toBe(true);
    expect(isExcludedFromMetric(pred({ issueFamily: "placeholder", method: "llm" }))).toBe(true);
  });
  it("excludes family=EDITORIAL", () => {
    expect(isExcludedFromMetric(pred({ issueFamily: "EDITORIAL" }))).toBe(true);
  });
  it("keeps semantic LLM findings", () => {
    expect(isExcludedFromMetric(pred({ issueFamily: "NUMERIC", method: "llm" }))).toBe(false);
  });
});

// ─── matchCascade ────────────────────────────────────────────

describe("matchCascade", () => {
  it("perfect match → strict TP", () => {
    const r = matchCascade([pred()], [exp()]);
    expect(r.strict.tp).toBe(1);
    expect(r.strict.fp).toBe(0);
    expect(r.strict.fn).toBe(0);
    expect(r.strict.f1).toBe(1);
  });

  it("low quote overlap and mismatched type → strict miss, lenient miss", () => {
    const r = matchCascade(
      // overlap=1/4=0.25 (only «пациентов»); issueType отличается → lenient через type+zone не сработает
      [pred({ anchorQuote: "пациентов", issueType: "other_type" })],
      [exp({ anchorQuote: "120 пациентов будет включено" })],
    );
    expect(r.strict.tp).toBe(0);
    expect(r.lenient.tp).toBe(0);
  });

  it("issueType+zone match without quote overlap → lenient TP, strict miss", () => {
    const r = matchCascade(
      [pred({ anchorQuote: "non-conform" })],
      [exp({ anchorQuote: "120 пациентов" })],
    );
    expect(r.strict.tp).toBe(0);
    expect(r.lenient.tp).toBe(1);
  });

  it("different family → no TP in either tier", () => {
    const r = matchCascade([pred({ issueFamily: "PLACEHOLDER" })], [exp()]);
    // PLACEHOLDER predicted is excluded from metric, so it shouldn't even be counted as FP
    expect(r.strict.tp).toBe(0);
    expect(r.strict.fp).toBe(0);
    expect(r.strict.fn).toBe(1);
  });

  it("greedy 1-to-1: 2 predicted in same family, 1 expected → 1 TP + 1 FP", () => {
    const r = matchCascade(
      [
        pred({ id: "p1", anchorQuote: "120 пациентов" }),
        pred({ id: "p2", anchorQuote: "120 пациентов будет" }),
      ],
      [exp({ anchorQuote: "120 пациентов" })],
    );
    expect(r.lenient.tp).toBe(1);
    expect(r.lenient.fp).toBe(1);
  });

  it("dup-FP example: 5 predicted dupes, 1 expected → 1 TP + 4 FP", () => {
    const dupes = Array.from({ length: 5 }, (_, i) =>
      pred({ id: `p${i}`, anchorQuote: "120 пациентов" }),
    );
    const r = matchCascade(dupes, [exp({ anchorQuote: "120 пациентов" })]);
    expect(r.lenient.tp).toBe(1);
    expect(r.lenient.fp).toBe(4);
    expect(r.lenient.fn).toBe(0);
  });

  it("empty predicted + non-empty expected → recall=0 (fn=expected.length)", () => {
    const r = matchCascade([], [exp(), exp({ id: "e2" })]);
    expect(r.strict.fn).toBe(2);
    expect(r.strict.recall).toBe(0);
  });

  it("both empty → precision=recall=1, f1=0 (degenerate but defined)", () => {
    const r = matchCascade([], []);
    expect(r.strict.precision).toBe(1);
    expect(r.strict.recall).toBe(1);
  });
});

// ─── matchCoverage ───────────────────────────────────────────

describe("matchCoverage", () => {
  it("3 of 5 problems covered → recall=0.6", () => {
    const problems = [
      problem({ id: "pr1", anchorZone: "POPULATION", issueFamily: "NUMERIC" }),
      problem({ id: "pr2", anchorZone: "STATISTICS", issueFamily: "NUMERIC" }),
      problem({ id: "pr3", anchorZone: "SAFETY", issueFamily: "NUMERIC" }),
      problem({ id: "pr4", anchorZone: "ENDPOINTS", issueFamily: "TEXT_CONTRADICTION" }),
      problem({ id: "pr5", anchorZone: "DESIGN", issueFamily: "TEXT_CONTRADICTION" }),
    ];
    const findings = [
      pred({ id: "p1", anchorZone: "POPULATION", issueFamily: "NUMERIC" }),
      pred({ id: "p2", anchorZone: "STATISTICS", issueFamily: "NUMERIC" }),
      pred({ id: "p3", anchorZone: "ENDPOINTS", issueFamily: "TEXT_CONTRADICTION" }),
    ];
    const r = matchCoverage(findings, problems);
    expect(r.tp).toBe(3);
    expect(r.fn).toBe(2);
    expect(r.recall).toBeCloseTo(0.6, 5);
    expect(r.coveredProblemIds.sort()).toEqual(["pr1", "pr2", "pr4"]);
  });

  it("hallucination candidate: predicted in (family,zone) without any problem", () => {
    const problems = [problem({ id: "pr1", anchorZone: "POPULATION", issueFamily: "NUMERIC" })];
    const findings = [
      pred({ id: "p1", anchorZone: "POPULATION", issueFamily: "NUMERIC" }),
      pred({ id: "halu", anchorZone: "OTHER", issueFamily: "TEXT_CONTRADICTION" }),
    ];
    const r = matchCoverage(findings, problems);
    expect(r.hallucinationCandidateIds).toEqual(["halu"]);
    expect(r.fp).toBe(1);
  });

  it("placeholder predicted ignored", () => {
    const r = matchCoverage(
      [pred({ id: "halu", issueFamily: "PLACEHOLDER", method: "deterministic" })],
      [problem()],
    );
    expect(r.hallucinationCandidateIds).toEqual([]);
    expect(r.fp).toBe(0);
    expect(r.fn).toBe(1);
  });

  it("mustDetect=false problem ignored from FN counter", () => {
    const r = matchCoverage([], [problem({ mustDetect: false })]);
    expect(r.fn).toBe(0);
    expect(r.totalProblems).toBe(0);
  });
});

// ─── matchLLMJudge ───────────────────────────────────────────

describe("matchLLMJudge", () => {
  it("judge=yes for matching family → TP", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "yes" as const }));
    const r = await matchLLMJudge([pred()], [exp()], judge);
    expect(r.tp).toBe(1);
    expect(r.fp).toBe(0);
    expect(r.fn).toBe(0);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("judge=no everywhere → FP for predicted, FN for expected", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "no" as const }));
    const r = await matchLLMJudge([pred()], [exp()], judge);
    expect(r.tp).toBe(0);
    expect(r.fp).toBe(1);
    expect(r.fn).toBe(1);
  });

  it("only judges same-family candidates (cross-family pair skipped)", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "yes" as const }));
    const r = await matchLLMJudge(
      [pred({ issueFamily: "NUMERIC" })],
      [exp({ issueFamily: "TEXT_CONTRADICTION" })],
      judge,
    );
    expect(judge).not.toHaveBeenCalled();
    expect(r.tp).toBe(0);
    expect(r.fp).toBe(1);
  });

  it("uncertain not counted as match by default", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "uncertain" as const }));
    const r = await matchLLMJudge([pred()], [exp()], judge);
    expect(r.tp).toBe(0);
    expect(r.uncertainCount).toBe(1);
  });

  it("uncertain counted as match when treatUncertainAsMatch=true", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "uncertain" as const }));
    const r = await matchLLMJudge([pred()], [exp()], judge, { treatUncertainAsMatch: true });
    expect(r.tp).toBe(1);
  });

  it("respects maxCandidatesPerPredicted (cost cap)", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "no" as const }));
    const expectedItems = Array.from({ length: 10 }, (_, i) => exp({ id: `e${i}` }));
    await matchLLMJudge([pred()], expectedItems, judge, { maxCandidatesPerPredicted: 3 });
    expect(judge).toHaveBeenCalledTimes(3);
  });

  it("ignores placeholder predicted (variant A)", async () => {
    const judge: LLMJudge = vi.fn(async () => ({ verdict: "yes" as const }));
    const r = await matchLLMJudge(
      [pred({ issueFamily: "PLACEHOLDER", method: "deterministic" })],
      [exp()],
      judge,
    );
    expect(judge).not.toHaveBeenCalled();
    expect(r.tp).toBe(0);
    expect(r.fn).toBe(1);
  });
});

// ─── computePerFamily ────────────────────────────────────────

describe("computePerFamily", () => {
  it("breaks down stats by family", () => {
    const predicted = [
      pred({ id: "p1", issueFamily: "NUMERIC", anchorQuote: "120 пациентов" }),
      // намеренно несовместимая пара по TEXT_CONTRADICTION: разные zone+type → lenient miss
      pred({
        id: "p2",
        issueFamily: "TEXT_CONTRADICTION",
        anchorZone: "DESIGN",
        issueType: "wrong_terminology",
        anchorQuote: "иначе",
      }),
    ];
    const expected = [
      exp({ id: "e1", issueFamily: "NUMERIC", anchorQuote: "120 пациентов" }),
      exp({
        id: "e2",
        issueFamily: "TEXT_CONTRADICTION",
        anchorZone: "SAFETY",
        issueType: "ae_definition_mismatch",
        anchorQuote: "другое",
      }),
    ];
    const br = computePerFamily(predicted, expected);
    expect(br.NUMERIC).toBeDefined();
    expect(br.NUMERIC!.tp).toBe(1);
    expect(br.TEXT_CONTRADICTION).toBeDefined();
    expect(br.TEXT_CONTRADICTION!.tp).toBe(0);
    expect(br.TEXT_CONTRADICTION!.expectedCount).toBe(1);
    expect(br.TEXT_CONTRADICTION!.predictedCount).toBe(1);
  });
});

// ─── applyFamilyScope (partial_by_family) ────────────────────

describe("applyFamilyScope", () => {
  it("filters to mustDetectFamilies when coverage=partial_by_family", () => {
    const items = [
      pred({ id: "p1", issueFamily: "NUMERIC" }),
      pred({ id: "p2", issueFamily: "TEXT_CONTRADICTION" }),
    ];
    const r = applyFamilyScope(items, {
      findings: [],
      problems: [],
      coverage: "partial_by_family",
      mustDetectFamilies: ["NUMERIC"],
    });
    expect(r.map((x) => x.id)).toEqual(["p1"]);
  });
  it("no-op when coverage=complete", () => {
    const items = [pred({ id: "p1" }), pred({ id: "p2", issueFamily: "TEXT_CONTRADICTION" })];
    const r = applyFamilyScope(items, { findings: [], problems: [], coverage: "complete" });
    expect(r.length).toBe(2);
  });
});
