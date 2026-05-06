import { prisma } from "@clinscriptum/db";
import { logger } from "../lib/logger.js";

interface StageMetrics {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgPrecision: number | null;
  avgRecall: number | null;
  avgF1: number | null;
}

export async function handleRunEvaluation(data: { evaluationRunId: string }) {
  const startTime = Date.now();

  const run = await prisma.evaluationRun.findUnique({
    where: { id: data.evaluationRunId },
    include: {
      ruleSetVersion: true,
      llmConfig: true,
    },
  });

  if (!run) {
    throw new Error(`EvaluationRun ${data.evaluationRunId} not found`);
  }

  await prisma.evaluationRun.update({
    where: { id: run.id },
    data: { status: "running" },
  });

  try {
    const goldenSamples = await prisma.goldenSample.findMany({
      where: { tenantId: run.tenantId },
      include: {
        stageStatuses: {
          where: { status: "approved" },
        },
        documents: {
          include: {
            documentVersion: true,
          },
        },
      },
    });

    const samplesWithApproved = goldenSamples.filter(
      (s) => s.stageStatuses.length > 0,
    );

    logger.info("Starting evaluation run", {
      evaluationRunId: run.id,
      totalSamples: samplesWithApproved.length,
      stages: [
        ...new Set(samplesWithApproved.flatMap((s) => s.stageStatuses.map((ss) => ss.stage))),
      ],
    });

    let totalResults = 0;
    let passedResults = 0;
    let failedResults = 0;
    const stageAggregation: Record<string, { precisions: number[]; recalls: number[]; f1s: number[]; passed: number; total: number }> = {};
    let factExpectedTotal = 0;
    let factMatchedTotal = 0;

    for (const sample of samplesWithApproved) {
      for (const stageStatus of sample.stageStatuses) {
        const stage = stageStatus.stage;
        const expected = stageStatus.expectedResults as Record<string, unknown>;

        const primaryDoc = sample.documents[0];
        if (!primaryDoc) {
          logger.warn("Golden sample has no documents, skipping", {
            goldenSampleId: sample.id,
          });
          continue;
        }

        const docVersionId = primaryDoc.documentVersionId;
        const stageStart = Date.now();

        try {
          const actual = await loadActualResults(docVersionId, stage);
          const { precision, recall, f1, diff } = compareResults(expected, actual);
          const status = f1 !== null && f1 >= 0.8 ? "pass" : "fail";

          const coverageByFactKey =
            stage === "extraction" ? computeFactCoverage(expected, actual) : null;
          if (coverageByFactKey) {
            for (const v of Object.values(coverageByFactKey)) {
              factExpectedTotal += v.expected;
              factMatchedTotal += v.matched;
            }
          }

          const confidenceMetrics =
            stage === "extraction" ? computeConfidenceMetrics(expected, actual) : null;

          await prisma.evaluationResult.create({
            data: {
              evaluationRunId: run.id,
              goldenSampleId: sample.id,
              stage,
              status,
              expected: expected as object,
              actual: actual as object,
              diff: diff as object,
              precision,
              recall,
              f1,
              latencyMs: Date.now() - stageStart,
              ...(coverageByFactKey ? { coverageByFactKey: coverageByFactKey as object } : {}),
              ...(confidenceMetrics ? { confidenceMetrics: confidenceMetrics as object } : {}),
            },
          });

          totalResults++;
          if (status === "pass") passedResults++;
          else failedResults++;

          if (!stageAggregation[stage]) {
            stageAggregation[stage] = { precisions: [], recalls: [], f1s: [], passed: 0, total: 0 };
          }
          stageAggregation[stage].total++;
          if (status === "pass") stageAggregation[stage].passed++;
          if (precision !== null) stageAggregation[stage].precisions.push(precision);
          if (recall !== null) stageAggregation[stage].recalls.push(recall);
          if (f1 !== null) stageAggregation[stage].f1s.push(f1);
        } catch (err) {
          await prisma.evaluationResult.create({
            data: {
              evaluationRunId: run.id,
              goldenSampleId: sample.id,
              stage,
              status: "error",
              expected: expected as object,
              actual: {},
              diff: { error: (err as Error).message },
              latencyMs: Date.now() - stageStart,
            },
          });
          totalResults++;
          failedResults++;

          logger.error("Error evaluating stage for sample", {
            evaluationRunId: run.id,
            goldenSampleId: sample.id,
            stage,
            error: (err as Error).message,
          });
        }
      }
    }

    const metrics: Record<string, StageMetrics> = {};
    for (const [stage, agg] of Object.entries(stageAggregation)) {
      metrics[stage] = {
        total: agg.total,
        passed: agg.passed,
        failed: agg.total - agg.passed,
        passRate: agg.total > 0 ? agg.passed / agg.total : 0,
        avgPrecision: agg.precisions.length > 0 ? avg(agg.precisions) : null,
        avgRecall: agg.recalls.length > 0 ? avg(agg.recalls) : null,
        avgF1: agg.f1s.length > 0 ? avg(agg.f1s) : null,
      };
    }

    let delta: Record<string, unknown> | undefined;
    if (run.comparedToRunId) {
      delta = await computeDelta(run.id, run.comparedToRunId);
    }

    // Sprint 5.3: метрика observability — сколько активных few-shot примеров
    // и каких zones было в момент evaluation. Если есть baseline сравнение и
    // delta содержит avgF1 change, можем грубо оценить «потенциальное влияние»
    // few-shot: zones с high coverage в few-shots более вероятно изменятся.
    // Это observability, не строгое measurement; для строгого нужен ablation.
    const fewShots = await prisma.classificationFewShot.findMany({
      where: { tenantId: run.tenantId, isActive: true },
      select: { standardSection: true },
    });
    const fewShotByZone: Record<string, number> = {};
    for (const fs of fewShots) {
      fewShotByZone[fs.standardSection] = (fewShotByZone[fs.standardSection] ?? 0) + 1;
    }
    const fewShotMetrics = {
      activeCount: fewShots.length,
      zonesCovered: Object.keys(fewShotByZone).length,
      byZone: fewShotByZone,
    };

    const durationMs = Date.now() - startTime;

    const factCoverage =
      factExpectedTotal > 0 ? factMatchedTotal / factExpectedTotal : null;

    await prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        metrics: { ...metrics, fewShots: fewShotMetrics } as object,
        durationMs,
        totalSamples: totalResults,
        passedSamples: passedResults,
        failedSamples: failedResults,
        completedAt: new Date(),
        ...(factCoverage !== null ? { factCoverage } : {}),
        ...(delta ? { delta: delta as object } : {}),
      },
    });

    logger.info("Evaluation run completed", {
      evaluationRunId: run.id,
      totalResults,
      passedResults,
      failedResults,
      durationMs,
    });

    return { success: true, totalResults, passedResults, failedResults };
  } catch (error) {
    await prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        metrics: { error: (error as Error).message },
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });

    logger.error("Evaluation run failed", {
      evaluationRunId: run.id,
      error: (error as Error).message,
    });

    throw error;
  }
}

