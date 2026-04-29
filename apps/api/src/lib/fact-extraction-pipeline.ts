/**
 * In-process fact extraction pipeline (API).
 * Delegates core logic to @clinscriptum/shared/fact-extraction.
 * Manages ProcessingRun/Step lifecycle directly with Prisma.
 */

import { prisma } from "@clinscriptum/db";
import { runDeterministic, runLlmCheck, runLlmQa, EXCLUDED_SECTION_PREFIXES } from "@clinscriptum/shared/fact-extraction";
import type { FactExtractionContext, FactExtractionResult } from "@clinscriptum/shared/fact-extraction";
import { logger } from "./logger.js";

export async function handleExtractFacts(data: {
  processingRunId: string;
  operatorReviewEnabled?: boolean;
}) {
  const run = await prisma.processingRun.findUnique({
    where: { id: data.processingRunId },
    include: { study: { select: { tenantId: true, excludedSectionPrefixes: true } } },
  });
  if (!run) throw new Error(`ProcessingRun ${data.processingRunId} not found`);

  let excludedPrefixes: string[] | undefined;
  if (run.study.excludedSectionPrefixes.length > 0) {
    excludedPrefixes = run.study.excludedSectionPrefixes;
  } else {
    const config = await prisma.tenantConfig.findUnique({ where: { tenantId: run.study.tenantId } });
    if (config && config.excludedSectionPrefixes.length > 0) {
      excludedPrefixes = config.excludedSectionPrefixes;
    }
  }

  const ctx: FactExtractionContext = {
    docVersionId: run.docVersionId,
    tenantId: run.study.tenantId,
    bundleId: (run as any).ruleSetBundleId as string | null,
    excludedSectionPrefixes: excludedPrefixes,
  };

  await prisma.processingRun.update({
    where: { id: data.processingRunId },
    data: { status: "running" },
  });

  try {
    const step1 = await createStep(data.processingRunId, "deterministic");
    const deterResult = await runDeterministic(ctx);
    await completeStep(step1.id, deterResult);
    logger.info("[facts] Level 1 (deterministic) complete", deterResult.data);

    const step2 = await createStep(data.processingRunId, "llm_check");
    const llmResult = await runLlmCheck(ctx, logger);
    await completeStep(step2.id, llmResult);
    logger.info("[facts] Level 2 (llm_check) complete", llmResult.data);

    const step3 = await createStep(data.processingRunId, "llm_qa");
    const qaResult = await runLlmQa(ctx, logger);
    await completeStep(step3.id, qaResult);
    logger.info("[facts] Level 3 (llm_qa) complete", qaResult.data);

    await prisma.processingRun.update({ where: { id: data.processingRunId }, data: { status: "completed" } });
  } catch (err) {
    await prisma.processingRun.update({
      where: { id: data.processingRunId },
      data: { status: "failed", lastError: (err as Error).message },
    });
    throw err;
  }
}

async function createStep(processingRunId: string, level: string) {
  return prisma.processingStep.create({
    data: { processingRunId, level: level as any, status: "running", startedAt: new Date() },
  });
}

async function completeStep(stepId: string, result: FactExtractionResult) {
  await prisma.processingStep.update({
    where: { id: stepId },
    data: {
      status: "completed",
      result: result.data as any,
      llmConfigSnapshot: result.llmConfigSnapshot as any ?? undefined,
      ruleSnapshot: result.ruleSnapshot as any ?? undefined,
      completedAt: new Date(),
    },
  });
}
