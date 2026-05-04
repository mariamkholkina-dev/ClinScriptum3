import { prisma } from "@clinscriptum/db";
import type { ContextStrategy, EvaluationRunType } from "@prisma/client";
import { DomainError } from "./errors.js";
import { enqueueJob } from "../lib/queue.js";
import { logger } from "../lib/logger.js";
import {
  computeSoaMetrics,
  parseExpectedSoa,
  type ActualSoaTable,
  type SoaMetrics,
} from "../lib/soa-metrics.js";

export const evaluationService = {
  async createRun(
    tenantId: string,
    data: {
      name?: string;
      type: EvaluationRunType;
      createdById: string;
      ruleSetVersionId?: string;
      llmConfigId?: string;
      contextStrategy?: ContextStrategy;
      chunkSizeChars?: number;
      comparedToRunId?: string;
    },
  ) {
    const run = await prisma.evaluationRun.create({
      data: {
        tenantId,
        name: data.name,
        type: data.type,
        status: "queued",
        createdById: data.createdById,
        ruleSetVersionId: data.ruleSetVersionId,
        llmConfigId: data.llmConfigId,
        contextStrategy: data.contextStrategy,
        chunkSizeChars: data.chunkSizeChars,
        comparedToRunId: data.comparedToRunId,
      },
    });

    const jobName =
      data.type === "single"
        ? "run_evaluation"
        : data.type === "batch"
          ? "run_batch_evaluation"
          : null;

    if (jobName) {
      await enqueueJob(jobName, { evaluationRunId: run.id });
      logger.info("Evaluation job enqueued", { evaluationRunId: run.id, jobName });
    } else {
      logger.warn(
        "Evaluation type has no worker handler — run stays queued until handler is added",
        { evaluationRunId: run.id, type: data.type },
      );
    }

    return run;
  },

  async getRun(id: string, tenantId: string) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id },
      include: {
        results: {
          include: {
            goldenSample: { select: { id: true, name: true, sampleType: true } },
          },
          orderBy: { stage: "asc" },
        },
        createdBy: { select: { id: true, email: true, name: true } },
        ruleSetVersion: { select: { id: true, version: true } },
        llmConfig: { select: { id: true, name: true } },
        comparedToRun: { select: { id: true, name: true, status: true } },
      },
    });
    if (!run || run.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }
    return run;
  },

  async listRuns(
    tenantId: string,
    filters?: { type?: string; status?: string },
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;

    return prisma.evaluationRun.findMany({
      where,
      include: {
        createdBy: { select: { id: true, email: true, name: true } },
        _count: { select: { results: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async updateRunStatus(
    id: string,
    status: string,
    data?: {
      metrics?: unknown;
      cost?: number;
      durationMs?: number;
      totalSamples?: number;
      passedSamples?: number;
      failedSamples?: number;
      completedAt?: Date;
    },
  ) {
    const run = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!run) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    const updateData: Record<string, unknown> = { status };
    if (data?.metrics !== undefined) updateData.metrics = data.metrics;
    if (data?.cost !== undefined) updateData.cost = data.cost;
    if (data?.durationMs !== undefined) updateData.durationMs = data.durationMs;
    if (data?.totalSamples !== undefined) updateData.totalSamples = data.totalSamples;
    if (data?.passedSamples !== undefined) updateData.passedSamples = data.passedSamples;
    if (data?.failedSamples !== undefined) updateData.failedSamples = data.failedSamples;
    if (data?.completedAt !== undefined) updateData.completedAt = data.completedAt;

    return prisma.evaluationRun.update({
      where: { id },
      data: updateData,
    });
  },

  async addResult(
    evaluationRunId: string,
    data: {
      goldenSampleId: string;
      stage: string;
      status: string;
      expected: unknown;
      actual: unknown;
      diff: unknown;
      algoResult?: unknown;
      llmResult?: unknown;
      agreement?: boolean;
      precision?: number;
      recall?: number;
      f1?: number;
      latencyMs?: number;
      tokenCost?: number;
    },
  ) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    });
    if (!run) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    return prisma.evaluationResult.create({
      data: {
        evaluationRunId,
        goldenSampleId: data.goldenSampleId,
        stage: data.stage,
        status: data.status as "pending" | "pass" | "fail" | "error" | "skipped",
        expected: data.expected as object,
        actual: data.actual as object,
        diff: data.diff as object,
        algoResult: data.algoResult as object | undefined,
        llmResult: data.llmResult as object | undefined,
        agreement: data.agreement,
        precision: data.precision,
        recall: data.recall,
        f1: data.f1,
        latencyMs: data.latencyMs,
        tokenCost: data.tokenCost,
      },
    });
  },

  async getRunResults(
    evaluationRunId: string,
    tenantId: string,
    filters?: { stage?: string; status?: string },
  ) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    });
    if (!run || run.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    const where: Record<string, unknown> = { evaluationRunId };
    if (filters?.stage) where.stage = filters.stage;
    if (filters?.status) where.status = filters.status;

    return prisma.evaluationResult.findMany({
      where,
      include: {
        goldenSample: { select: { id: true, name: true, sampleType: true } },
      },
      orderBy: [{ stage: "asc" }, { goldenSampleId: "asc" }],
    });
  },

  async compareRuns(runId1: string, runId2: string, tenantId: string) {
    const [run1, run2] = await Promise.all([
      prisma.evaluationRun.findUnique({ where: { id: runId1 } }),
      prisma.evaluationRun.findUnique({ where: { id: runId2 } }),
    ]);
    if (!run1 || run1.tenantId !== tenantId) throw new DomainError("NOT_FOUND", "First evaluation run not found");
    if (!run2 || run2.tenantId !== tenantId) throw new DomainError("NOT_FOUND", "Second evaluation run not found");

    const [results1, results2] = await Promise.all([
      prisma.evaluationResult.findMany({ where: { evaluationRunId: runId1 } }),
      prisma.evaluationResult.findMany({ where: { evaluationRunId: runId2 } }),
    ]);

    const stageMetrics1 = aggregateByStage(results1);
    const stageMetrics2 = aggregateByStage(results2);

    const allStages = new Set([
      ...Object.keys(stageMetrics1),
      ...Object.keys(stageMetrics2),
    ]);

    const delta: Record<
      string,
      {
        run1: StageAggregation;
        run2: StageAggregation;
        precisionDelta: number | null;
        recallDelta: number | null;
        f1Delta: number | null;
        passRateDelta: number;
      }
    > = {};

    for (const stage of allStages) {
      const m1 = stageMetrics1[stage] ?? emptyAggregation();
      const m2 = stageMetrics2[stage] ?? emptyAggregation();
      delta[stage] = {
        run1: m1,
        run2: m2,
        precisionDelta: safeDelta(m2.avgPrecision, m1.avgPrecision),
        recallDelta: safeDelta(m2.avgRecall, m1.avgRecall),
        f1Delta: safeDelta(m2.avgF1, m1.avgF1),
        passRateDelta: m2.passRate - m1.passRate,
      };
    }

    return {
      run1: { id: run1.id, name: run1.name, status: run1.status, createdAt: run1.createdAt },
      run2: { id: run2.id, name: run2.name, status: run2.status, createdAt: run2.createdAt },
      delta,
    };
  },

  async getRunMetrics(evaluationRunId: string, tenantId: string) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    });
    if (!run || run.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    const results = await prisma.evaluationResult.findMany({
      where: { evaluationRunId },
    });

    const byStage = aggregateByStage(results);

    const totalResults = results.length;
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const errors = results.filter((r) => r.status === "error").length;

    const factCoverage = aggregateFactCoverage(results);

    return {
      evaluationRunId,
      totalResults,
      passed,
      failed,
      errors,
      overallPassRate: totalResults > 0 ? passed / totalResults : 0,
      stages: byStage,
      factCoverage,
    };
  },

  async deleteRun(id: string, tenantId: string) {
    const run = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!run || run.tenantId !== tenantId) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    await prisma.evaluationRun.delete({ where: { id } });
    logger.info("Evaluation run deleted", { evaluationRunId: id });
    return { success: true };
  },

  /**
   * Per-golden-sample SoA metrics. For every golden sample in the
   * tenant we look at the `soa_detection` stage status; if it carries
   * an `expectedResults` blob, we compare it against the actual
   * SoaTables of the linked DocumentVersions and produce
   * precision/recall/F1 for visits, procedures, cells and footnote
   * anchors.
   */
  async getSoaMetricsByGoldenSample(tenantId: string): Promise<
    Array<{
      goldenSampleId: string;
      sampleName: string;
      hasExpected: boolean;
      metrics: SoaMetrics;
    }>
  > {
    const samples = await prisma.goldenSample.findMany({
      where: { tenantId },
      include: {
        documents: {
          include: { documentVersion: { select: { id: true } } },
        },
        stageStatuses: { where: { stage: "soa_detection" } },
      },
    });

    const out: Array<{
      goldenSampleId: string;
      sampleName: string;
      hasExpected: boolean;
      metrics: SoaMetrics;
    }> = [];

    for (const s of samples) {
      const stage = s.stageStatuses[0];
      const expected = stage ? parseExpectedSoa(stage.expectedResults) : null;
      if (!expected) {
        out.push({
          goldenSampleId: s.id,
          sampleName: s.name,
          hasExpected: false,
          metrics: {
            detectionAgreement: null,
            visit: null,
            procedure: null,
            cell: null,
            footnoteLink: null,
          },
        });
        continue;
      }

      const versionIds = s.documents.map((d) => d.documentVersion.id);
      const tables = await prisma.soaTable.findMany({
        where: { docVersionId: { in: versionIds } },
        include: {
          cells: true,
          footnoteAnchors: { include: { footnote: { select: { marker: true } }, cell: { select: { procedureName: true, visitName: true } } } },
        },
      });

      const actual: ActualSoaTable[] = tables.map((t) => ({
        cells: t.cells.map((c) => ({
          procedureName: c.procedureName,
          visitName: c.visitName,
          rawValue: c.rawValue,
          normalizedValue: c.normalizedValue,
          manualValue: c.manualValue,
        })),
        footnoteAnchors: t.footnoteAnchors.map((a) => ({
          marker: a.footnote.marker,
          procedureName: a.cell?.procedureName ?? null,
          visitName: a.cell?.visitName ?? null,
        })),
      }));

      out.push({
        goldenSampleId: s.id,
        sampleName: s.name,
        hasExpected: true,
        metrics: computeSoaMetrics(expected, actual),
      });
    }

    return out;
  },
};