async function loadActualResults(
  docVersionId: string,
  stage: string,
): Promise<Record<string, unknown>> {
  switch (stage) {
    case "parsing": {
      // Expected format (from golden_sample_stage_statuses.expected_results):
      //   { sections: [{ level, order, title, hasContent }, ...] }
      // extractKeys() will JSON.stringify each object to a key that must match
      // the expected one byte-for-byte — keep field order and types aligned.
      // Filter out isFalseHeading sections: those are not part of the document
      // structure and should not appear in either expected or actual.
      const sections = await prisma.section.findMany({
        where: { docVersionId, isFalseHeading: false },
        orderBy: { order: "asc" },
        select: {
          level: true,
          order: true,
          title: true,
          contentBlocks: { select: { id: true }, take: 1 },
        },
      });
      return {
        sections: sections.map((s) => ({
          level: s.level,
          order: s.order,
          title: s.title,
          hasContent: s.contentBlocks.length > 0,
        })),
      };
    }
    case "classification": {
      const sections = await prisma.section.findMany({
        where: { docVersionId },
        orderBy: { order: "asc" },
        select: { id: true, title: true, standardSection: true },
      });
      return {
        sections: sections.map((s) => ({
          id: s.id,
          title: s.title,
          standardSection: s.standardSection,
        })),
      };
    }
    case "extraction": {
      const facts = await prisma.fact.findMany({
        where: { docVersionId },
        select: {
          id: true,
          factKey: true,
          factCategory: true,
          value: true,
          confidence: true,
          factClass: true,
        },
      });
      return {
        facts: facts.map((f) => ({
          id: f.id,
          factKey: f.factKey,
          factCategory: f.factCategory,
          value: f.value,
          confidence: f.confidence,
          factClass: f.factClass,
        })),
      };
    }
    case "contradiction_detection": {
      const facts = await prisma.fact.findMany({
        where: { docVersionId, hasContradiction: true },
        select: { id: true, factKey: true, value: true },
      });
      return { contradictions: facts };
    }
    default:
      return {};
  }
}

