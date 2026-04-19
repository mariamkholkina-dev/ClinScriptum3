import { prisma } from "@clinscriptum/db";
import type { PipelineLevel, ProcessingStepStatus } from "@clinscriptum/shared";
import { logger } from "../lib/logger.js";
import { recordPipelineMetric, recordPipelineComplete } from "../lib/metrics.js";

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
  previousResults: Map<PipelineLevel, StepResult>;
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
    include: { steps: true, study: { select: { tenantId: true } } },
  });
  if (!run) throw new Error(`Processing run ${processingRunId} not found`);

  await prisma.processingRun.update({
    where: { id: processingRunId },
    data: { status: "running" },
  });

  const existingSteps = new Map(
    run.steps.map((s) => [s.level, s]),
  );

  const context: PipelineContext = {
    processingRunId,
    docVersionId: run.docVersionId,
    studyId: run.studyId,
    tenantId: run.study.tenantId,
    bundleId: (run as any).ruleSetBundleId ?? null,
    previousResults: new Map(),
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

      try {
        const result = await handler.execute(context);
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
        recordPipelineMetric({ processingRunId, pipelineLevel: level, status: "completed", durationMs });

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
        logger.error("Pipeline step failed", {
          processingRunId,
          pipelineLevel: level,
          error: (err as Error).message,
        });
        throw err;
      }
    }

    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: { status: "completed" },
    });

    recordPipelineComplete({
      processingRunId,
      totalDurationMs: Date.now() - pipelineStart,
      stepsCompleted,
      status: "completed",
    });
  } catch (err) {
    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: {
        status: "failed",
        lastError: (err as Error).message,
      },
    });

    recordPipelineComplete({
      processingRunId,
      totalDurationMs: Date.now() - pipelineStart,
      stepsCompleted,
      status: "failed",
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
