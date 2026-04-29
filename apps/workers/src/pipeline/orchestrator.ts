import { prisma } from "@clinscriptum/db";
import type { ProcessingStepStatus } from "@clinscriptum/shared";
export type { PipelineLevel } from "@clinscriptum/shared";
import type { PipelineLevel } from "@clinscriptum/shared";
import { logger } from "../lib/logger.js";
import { recordPipelineMetric, recordPipelineComplete } from "../lib/metrics.js";
import { publishProcessingEvent } from "../lib/event-publisher.js";
import { executeStepWithRetry, makeIdempotencyKey } from "../lib/step-retry.js";

export interface PipelineStepHandler {
  level: PipelineLevel;
  execute(context: PipelineContext): Promise<StepResult>;
}

export interface PipelineContext {
  processingRunId: string;
  docVersionId: string;
  studyId: string;
  tenantId: string;
  bundleId: string | null;
  llmThinkingEnabled?: boolean;
  excludedSectionPrefixes?: string[];
  auditMode?: string;
  crossCheckPairs?: [string, string][] | null;
  previousResults: Map<PipelineLevel, StepResult>;
  sectionsCache: Map<string, unknown>;
}

export interface StepResult {
  data: Record<string, unknown>;
  needsNextStep: boolean;
  llmConfigSnapshot?: Record<string, unknown>;
  ruleSnapshot?: Record<string, unknown>;
}

export interface PipelineConfig {
  operatorReviewEnabled: boolean;
  steps: PipelineStepHandler[];
}

const PIPELINE_ORDER: PipelineLevel[] = [
  "deterministic",
  "llm_check",
  "llm_qa",
  "operator_review",
  "user_validation",
];

