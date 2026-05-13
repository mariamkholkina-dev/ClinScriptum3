import type {
  ExpectedFinding,
  ExpectedProblem,
  GoldenIntraAuditExpected,
  PredictedFinding,
} from "@clinscriptum/shared";

// ─── Public types ────────────────────────────────────────────

export interface MatchStats {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CascadeResult {
  strict: MatchStats;
  lenient: MatchStats;
  /** Пары predicted → expected ID, выбранные жадно по убыванию score.
   *  Полезно для отладки и Sprint 4 dashboard. */
  decisions: Array<{
    predictedId: string;
    expectedId: string | null;
    tier: "strict" | "lenient" | "miss";
    score: number;
  }>;
}

export interface CoverageResult extends MatchStats {
  totalProblems: number;
  coveredProblemIds: string[];
  missedProblemIds: string[];
  /** Predicted findings, для которых нет ни одной problem
   *  с совпадающим (family, zone). Кандидаты на hallucination. */
  hallucinationCandidateIds: string[];
}

export interface JudgeDecision {
  predictedId: string;
  expectedId: string | null;
  verdict: "yes" | "no" | "uncertain";
  rationale?: string;
}

export interface LLMJudgeResult extends MatchStats {
  decisions: JudgeDecision[];
  /** uncertain считаем как FP по умолчанию — но видно отдельно. */
  uncertainCount: number;
}

export type LLMJudge = (
  predicted: PredictedFinding,
  expected: ExpectedFinding,
) => Promise<{ verdict: "yes" | "no" | "uncertain"; rationale?: string }>;

// ─── Filter: вариант A (исключаем placeholder/deterministic из метрики) ─

const DETERMINISTIC_FAMILIES = new Set(["PLACEHOLDER", "EDITORIAL"]);

export function isExcludedFromMetric(f: PredictedFinding): boolean {
  if (f.method === "deterministic") return true;
  if (f.issueFamily && DETERMINISTIC_FAMILIES.has(f.issueFamily.toUpperCase())) return true;
  return false;
}

export function isExpectedExcluded(e: ExpectedFinding | ExpectedProblem): boolean {
  return DETERMINISTIC_FAMILIES.has(e.issueFamily.toUpperCase());
}

export function applyFamilyScope<T extends { issueFamily: string | null }>(
  items: T[],
  expected: GoldenIntraAuditExpected,
): T[] {
  if (expected.coverage !== "partial_by_family" || !expected.mustDetectFamilies?.length) {
    return items;
  }
  const allowed = new Set(expected.mustDetectFamilies.map((s) => s.toUpperCase()));
  return items.filter((i) => i.issueFamily && allowed.has(i.issueFamily.toUpperCase()));
}

// ─── Quote / scoring helpers ─────────────────────────────────

export function normalizeQuote(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»"'`„""''(),;:!?–——–-]/g, "")
    .trim();
}

/** Жаккард по словам нормализованных цитат. 0..1 */
export function quoteOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeQuote(a);
  const nb = normalizeQuote(b);
  if (!na || !nb) return 0;
  const aw = new Set(na.split(" ").filter(Boolean));
  const bw = new Set(nb.split(" ").filter(Boolean));
  if (aw.size === 0 || bw.size === 0) return 0;
  let inter = 0;
  for (const w of aw) if (bw.has(w)) inter++;
  const union = aw.size + bw.size - inter;
  return union === 0 ? 0 : inter / union;
}