function compareResults(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): { precision: number | null; recall: number | null; f1: number | null; diff: Record<string, unknown> } {
  const expectedKeys = extractKeys(expected);
  const actualKeys = extractKeys(actual);

  if (expectedKeys.size === 0 && actualKeys.size === 0) {
    return { precision: 1, recall: 1, f1: 1, diff: { matches: true } };
  }

  if (expectedKeys.size === 0 || actualKeys.size === 0) {
    return {
      precision: actualKeys.size === 0 ? 1 : 0,
      recall: expectedKeys.size === 0 ? 1 : 0,
      f1: 0,
      diff: {
        missing: [...expectedKeys].filter((k) => !actualKeys.has(k)),
        extra: [...actualKeys].filter((k) => !expectedKeys.has(k)),
      },
    };
  }

  const truePositives = [...expectedKeys].filter((k) => actualKeys.has(k)).length;
  const precision = actualKeys.size > 0 ? truePositives / actualKeys.size : 0;
  const recall = expectedKeys.size > 0 ? truePositives / expectedKeys.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    precision,
    recall,
    f1,
    diff: {
      truePositives,
      missing: [...expectedKeys].filter((k) => !actualKeys.has(k)),
      extra: [...actualKeys].filter((k) => !expectedKeys.has(k)),
    },
  };
}

interface FactCoverageEntry {
  expected: number;
  extracted: number;
  matched: number;
}

/**
 * Phase 5 fact-extraction roadmap: confidence quality metrics.
 *
 * For each extracted fact we know:
 *   - the model's predicted confidence (in `actual.facts[].confidence`)
 *   - the ground-truth correctness (matched against `expected.facts[]` by
 *     factKey + value)
 *
 * This lets us compute the Brier score: mean squared error between
 * predicted probability and the 0/1 outcome. Lower is better; well-
 * calibrated models score < 0.10.
 *
 * Returns `null` if we have no predictions to score.
 */
export function computeConfidenceMetrics(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): { brierScore: number; sampleSize: number } | null {
  const expFacts = Array.isArray(expected.facts) ? (expected.facts as unknown[]) : [];
  const actFacts = Array.isArray(actual.facts) ? (actual.facts as unknown[]) : [];
  if (actFacts.length === 0) return null;

  const expByKey = new Map<string, Set<string>>();
  for (const f of expFacts) {
    if (typeof f !== "object" || f === null) continue;
    const obj = f as Record<string, unknown>;
    const k = obj.factKey != null ? String(obj.factKey) : null;
    if (!k) continue;
    const v = obj.value != null ? String(obj.value).trim().toLowerCase() : "";
    const set = expByKey.get(k) ?? new Set<string>();
    set.add(v);
    expByKey.set(k, set);
  }

  let sumSq = 0;
  let n = 0;
  for (const f of actFacts) {
    if (typeof f !== "object" || f === null) continue;
    const obj = f as Record<string, unknown>;
    const k = obj.factKey != null ? String(obj.factKey) : null;
    if (!k) continue;
    const v = obj.value != null ? String(obj.value).trim().toLowerCase() : "";
    const conf = typeof obj.confidence === "number" ? obj.confidence : null;
    if (conf === null || conf < 0 || conf > 1) continue;
    const expSet = expByKey.get(k);
    const correct = expSet?.has(v) ? 1 : 0;
    sumSq += (conf - correct) * (conf - correct);
    n++;
  }
  if (n === 0) return null;
  return { brierScore: sumSq / n, sampleSize: n };
}

