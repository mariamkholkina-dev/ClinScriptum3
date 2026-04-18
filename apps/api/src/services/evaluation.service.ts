import { prisma } from "@clinscriptum/db";
import type { ContextStrategy, EvaluationRunType } from "@prisma/client";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

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
    return prisma.evaluationRun.create({
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
  },

  async getRun(id: string) {
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
    if (!run) {
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
    filters?: { stage?: string; status?: string },
  ) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    });
    if (!run) {
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

  async compareRuns(runId1: string, runId2: string) {
    const [run1, run2] = await Promise.all([
      prisma.evaluationRun.findUnique({ where: { id: runId1 } }),
      prisma.evaluationRun.findUnique({ where: { id: runId2 } }),
    ]);
    if (!run1) throw new DomainError("NOT_FOUND", "First evaluation run not found");
    if (!run2) throw new DomainError("NOT_FOUND", "Second evaluation run not found");

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

  async getRunMetrics(evaluationRunId: string) {
    const run = await prisma.evaluationRun.findUnique({
      where: { id: evaluationRunId },
    });
    if (!run) {
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

    return {
      evaluationRunId,
      totalResults,
      passed,
      failed,
      errors,
      overallPassRate: totalResults > 0 ? passed / totalResults : 0,
      stages: byStage,
    };
  },

  async deleteRun(id: string) {
    const run = await prisma.evaluationRun.findUnique({ where: { id } });
    if (!run) {
      throw new DomainError("NOT_FOUND", "Evaluation run not found");
    }

    await prisma.evaluationRun.delete({ where: { id } });
    logger.info("Evaluation run deleted", { evaluationRunId: id });
    return { success: true };
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

function safeDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a - b;
}