function eqZone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function eqFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function eqType(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ─── Cascade strict → lenient match ──────────────────────────

interface CascadeOptions {
  strictQuoteThreshold: number; // default 0.7
  lenientQuoteThreshold: number; // default 0.5
}

const DEFAULT_CASCADE: CascadeOptions = {
  strictQuoteThreshold: 0.7,
  lenientQuoteThreshold: 0.5,
};

/** strict score: family + type + zone + quote ≥ strictQuoteThreshold */
function strictScore(p: PredictedFinding, e: ExpectedFinding, opts: CascadeOptions): number {
  if (!eqFamily(p.issueFamily, e.issueFamily)) return 0;
  if (!eqType(p.issueType, e.issueType)) return 0;
  if (!eqZone(p.anchorZone, e.anchorZone)) return 0;
  const ovl = quoteOverlap(p.anchorQuote, e.anchorQuote);
  return ovl >= opts.strictQuoteThreshold ? ovl : 0;
}

/** lenient score: family + (quote ≥ lenientQuoteThreshold OR (type+zone)) */
function lenientScore(p: PredictedFinding, e: ExpectedFinding, opts: CascadeOptions): number {
  if (!eqFamily(p.issueFamily, e.issueFamily)) return 0;
  const ovl = quoteOverlap(p.anchorQuote, e.anchorQuote);
  if (ovl >= opts.lenientQuoteThreshold) return ovl;
  if (eqType(p.issueType, e.issueType) && eqZone(p.anchorZone, e.anchorZone)) return 0.5;
  return 0;
}

/** Жадное 1-к-1 паросочетание: сортируем все ненулевые пары по убыванию score,
 *  забираем сверху, помечая использованные predicted и expected. Достаточно
 *  для baseline; в Sprint 4 можно заменить на Hungarian. */
function greedyMatch(
  predicted: PredictedFinding[],
  expected: ExpectedFinding[],
  scorer: (p: PredictedFinding, e: ExpectedFinding) => number,
): { tp: number; matched: Map<string, string>; missScores: Map<string, number> } {
  const pairs: Array<{ pi: number; ei: number; s: number }> = [];
  for (let pi = 0; pi < predicted.length; pi++) {
    for (let ei = 0; ei < expected.length; ei++) {
      const s = scorer(predicted[pi]!, expected[ei]!);
      if (s > 0) pairs.push({ pi, ei, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const usedP = new Set<number>();
  const usedE = new Set<number>();
  const matched = new Map<string, string>();
  const missScores = new Map<string, number>();
  for (const { pi, ei } of pairs) {
    if (usedP.has(pi) || usedE.has(ei)) continue;
    usedP.add(pi);
    usedE.add(ei);
    matched.set(predicted[pi]!.id, expected[ei]!.id);
  }
  for (let pi = 0; pi < predicted.length; pi++) {
    if (!usedP.has(pi)) {
      const best = expected.reduce((m, e) => Math.max(m, scorer(predicted[pi]!, e)), 0);
      missScores.set(predicted[pi]!.id, best);
    }
  }
  return { tp: matched.size, matched, missScores };
}

export function matchCascade(
  predicted: PredictedFinding[],
  expected: ExpectedFinding[],
  opts: Partial<CascadeOptions> = {},
): CascadeResult {
  const o = { ...DEFAULT_CASCADE, ...opts };
  const must = expected.filter((e) => e.mustDetect && !isExpectedExcluded(e));
  const cand = predicted.filter((p) => !isExcludedFromMetric(p));

  const strictRun = greedyMatch(cand, must, (p, e) => strictScore(p, e, o));
  const lenientRun = greedyMatch(cand, must, (p, e) => lenientScore(p, e, o));

  const decisions: CascadeResult["decisions"] = [];
  for (const p of cand) {
    const sId = strictRun.matched.get(p.id);
    const lId = lenientRun.matched.get(p.id);
    if (sId) decisions.push({ predictedId: p.id, expectedId: sId, tier: "strict", score: 1 });
    else if (lId) decisions.push({ predictedId: p.id, expectedId: lId, tier: "lenient", score: lenientRun.missScores.get(p.id) ?? 0.5 });
    else decisions.push({ predictedId: p.id, expectedId: null, tier: "miss", score: 0 });
  }

  return {
    strict: stats(strictRun.tp, cand.length - strictRun.tp, must.length - strictRun.tp),
    lenient: stats(lenientRun.tp, cand.length - lenientRun.tp, must.length - lenientRun.tp),
    decisions,
  };
}

// ─── Document-level coverage ─────────────────────────────────

/** Coverage по уникальным проблемам документа.
 *  TP = problem, для которой есть хотя бы один predicted в том же (family, zone).
 *  FN = mustDetect problem без матча.
 *  FP = predicted без ни одной соответствующей problem (hallucination candidate). */
export function matchCoverage(
  predicted: PredictedFinding[],
  problems: ExpectedProblem[],
): CoverageResult {
  const must = problems.filter((p) => p.mustDetect && !isExpectedExcluded(p));
  const cand = predicted.filter((p) => !isExcludedFromMetric(p));

  const coveredIds: string[] = [];
  const missedIds: string[] = [];
  for (const problem of must) {
    const hit = cand.some(
      (p) => eqFamily(p.issueFamily, problem.issueFamily) && eqZone(p.anchorZone, problem.anchorZone),
    );
    if (hit) coveredIds.push(problem.id);
    else missedIds.push(problem.id);
  }

  const hallucinationCandidateIds: string[] = [];
  for (const p of cand) {
    const matchesAny = problems.some(
      (problem) =>
        eqFamily(p.issueFamily, problem.issueFamily) && eqZone(p.anchorZone, problem.anchorZone),
    );
    if (!matchesAny) hallucinationCandidateIds.push(p.id);
  }

  const tp = coveredIds.length;
  const fn = missedIds.length;
  const fp = hallucinationCandidateIds.length;

  return {
    ...stats(tp, fp, fn),
    totalProblems: must.length,
    coveredProblemIds: coveredIds,
    missedProblemIds: missedIds,
    hallucinationCandidateIds,
  };
}

// ─── LLM-as-judge match (primary) ────────────────────────────

interface LLMJudgeOptions {
  /** Ограничиваем число пар на predicted, чтобы не взорвать стоимость.
   *  Сначала фильтруем по family, потом сортируем по убыванию quote overlap
   *  и берём топ-K кандидатов на judging. */
  maxCandidatesPerPredicted: number;
  /** uncertain → засчитывать как match? По умолчанию — нет (строже precision). */
  treatUncertainAsMatch: boolean;
}

const DEFAULT_LLM_JUDGE: LLMJudgeOptions = {
  maxCandidatesPerPredicted: 3,
  treatUncertainAsMatch: false,
};

export async function matchLLMJudge(
  predicted: PredictedFinding[],
  expected: ExpectedFinding[],
  judge: LLMJudge,
  opts: Partial<LLMJudgeOptions> = {},
): Promise<LLMJudgeResult> {
  const o = { ...DEFAULT_LLM_JUDGE, ...opts };
  const must = expected.filter((e) => e.mustDetect && !isExpectedExcluded(e));
  const cand = predicted.filter((p) => !isExcludedFromMetric(p));

  const usedExpected = new Set<string>();
  const decisions: JudgeDecision[] = [];
  let tp = 0;
  let uncertainCount = 0;

  for (const p of cand) {
    const candidates = must
      .filter((e) => !usedExpected.has(e.id) && eqFamily(p.issueFamily, e.issueFamily))
      .map((e) => ({ e, overlap: quoteOverlap(p.anchorQuote, e.anchorQuote) }))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, o.maxCandidatesPerPredicted);

    let matchedE: ExpectedFinding | null = null;
    let lastDecision: JudgeDecision | null = null;
    for (const { e } of candidates) {
      const { verdict, rationale } = await judge(p, e);
      const d: JudgeDecision = { predictedId: p.id, expectedId: e.id, verdict, rationale };
      decisions.push(d);
      lastDecision = d;
      if (verdict === "yes") {
        matchedE = e;
        break;
      }
      if (verdict === "uncertain") {
        uncertainCount++;
        if (o.treatUncertainAsMatch) {
          matchedE = e;
          break;
        }
      }
    }

    if (matchedE) {
      usedExpected.add(matchedE.id);
      tp++;
    } else if (!lastDecision) {
      // не было кандидатов одного family — predicted сразу FP
      decisions.push({ predictedId: p.id, expectedId: null, verdict: "no" });
    }
  }

  const fp = cand.length - tp;
  const fn = must.length - tp;
  return { ...stats(tp, fp, fn), decisions, uncertainCount };
}

// ─── Per-family breakdown ────────────────────────────────────

export interface PerFamilyBreakdown {
  [family: string]: MatchStats & { expectedCount: number; predictedCount: number };
}

/** Рассчитывает per-family статистики, используя cascade-lenient как opinion.
 *  Один проход — каждой family даём свой набор predicted/expected. */
export function computePerFamily(
  predicted: PredictedFinding[],
  expected: ExpectedFinding[],
  opts: Partial<CascadeOptions> = {},
): PerFamilyBreakdown {
  const cand = predicted.filter((p) => !isExcludedFromMetric(p));
  const must = expected.filter((e) => e.mustDetect && !isExpectedExcluded(e));
  const families = new Set<string>();
  for (const p of cand) if (p.issueFamily) families.add(p.issueFamily.toUpperCase());
  for (const e of must) families.add(e.issueFamily.toUpperCase());

  const out: PerFamilyBreakdown = {};
  for (const family of families) {
    const p = cand.filter((x) => (x.issueFamily ?? "").toUpperCase() === family);
    const e = must.filter((x) => x.issueFamily.toUpperCase() === family);
    const r = matchCascade(p, e, opts);
    out[family] = {
      ...r.lenient,
      expectedCount: e.length,
      predictedCount: p.length,
    };
  }
  return out;
}

// ─── stats helper ────────────────────────────────────────────

function stats(tp: number, fp: number, fn: number): MatchStats {
  const precision = tp + fp === 0 ? (tp === 0 ? 1 : 0) : tp / (tp + fp);
  const recall = tp + fn === 0 ? (tp === 0 ? 1 : 0) : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}
