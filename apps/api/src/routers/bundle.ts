import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { bundleService } from "../services/bundle.service.js";

const p = qualityProcedure.use(withDomainErrors);

export const bundleRouter = router({
  list: p
    .input(z.object({}).optional())
    .query(({ ctx }) => bundleService.listBundles(ctx.user.tenantId)),

  get: p
    .input(z.object({ bundleId: z.string().uuid() }))
    .query(({ input }) => bundleService.getBundle(input.bundleId)),

  getActive: p
    .query(({ ctx }) => bundleService.getActiveBundle(ctx.user.tenantId)),

  create: p
    .input(z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      global: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) =>
      bundleService.createBundle(
        input.global ? null : ctx.user.tenantId,
        input.name,
        input.description,
      ),
    ),

  addEntry: p
    .input(z.object({
      bundleId: z.string().uuid(),
      ruleSetVersionId: z.string().uuid(),
    }))
    .mutation(({ input }) =>
      bundleService.addEntry(input.bundleId, input.ruleSetVersionId),
    ),

  removeEntry: p
    .input(z.object({
      bundleId: z.string().uuid(),
      entryId: z.string().uuid(),
    }))
    .mutation(({ input }) =>
      bundleService.removeEntry(input.bundleId, input.entryId),
    ),

  activate: p
    .input(z.object({ bundleId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      bundleService.activateBundle(input.bundleId, ctx.user.tenantId),
    ),

  deactivate: p
    .input(z.object({ bundleId: z.string().uuid() }))
    .mutation(({ input }) => bundleService.deactivateBundle(input.bundleId)),

  clone: p
    .input(z.object({
      bundleId: z.string().uuid(),
      newName: z.string().min(1).max(200),
    }))
    .mutation(({ input }) =>
      bundleService.cloneBundle(input.bundleId, input.newName),
    ),

  delete: p
    .input(z.object({ bundleId: z.string().uuid() }))
    .mutation(({ input }) => bundleService.deleteBundle(input.bundleId)),
});
