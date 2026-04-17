import { z } from "zod";
import { router, adminProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { tuningService } from "../services/tuning.service.js";

const p = adminProcedure.use(withDomainErrors);

const tuningTypeEnum = z.enum(["section_classification", "fact_extraction", "soa_detection", "icf_generation"]);
const tuningSessionStatusEnum = z.enum(["processing", "pending_review", "in_review", "completed"]);

export const tuningRouter = router({
  /* ═══════════════ Sessions CRUD ═══════════════ */

  createSession: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        type: tuningTypeEnum,
        generatedDocId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      tuningService.createSession(ctx.user.tenantId, ctx.user.userId, input),
    ),

  listSessions: p
    .input(
      z.object({
        type: tuningTypeEnum.optional(),
        status: tuningSessionStatusEnum.optional(),
        goldenOnly: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) => tuningService.listSessions(ctx.user.tenantId, input)),

  getSession: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => tuningService.getSession(ctx.user.tenantId, input.sessionId)),

  /* ═══════════════ Section Verdicts ═══════════════ */

  getSectionVerdicts: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => tuningService.getSectionVerdicts(ctx.user.tenantId, input.sessionId)),

  saveSectionVerdict: p
    .input(
      z.object({
        verdictId: z.string().uuid(),
        auditorChoice: z.string(),
        auditorAgreedWith: z.enum(["algo", "llm", "custom"]),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => tuningService.saveSectionVerdict(ctx.user.tenantId, input)),

  /* ═══════════════ Fact Verdicts ═══════════════ */

  getFactVerdicts: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => tuningService.getFactVerdicts(ctx.user.tenantId, input.sessionId)),

  saveFactVerdict: p
    .input(
      z.object({
        verdictId: z.string().uuid(),
        isCorrect: z.boolean(),
        auditorValue: z.string().optional(),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => tuningService.saveFactVerdict(ctx.user.tenantId, input)),

  /* ═══════════════ SOA Verdicts ═══════════════ */

  getSoaVerdicts: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) => tuningService.getSoaVerdicts(ctx.user.tenantId, input.sessionId)),

  saveSoaVerdict: p
    .input(
      z.object({
        verdictId: z.string().uuid(),
        isCorrectDetection: z.boolean(),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => tuningService.saveSoaVerdict(ctx.user.tenantId, input)),

  /* ═══════════════ Generation Verdicts ═══════════════ */

  getGenerationVerdicts: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      tuningService.getGenerationVerdicts(ctx.user.tenantId, input.sessionId),
    ),

  saveGenerationVerdict: p
    .input(
      z.object({
        verdictId: z.string().uuid(),
        rating: z.number().min(1).max(5),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => tuningService.saveGenerationVerdict(ctx.user.tenantId, input)),

  getGeneratedDocsForTuning: p
    .input(z.object({ protocolVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      tuningService.getGeneratedDocsForTuning(ctx.user.tenantId, input.protocolVersionId),
    ),

  /* ═══════════════ Session lifecycle ═══════════════ */

  completeSession: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      tuningService.completeSession(ctx.user.tenantId, input.sessionId),
    ),

  toggleGoldenSet: p
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      tuningService.toggleGoldenSet(ctx.user.tenantId, input.sessionId),
    ),

  listGoldenSets: p
    .input(z.object({ type: tuningTypeEnum.optional() }))
    .query(({ ctx, input }) => tuningService.listGoldenSets(ctx.user.tenantId, input)),

  runRegression: p
    .input(z.object({ type: tuningTypeEnum }))
    .mutation(({ ctx, input }) => tuningService.runRegression(ctx.user.tenantId, input.type)),

  getTaxonomy: p.query(() => tuningService.getTaxonomy()),

  getVersionsForTuning: p.query(({ ctx }) =>
    tuningService.getVersionsForTuning(ctx.user.tenantId),
  ),
});
