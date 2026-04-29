import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { evaluationService } from "../services/evaluation.service.js";

const p = qualityProcedure.use(withDomainErrors);

const evaluationTypeEnum = z.enum(["single", "batch", "llm_comparison", "context_window_test"]);
const evaluationStatusEnum = z.enum(["queued", "running", "completed", "failed"]);
const contextStrategyEnum = z.enum(["chunk", "multi_chunk", "full_document", "multi_document"]);
const resultStatusEnum = z.enum(["pending", "pass", "fail", "error", "skipped"]);

export const evaluationRouter = router({
  /* ═══════════════ Runs ═══════════════ */

  createRun: p
    .input(
      z.object({
        name: z.string().optional(),
        type: evaluationTypeEnum,
        ruleSetVersionId: z.string().uuid().optional(),
        llmConfigId: z.string().uuid().optional(),
        contextStrategy: contextStrategyEnum.optional(),
        chunkSizeChars: z.number().int().positive().optional(),
        comparedToRunId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      evaluationService.createRun(ctx.user.tenantId, {
        ...input,
        createdById: ctx.user.userId,
      }),
    ),

  getRun: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      evaluationService.getRun(input.id, ctx.user.tenantId),
    ),

  listRuns: p
    .input(
      z.object({
        type: evaluationTypeEnum.optional(),
        status: evaluationStatusEnum.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      evaluationService.listRuns(ctx.user.tenantId, input),
    ),

  deleteRun: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      evaluationService.deleteRun(input.id, ctx.user.tenantId),
    ),

  /* ═══════════════ Results & Comparison ═══════════════ */

  getRunResults: p
    .input(
      z.object({
        evaluationRunId: z.string().uuid(),
        stage: z.string().optional(),
        status: resultStatusEnum.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      evaluationService.getRunResults(input.evaluationRunId, ctx.user.tenantId, {
        stage: input.stage,
        status: input.status,
      }),
    ),

  getRunMetrics: p
    .input(z.object({ evaluationRunId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      evaluationService.getRunMetrics(input.evaluationRunId, ctx.user.tenantId),
    ),

  compareRuns: p
    .input(
      z.object({
        runId1: z.string().uuid(),
        runId2: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      evaluationService.compareRuns(input.runId1, input.runId2, ctx.user.tenantId),
    ),
});
