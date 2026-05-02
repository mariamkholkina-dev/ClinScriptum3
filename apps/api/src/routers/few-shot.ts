import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { fewShotService } from "../services/few-shot.service.js";

const p = qualityProcedure.use(withDomainErrors);

export const fewShotRouter = router({
  list: p
    .input(
      z.object({
        standardSection: z.string().optional(),
        isActive: z.boolean().optional(),
        take: z.number().int().min(1).max(500).optional(),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      fewShotService.list({ tenantId: ctx.user.tenantId, ...input }),
    ),

  get: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => fewShotService.get(ctx.user.tenantId, input.id)),

  create: p
    .input(
      z.object({
        title: z.string().min(1),
        parentPath: z.string().optional().nullable(),
        contentPreview: z.string().optional().nullable(),
        standardSection: z.string().min(1),
        reason: z.string().optional().nullable(),
        sourceSectionId: z.string().uuid().optional().nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      fewShotService.create({
        tenantId: ctx.user.tenantId,
        createdById: ctx.user.userId,
        ...input,
      }),
    ),

  update: p
    .input(
      z.object({
        id: z.string().uuid(),
        patch: z.object({
          title: z.string().min(1).optional(),
          parentPath: z.string().optional().nullable(),
          contentPreview: z.string().optional().nullable(),
          standardSection: z.string().min(1).optional(),
          reason: z.string().optional().nullable(),
          isActive: z.boolean().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      fewShotService.update(ctx.user.tenantId, input.id, input.patch),
    ),

  delete: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      fewShotService.delete(ctx.user.tenantId, input.id),
    ),
});
