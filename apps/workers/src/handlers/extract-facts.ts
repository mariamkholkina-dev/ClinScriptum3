/**
 * Worker handler for fact extraction.
 * Delegates core logic to @clinscriptum/shared/fact-extraction.
 * Wraps as PipelineStepHandlers for the BullMQ orchestrator.
 */

import { runDeterministic, runLlmCheck, runLlmQa } from "@clinscriptum/shared/fact-extraction";
import { runPipeline } from "../pipeline/orchestrator.js";
import type { PipelineStepHandler, PipelineContext, StepResult } from "../pipeline/orchestrator.js";
import { logger } from "../lib/logger.js";

export async function handleExtractFacts(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const deterministicHandler: PipelineStepHandler = {
    level: "deterministic",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const result = await runDeterministic(ctx);
      return { ...result, needsNextStep: true };
    },
  };

  const llmCheckHandler: PipelineStepHandler = {
    level: "llm_check",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const result = await runLlmCheck(ctx, logger);
      return { ...result, needsNextStep: true };
    },
  };

  const llmQaHandler: PipelineStepHandler = {
    level: "llm_qa",
    async execute(ctx: PipelineContext): Promise<StepResult> {
      const result = await runLlmQa(ctx, logger);
      return { ...result, needsNextStep: true };
    },
  };

  const handlers = new Map([
    ["deterministic" as const, deterministicHandler],
    ["llm_check" as const, llmCheckHandler],
    ["llm_qa" as const, llmQaHandler],
  ]);

  await runPipeline(data.processingRunId, {
    operatorReviewEnabled: data.operatorReviewEnabled ?? false,
    steps: Array.from(handlers.values()),
  }, handlers);
}