export function computeFactCoverage(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): Record<string, FactCoverageEntry> {
  const collect = (data: Record<string, unknown>): Map<string, Set<string>> => {
    const map = new Map<string, Set<string>>();
    const facts = data.facts;
    if (!Array.isArray(facts)) return map;
    for (const item of facts) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      const factKey = obj.factKey != null ? String(obj.factKey) : null;
      if (!factKey) continue;
      const value = obj.value != null ? String(obj.value).trim().toLowerCase() : "";
      const set = map.get(factKey) ?? new Set<string>();
      set.add(value);
      map.set(factKey, set);
    }
    return map;
  };

  const exp = collect(expected);
  const act = collect(actual);
  const allKeys = new Set<string>([...exp.keys(), ...act.keys()]);
  const out: Record<string, FactCoverageEntry> = {};
  for (const key of allKeys) {
    const e = exp.get(key) ?? new Set();
    const a = act.get(key) ?? new Set();
    let matched = 0;
    for (const v of e) if (a.has(v)) matched++;
    out[key] = { expected: e.size, extracted: a.size, matched };
  }
  return out;
}

function extractKeys(data: Record<string, unknown>): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          const obj = item as Record<string, unknown>;
          // For classification stage (key='sections'): match by (title, standardSection) pair.
          // Старая логика — set-уровень по уникальным standardSection — занижала f1 для документов
          // с дублями зон (3 секции safety считались как 1). См. task 1.6 в плане.
          if (key === "sections" && obj.title != null && "standardSection" in obj) {
            const title = String(obj.title).trim().toLowerCase();
            keys.add(`sections:${title}=${String(obj.standardSection)}`);
            continue;
          }
          const identifier =
            obj.factKey ??
            obj.standardSection ??
            obj.id ??
            JSON.stringify(item);
          keys.add(`${key}:${String(identifier)}`);
        } else {
          keys.add(`${key}:${String(item)}`);
        }
      }
    } else {
      keys.add(`${key}:${String(value)}`);
    }
  }
  return keys;
}

async function computeDelta(
  currentRunId: string,
  comparedToRunId: string,
): Promise<Record<string, unknown>> {
  const [currentResults, comparedResults] = await Promise.all([
    prisma.evaluationResult.findMany({ where: { evaluationRunId: currentRunId } }),
    prisma.evaluationResult.findMany({ where: { evaluationRunId: comparedToRunId } }),
  ]);

  const currentByStage = groupByStage(currentResults);
  const comparedByStage = groupByStage(comparedResults);

  const allStages = new Set([
    ...Object.keys(currentByStage),
    ...Object.keys(comparedByStage),
  ]);

  const delta: Record<string, unknown> = {};
  for (const stage of allStages) {
    const curr = currentByStage[stage];
    const prev = comparedByStage[stage];
    delta[stage] = {
      current: curr ?? null,
      previous: prev ?? null,
      precisionDelta: safeDelta(curr?.avgPrecision, prev?.avgPrecision),
      recallDelta: safeDelta(curr?.avgRecall, prev?.avgRecall),
      f1Delta: safeDelta(curr?.avgF1, prev?.avgF1),
    };
  }

  return delta;
}

function groupByStage(
  results: Array<{
    stage: string;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  }>,
): Record<string, { avgPrecision: number | null; avgRecall: number | null; avgF1: number | null }> {
  const groups: Record<string, typeof results> = {};
  for (const r of results) {
    (groups[r.stage] ??= []).push(r);
  }

  const out: Record<string, { avgPrecision: number | null; avgRecall: number | null; avgF1: number | null }> = {};
  for (const [stage, items] of Object.entries(groups)) {
    const precisions = items.map((r) => r.precision).filter((v): v is number => v != null);
    const recalls = items.map((r) => r.recall).filter((v): v is number => v != null);
    const f1s = items.map((r) => r.f1).filter((v): v is number => v != null);
    out[stage] = {
      avgPrecision: precisions.length > 0 ? avg(precisions) : null,
      avgRecall: recalls.length > 0 ? avg(recalls) : null,
      avgF1: f1s.length > 0 ? avg(f1s) : null,
    };
  }
  return out;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function safeDelta(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return a - b;
}