export async function runPipeline(
  processingRunId: string,
  config: PipelineConfig,
  handlers: Map<PipelineLevel, PipelineStepHandler>,
): Promise<void> {
  const run = await prisma.processingRun.findUnique({
    where: { id: processingRunId },
    include: { steps: true, study: { select: { tenantId: true, llmThinkingEnabled: true, excludedSectionPrefixes: true, auditMode: true, crossCheckPairs: true } } },
  });
  if (!run) throw new Error(`Processing run ${processingRunId} not found`);

  await prisma.processingRun.update({
    where: { id: processingRunId },
    data: { status: "running" },
  });

  await publishProcessingEvent({
    type: "run_started",
    docVersionId: run.docVersionId,
    tenantId: run.study.tenantId,
    processingRunId,
    timestamp: new Date().toISOString(),
    data: { runType: run.type, status: "running" },
  });

  const existingSteps = new Map(
    run.steps.map((s) => [s.level, s]),
  );

  let excludedPrefixes: string[] | undefined;
  if (run.study.excludedSectionPrefixes.length > 0) {
    excludedPrefixes = run.study.excludedSectionPrefixes;
  } else {
    const tenantCfg = await prisma.tenantConfig.findUnique({ where: { tenantId: run.study.tenantId } });
    if (tenantCfg && tenantCfg.excludedSectionPrefixes.length > 0) {
      excludedPrefixes = tenantCfg.excludedSectionPrefixes;
    }
  }

  const context: PipelineContext = {
    processingRunId,
    docVersionId: run.docVersionId,
    studyId: run.studyId,
    tenantId: run.study.tenantId,
    bundleId: (run as any).ruleSetBundleId ?? null,
    llmThinkingEnabled: run.study.llmThinkingEnabled,
    excludedSectionPrefixes: excludedPrefixes,
    auditMode: run.study.auditMode,
    crossCheckPairs: run.study.crossCheckPairs as [string, string][] | null,
    previousResults: new Map(),
    sectionsCache: new Map(),
  };

  const pipelineStart = Date.now();
  let stepsCompleted = 0;

  try {
    for (const level of PIPELINE_ORDER) {
      if (level === "operator_review" && !config.operatorReviewEnabled) {
        if (!existingSteps.has(level)) {
          await createStep(processingRunId, level, "skipped");
        }
        continue;
      }

      const handler = handlers.get(level);
      if (!handler) {
        if (!existingSteps.has(level)) {
          await createStep(processingRunId, level, "skipped");
        }
        continue;
      }

      const existing = existingSteps.get(level);
      if (existing?.status === "completed") {
        logger.info("Skipping already completed step", { processingRunId, pipelineLevel: level });
        if (existing.result) {
          context.previousResults.set(level, {
            data: existing.result as Record<string, unknown>,
            needsNextStep: true,
          });
        }
        stepsCompleted++;
        continue;
      }

      if (existing?.status === "failed") {
        await prisma.processingStep.delete({ where: { id: existing.id } });
      }

      const step = await createStep(processingRunId, level, "running");
      const stepStart = Date.now();

      logger.info("Pipeline step started", { processingRunId, pipelineLevel: level });

      await publishProcessingEvent({
        type: "step_started",
        docVersionId: context.docVersionId,
        tenantId: context.tenantId,
        processingRunId,
        timestamp: new Date().toISOString(),
        data: { level, runType: run.type },
      });

      try {
        const { value: result, finalAttempt } = await executeStepWithRetry(level, async (attempt) => {
          await prisma.processingStep.update({
            where: { id: step.id },
            data: {
              attemptNumber: attempt,
              idempotencyKey: makeIdempotencyKey(processingRunId, level, attempt),
              ...(attempt > 1 ? { startedAt: new Date() } : {}),
            },
          });
          return handler.execute(context);
        });
        context.previousResults.set(level, result);

        const durationMs = Date.now() - stepStart;

        await prisma.processingStep.update({
          where: { id: step.id },
          data: {
            status: "completed",
            result: result.data as any,
            llmConfigSnapshot: result.llmConfigSnapshot as any ?? undefined,
            ruleSnapshot: result.ruleSnapshot as any ?? undefined,
            completedAt: new Date(),
          },
        });

        stepsCompleted++;
        recordPipelineMetric({ processingRunId, pipelineLevel: level, status: "completed", durationMs, attempts: finalAttempt });

        await publishProcessingEvent({
          type: "step_completed",
          docVersionId: context.docVersionId,
          tenantId: context.tenantId,
          processingRunId,
          timestamp: new Date().toISOString(),
          data: { level, runType: run.type, durationMs, stepsCompleted },
        });

        if (!result.needsNextStep) {
          logger.info("Pipeline step halted early", { processingRunId, pipelineLevel: level });
          break;
        }
      } catch (err) {
        const durationMs = Date.now() - stepStart;

        await prisma.processingStep.update({
          where: { id: step.id },
          data: {
            status: "failed",
            result: { error: (err as Error).message },
            completedAt: new Date(),
          },
        });

        recordPipelineMetric({ processingRunId, pipelineLevel: level, status: "failed", durationMs });

        await publishProcessingEvent({
          type: "step_failed",
          docVersionId: context.docVersionId,
          tenantId: context.tenantId,
          processingRunId,
          timestamp: new Date().toISOString(),
          data: { level, runType: run.type, durationMs, error: (err as Error).message },
        });

        logger.error("Pipeline step failed", {
          processingRunId,
          pipelineLevel: level,
          error: (err as Error).message,
        });
        throw err;
      }
    }

    const totalDurationMs = Date.now() - pipelineStart;

    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: { status: "completed" },
    });

    recordPipelineComplete({ processingRunId, totalDurationMs, stepsCompleted, status: "completed" });

    await publishProcessingEvent({
      type: "run_completed",
      docVersionId: context.docVersionId,
      tenantId: context.tenantId,
      processingRunId,
      timestamp: new Date().toISOString(),
      data: { runType: run.type, durationMs: totalDurationMs, stepsCompleted, status: "completed" },
    });
  } catch (err) {
    const totalDurationMs = Date.now() - pipelineStart;

    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: {
        status: "failed",
        lastError: (err as Error).message,
      },
    });

    recordPipelineComplete({ processingRunId, totalDurationMs, stepsCompleted, status: "failed" });

    await publishProcessingEvent({
      type: "run_failed",
      docVersionId: context.docVersionId,
      tenantId: context.tenantId,
      processingRunId,
      timestamp: new Date().toISOString(),
      data: { runType: run.type, durationMs: totalDurationMs, stepsCompleted, error: (err as Error).message },
    });

    throw err;
  }
}

async function createStep(
  processingRunId: string,
  level: PipelineLevel,
  status: ProcessingStepStatus,
) {
  return prisma.processingStep.create({
    data: {
      processingRunId,
      level,
      status,
      startedAt: status === "running" ? new Date() : null,
      completedAt: status === "skipped" ? new Date() : null,
    },
  });
}