/* ═══════════════ Helpers ═══════════════ */

export interface StageAggregation {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  avgPrecision: number | null;
  avgRecall: number | null;
  avgF1: number | null;
  avgLatencyMs: number | null;
  totalTokenCost: number;
}

function emptyAggregation(): StageAggregation {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    passRate: 0,
    avgPrecision: null,
    avgRecall: null,
    avgF1: null,
    avgLatencyMs: null,
    totalTokenCost: 0,
  };
}

function aggregateByStage(
  results: Array<{
    stage: string;
    status: string;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    latencyMs: number | null;
    tokenCost: number | null;
  }>,
): Record<string, StageAggregation> {
  const groups: Record<string, typeof results> = {};
  for (const r of results) {
    (groups[r.stage] ??= []).push(r);
  }

  const out: Record<string, StageAggregation> = {};
  for (const [stage, items] of Object.entries(groups)) {
    const passed = items.filter((r) => r.status === "pass").length;
    const failed = items.filter((r) => r.status === "fail").length;

    const precisions = items.map((r) => r.precision).filter((v): v is number => v != null);
    const recalls = items.map((r) => r.recall).filter((v): v is number => v != null);
    const f1s = items.map((r) => r.f1).filter((v): v is number => v != null);
    const latencies = items.map((r) => r.latencyMs).filter((v): v is number => v != null);
    const costs = items.map((r) => r.tokenCost).filter((v): v is number => v != null);

    out[stage] = {
      total: items.length,
      passed,
      failed,
      passRate: items.length > 0 ? passed / items.length : 0,
      avgPrecision: precisions.length > 0 ? avg(precisions) : null,
      avgRecall: recalls.length > 0 ? avg(recalls) : null,
      avgF1: f1s.length > 0 ? avg(f1s) : null,
      avgLatencyMs: latencies.length > 0 ? avg(latencies) : null,
      totalTokenCost: costs.reduce((s, v) => s + v, 0),
    };
  }

  return out;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export interface CoverageEntry {
  expected: number;
  extracted: number;
  matched: number;
}

/**
 * Aggregate per-factKey coverage across all evaluation results in a run.
 * Reads `coverageByFactKey` (set by the workers' fact_extraction stage),
 * sums expected/extracted/matched per factKey, derives recall = matched /
 * expected. Returns null when no result carries coverage data — keeps
 * the dashboard's "no fact-extraction stage in this run" branch obvious.
 */
function aggregateFactCoverage(
  results: Array<{ stage: string; coverageByFactKey?: unknown }>,
): { byFactKey: Record<string, CoverageEntry & { recall: number }>; overallRecall: number } | null {
  const byKey = new Map<string, CoverageEntry>();
  let any = false;
  for (const r of results) {
    const cov = r.coverageByFactKey as Record<string, CoverageEntry> | null | undefined;
    if (!cov || typeof cov !== "object") continue;
    any = true;
    for (const [key, v] of Object.entries(cov)) {
      if (!v || typeof v !== "object") continue;
      const cur = byKey.get(key) ?? { expected: 0, extracted: 0, matched: 0 };
      cur.expected += v.expected ?? 0;
      cur.extracted += v.extracted ?? 0;
      cur.matched += v.matched ?? 0;
      byKey.set(key, cur);
    }
  }
  if (!any) return null;

  const out: Record<string, CoverageEntry & { recall: number }> = {};
  let totalExpected = 0;
  let totalMatched = 0;
  for (const [key, v] of byKey) {
    const recall = v.expected > 0 ? v.matched / v.expected : 0;
    out[key] = { ...v, recall };
    totalExpected += v.expected;
    totalMatched += v.matched;
  }
  return {
    byFactKey: out,
    overallRecall: totalExpected > 0 ? totalMatched / totalExpected : 0,
  };
}

function safeDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a - b;
}
