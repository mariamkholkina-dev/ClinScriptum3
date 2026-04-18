import { prisma } from "@clinscriptum/db";
import { logger } from "../lib/logger.js";

const CONCURRENCY = 5;

interface DocStageResult {
  docVersionId: string;
  stage: string;
  confidence: number | null;
  agreement: boolean | null;
}

export async function handleRunBatchEvaluation(data: { evaluationRunId: string }) {
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
    const studies = await prisma.study.findMany({
      where: { tenantId: run.tenantId },
      select: { id: true },
    });

    const documents = await prisma.document.findMany({
      where: { studyId: { in: studies.map((s) => s.id) } },
      select: { id: true },
    });

    const docVersions = await prisma.documentVersion.findMany({
      where: {
        documentId: { in: documents.map((d) => d.id) },
        status: { in: ["parsed", "ready"] },
      },
      select: { id: true, documentId: true },
    });

    logger.info("Starting batch evaluation", {
      evaluationRunId: run.id,
      totalDocVersions: docVersions.length,
    });

    const allResults: DocStageResult[] = [];
    const stages = ["classification", "extraction"];

    // Process documents with concurrency pool
    for (let i = 0; i < docVersions.length; i += CONCURRENCY) {
      const batch = docVersions.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((dv) => processDocumentVersion(dv.id, stages)),
      );
      allResults.push(...batchResults.flat());

      logger.debug("Batch progress", {
        evaluationRunId: run.id,
        processed: Math.min(i + CONCURRENCY, docVersions.length),
        total: docVersions.length,
      });
    }

    // Aggregate metrics per stage
    const stageMetrics: Record<string, {
      totalDocs: number;
      avgConfidence: number | null;
      confidenceDistribution: Record<string, number>;
      agreementRate: number | null;
      agreedCount: number;
      disagreedCount: number;
    }> = {};

    for (const stage of stages) {
      const stageResults = allResults.filter((r) => r.stage === stage);
      const confidences = stageResults
        .map((r) => r.confidence)
        .filter((v): v is number => v != null);
      const agreements = stageResults
        .map((r) => r.agreement)
        .filter((v): v is boolean => v != null);

      const distribution: Record<string, number> = {
        "0.0-0.2": 0,
        "0.2-0.4": 0,
        "0.4-0.6": 0,
        "0.6-0.8": 0,
        "0.8-1.0": 0,
      };
      for (const c of confidences) {
        if (c < 0.2) distribution["0.0-0.2"]++;
        else if (c < 0.4) distribution["0.2-0.4"]++;
        else if (c < 0.6) distribution["0.4-0.6"]++;
        else if (c < 0.8) distribution["0.6-0.8"]++;
        else distribution["0.8-1.0"]++;
      }

      const agreedCount = agreements.filter((a) => a).length;
      const disagreedCount = agreements.filter((a) => !a).length;

      stageMetrics[stage] = {
        totalDocs: stageResults.length,
        avgConfidence: confidences.length > 0 ? avg(confidences) : null,
        confidenceDistribution: distribution,
        agreementRate: agreements.length > 0 ? agreedCount / agreements.length : null,
        agreedCount,
        disagreedCount,
      };
    }

    let delta: Record<string, unknown> | undefined;
    if (run.comparedToRunId) {
      const prevRun = await prisma.evaluationRun.findUnique({
        where: { id: run.comparedToRunId },
      });
      if (prevRun?.metrics && typeof prevRun.metrics === "object") {
        delta = computeBatchDelta(stageMetrics, prevRun.metrics as Record<string, unknown>);
      }
    }

    const durationMs = Date.now() - startTime;

    await prisma.evaluationRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        metrics: stageMetrics as object,
        durationMs,
        totalSamples: docVersions.length,
        passedSamples: docVersions.length,
        failedSamples: 0,
        completedAt: new Date(),
        ...(delta ? { delta: delta as object } : {}),
      },
    });

    logger.info("Batch evaluation completed", {
      evaluationRunId: run.id,
      totalDocVersions: docVersions.length,
      durationMs,
    });

    return { success: true, totalDocVersions: docVersions.length };
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

    logger.error("Batch evaluation failed", {
      evaluationRunId: run.id,
      error: (error as Error).message,
    });

    throw error;
  }
}

async function processDocumentVersion(
  docVersionId: string,
  stages: string[],
): Promise<DocStageResult[]> {
  const results: DocStageResult[] = [];

  for (const stage of stages) {
    try {
      switch (stage) {
        case "classification": {
          const sections = await prisma.section.findMany({
            where: { docVersionId },
            select: { standardSection: true },
          });
          const classified = sections.filter((s) => s.standardSection != null).length;
          const total = sections.length;
          results.push({
            docVersionId,
            stage,
            confidence: total > 0 ? classified / total : null,
            agreement: null, // algo/llm agreement not yet tracked per section
          });
          break;
        }
        case "extraction": {
          const facts = await prisma.fact.findMany({
            where: { docVersionId },
            select: { confidence: true },
          });
          const avgConf =
            facts.length > 0
              ? facts.reduce((s, f) => s + f.confidence, 0) / facts.length
              : null;
          results.push({
            docVersionId,
            stage,
            confidence: avgConf,
            agreement: null, // algo/llm agreement not yet tracked per fact
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      logger.warn("Error processing doc version stage", {
        docVersionId,
        stage,
        error: (err as Error).message,
      });
      results.push({
        docVersionId,
        stage,
        confidence: null,
        agreement: null,
      });
    }
  }

  return results;
}

function computeBatchDelta(
  current: Record<string, unknown>,
  previous: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  const allStages = new Set([
    ...Object.keys(current),
    ...Object.keys(previous),
  ]);

  for (const stage of allStages) {
    const curr = current[stage] as Record<string, unknown> | undefined;
    const prev = previous[stage] as Record<string, unknown> | undefined;
    delta[stage] = {
      current: curr ?? null,
      previous: prev ?? null,
      avgConfidenceDelta: safeDelta(
        curr?.avgConfidence as number | undefined,
        prev?.avgConfidence as number | undefined,
      ),
      agreementRateDelta: safeDelta(
        curr?.agreementRate as number | undefined,
        prev?.agreementRate as number | undefined,
      ),
    };
  }

  return delta;
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function safeDelta(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return a - b;
}
