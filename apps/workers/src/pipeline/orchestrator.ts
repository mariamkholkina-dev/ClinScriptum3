import { prisma } from "@clinscriptum/db";
import type { PipelineLevel, ProcessingStepStatus } from "@clinscriptum/shared";

/**
 * 5-level pipeline orchestrator (URS-069):
 * 1. Deterministic (regex, rules)
 * 2. LLM Check (verification)
 * 3. LLM QA (arbitration on disagreements)
 * 4. Operator Review (optional, URS-071)
 * 5. User Validation (final confirmation)
 */

export interface PipelineStepHandler {
  level: PipelineLevel;
  execute(context: PipelineContext): Promise<StepResult>;
}

export interface PipelineContext {
  processingRunId: string;
  docVersionId: string;
  studyId: string;
  previousResults: Map<PipelineLevel, StepResult>;
}

export interface StepResult {
  data: Record<string, unknown>;
  needsNextStep: boolean;
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
  handlers: Map<PipelineLevel, PipelineStepHandler>
): Promise<void> {
  const run = await prisma.processingRun.findUnique({
    where: { id: processingRunId },
  });
  if (!run) throw new Error(`Processing run ${processingRunId} not found`);

  await prisma.processingRun.update({
    where: { id: processingRunId },
    data: { status: "running" },
  });

  const context: PipelineContext = {
    processingRunId,
    docVersionId: run.docVersionId,
    studyId: run.studyId,
    previousResults: new Map(),
  };

  try {
    for (const level of PIPELINE_ORDER) {
      if (level === "operator_review" && !config.operatorReviewEnabled) {
        await createStep(processingRunId, level, "skipped");
        continue;
      }

      const handler = handlers.get(level);
      if (!handler) {
        await createStep(processingRunId, level, "skipped");
        continue;
      }

      const step = await createStep(processingRunId, level, "running");

      try {
        const result = await handler.execute(context);
        context.previousResults.set(level, result);

        await prisma.processingStep.update({
          where: { id: step.id },
          data: {
            status: "completed",
            result: result.data as any,
            completedAt: new Date(),
          },
        });

        if (!result.needsNextStep) break;
      } catch (err) {
        await prisma.processingStep.update({
          where: { id: step.id },
          data: {
            status: "failed",
            result: { error: (err as Error).message },
            completedAt: new Date(),
          },
        });
        throw err;
      }
    }

    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: { status: "completed" },
    });
  } catch (err) {
    await prisma.processingRun.update({
      where: { id: processingRunId },
      data: { status: "failed" },
    });
    throw err;
  }
}

async function createStep(
  processingRunId: string,
  level: PipelineLevel,
  status: ProcessingStepStatus
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
