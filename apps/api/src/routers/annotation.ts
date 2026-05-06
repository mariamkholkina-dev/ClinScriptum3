import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { annotationService } from "../services/annotation.service.js";

const p = qualityProcedure.use(withDomainErrors);

const annotationStatusEnum = z.enum(["open", "answered", "finalized"]);

export const annotationRouter = router({
  /* ═══════════════ Annotator-side ═══════════════ */

  /**
   * Submit (or re-submit) one annotation for a section.
   * Annotator chooses zone OR marks as question for expert.
   */
  submit: p
    .input(
      z
        .object({
          goldenSampleId: z.string().uuid(),
          stage: z.string(),
          sectionKey: z.string().min(1),
          proposedZone: z.string().min(1).optional(),
          isQuestion: z.boolean().default(false),
          questionText: z.string().min(1).optional(),
        })
        .refine(
          (v) => v.isQuestion || (v.proposedZone && v.proposedZone.length > 0),
          { message: "proposedZone required when isQuestion=false" },
        )
        .refine((v) => !v.isQuestion || (v.questionText && v.questionText.length > 0), {
          message: "questionText required when isQuestion=true",
        }),
    )
    .mutation(({ ctx, input }) =>
      annotationService.submitAnnotation({
        goldenSampleId: input.goldenSampleId,
        stage: input.stage,
        sectionKey: input.sectionKey,
        annotatorId: ctx.user.userId,
        proposedZone: input.proposedZone,
        isQuestion: input.isQuestion,
        questionText: input.questionText,
      }),
    ),

  /**
   * List annotations — annotator filters by his own ID, expert by question status.
   */
  list: p
    .input(
      z.object({
        goldenSampleId: z.string().uuid(),
        stage: z.string().optional(),
        status: annotationStatusEnum.optional(),
        isQuestion: z.boolean().optional(),
        annotatorId: z.string().uuid().optional(),
      }),
    )
    .query(({ input }) =>
      annotationService.listAnnotations({
        goldenSampleId: input.goldenSampleId,
        stage: input.stage,
        status: input.status,
        isQuestion: input.isQuestion,
        annotatorId: input.annotatorId,
      }),
    ),

  /**
   * Get one annotation with full detail.
   */
  get: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => annotationService.getAnnotation(input.id)),

  /**
   * Progress for one sample/stage — counts of open / answered / finalized / questions.
   */
  progress: p
    .input(z.object({ goldenSampleId: z.string().uuid(), stage: z.string() }))
    .query(({ input }) =>
      annotationService.getProgress(input.goldenSampleId, input.stage),
    ),

  /**
   * Annotator marks the sample/stage as ready for expert review.
   * Pushes all submitted annotations into expected_results, marks stage as in_review.
   */
  finalizeForReview: p
    .input(
      z.object({
        goldenSampleId: z.string().uuid(),
        stage: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      annotationService.finalizeAnnotations(
        input.goldenSampleId,
        input.stage,
        ctx.user.userId,
      ),
    ),

  /* ═══════════════ Expert-side ═══════════════ */

  /**
   * Queue of unresolved questions across all samples in tenant.
   */
  expertQueue: p
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }))
    .query(({ ctx, input }) =>
      annotationService.listExpertQueue(ctx.user.tenantId, input.limit ?? 50),
    ),

  /**
   * Expert resolves a question.
   */
  resolveQuestion: p
    .input(
      z.object({
        annotationId: z.string().uuid(),
        finalZone: z.string().min(1),
        rationale: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      annotationService.resolveQuestion({
        annotationId: input.annotationId,
        decidedById: ctx.user.userId,
        finalZone: input.finalZone,
        rationale: input.rationale,
      }),
    ),
});
