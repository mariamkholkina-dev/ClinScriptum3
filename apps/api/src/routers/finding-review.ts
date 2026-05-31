import { z } from "zod";
import { router, reviewerProcedure, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { findingReviewService } from "../services/finding-review.service.js";

const p = protectedProcedure.use(withDomainErrors);
const r = reviewerProcedure.use(withDomainErrors);

export const findingReviewRouter = router({
  dashboard: r.query(({ ctx }) => findingReviewService.dashboard(ctx.user.tenantId)),

  getReview: r
    .input(z.object({ reviewId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      findingReviewService.getReview(ctx.user.tenantId, input.reviewId),
    ),

  startReview: r
    .input(z.object({ reviewId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      findingReviewService.startReview(ctx.user.tenantId, input.reviewId, ctx.user.userId),
    ),

  toggleHidden: r
    .input(z.object({ reviewId: z.string().uuid(), findingId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      findingReviewService.toggleHidden(
        ctx.user.tenantId,
        input.reviewId,
        input.findingId,
        ctx.user.userId,
      ),
    ),

  changeSeverity: r
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      findingReviewService.changeSeverity(
        ctx.user.tenantId,
        input.reviewId,
        input.findingId,
        input.severity,
        ctx.user.userId,
      ),
    ),

  addNote: r
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingId: z.string().uuid(),
        note: z.string().max(2000),
      }),
    )
    .mutation(({ ctx, input }) =>
      findingReviewService.addNote(
        ctx.user.tenantId,
        input.reviewId,
        input.findingId,
        input.note,
        ctx.user.userId,
      ),
    ),

  publish: r
    .input(z.object({ reviewId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      findingReviewService.publish(ctx.user.tenantId, input.reviewId, ctx.user.userId),
    ),

  promoteFindingToGolden: r
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingId: z.string().uuid(),
        goldenSampleId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      findingReviewService.promoteFindingToGolden(
        ctx.user.tenantId,
        input.reviewId,
        input.findingId,
        input.goldenSampleId,
        ctx.user.userId,
      ),
    ),

  listGoldenSamples: r.query(({ ctx }) =>
    findingReviewService.listGoldenSamples(ctx.user.tenantId),
  ),

  bulkSetHidden: r
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingIds: z.array(z.string().uuid()).min(1),
        hidden: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      findingReviewService.bulkSetHidden(
        ctx.user.tenantId,
        input.reviewId,
        input.findingIds,
        input.hidden,
        ctx.user.userId,
      ),
    ),

  bulkChangeSeverity: r
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingIds: z.array(z.string().uuid()).min(1),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      findingReviewService.bulkChangeSeverity(
        ctx.user.tenantId,
        input.reviewId,
        input.findingIds,
        input.severity,
        ctx.user.userId,
      ),
    ),

  getReviewStatus: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        auditType: z.enum(["intra_audit", "inter_audit"]),
      }),
    )
    .query(({ ctx, input }) =>
      findingReviewService.getReviewStatus(input.docVersionId, input.auditType),
    ),
});
