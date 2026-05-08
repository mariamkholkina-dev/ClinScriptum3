import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { expectedSectionService } from "../services/expectedSection.service.js";

const p = qualityProcedure.use(withDomainErrors);

const anchorSchema = z.object({
  paragraphIndex: z.number().int().nonnegative().optional(),
  textSnippet: z.string().optional(),
  occurrenceIndex: z.number().int().nonnegative().optional(),
  contentBlockDigest: z.string().optional(),
});

export const expectedSectionRouter = router({
  /**
   * List expected sections for a (sample, stage) as a tree (roots only;
   * children nested via `children`).
   */
  list: p
    .input(
      z.object({
        goldenSampleId: z.string().uuid(),
        stage: z.string().min(1),
      }),
    )
    .query(({ ctx, input }) =>
      expectedSectionService.list(
        ctx.user.tenantId,
        input.goldenSampleId,
        input.stage,
      ),
    ),

  create: p
    .input(
      z.object({
        stageStatusId: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        title: z.string().min(1),
        level: z.number().int().min(1).max(9),
        anchor: anchorSchema,
        standardSection: z.string().nullable().optional(),
        order: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) =>
      expectedSectionService.create(ctx.user.tenantId, ctx.user.userId, {
        stageStatusId: input.stageStatusId,
        parentId: input.parentId ?? null,
        title: input.title,
        level: input.level,
        anchor: input.anchor,
        standardSection: input.standardSection ?? null,
        order: input.order,
      }),
    ),

  update: p
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z.object({
          title: z.string().min(1).optional(),
          level: z.number().int().min(1).max(9).optional(),
          anchor: anchorSchema.optional(),
          standardSection: z.string().nullable().optional(),
          order: z.number().int().nonnegative().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      expectedSectionService.update(
        ctx.user.tenantId,
        ctx.user.userId,
        input.id,
        input.patch,
      ),
    ),

  delete: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      expectedSectionService.delete(ctx.user.tenantId, input.id),
    ),

  /**
   * Pin an expected section to a real `Section` — snapshots the anchor from
   * the live section so future re-parses can find it again.
   */
  pin: p
    .input(
      z.object({
        expectedId: z.string().uuid(),
        realSectionId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      expectedSectionService.pin(
        ctx.user.tenantId,
        input.expectedId,
        input.realSectionId,
      ),
    ),

  unpin: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      expectedSectionService.unpin(ctx.user.tenantId, input.id),
    ),

  reorder: p
    .input(
      z.object({
        id: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        order: z.number().int().nonnegative(),
      }),
    )
    .mutation(({ ctx, input }) =>
      expectedSectionService.reorder(ctx.user.tenantId, input.id, {
        parentId: input.parentId ?? null,
        order: input.order,
      }),
    ),
});
