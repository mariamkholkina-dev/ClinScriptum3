import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { studyService } from "../services/study.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const studyRouter = router({
  list: p.query(({ ctx }) => studyService.list(ctx.user.tenantId)),

  getById: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => studyService.getById(ctx.user.tenantId, input.id)),

  create: p
    .input(
      z.object({
        title: z.string().min(1),
        sponsor: z.string().optional(),
        drug: z.string().optional(),
        therapeuticArea: z.string().optional(),
        protocolTitle: z.string().optional(),
        phase: z.string().default(""),
      }),
    )
    .mutation(({ ctx, input }) => studyService.create(ctx.user.tenantId, input)),

  update: p
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        sponsor: z.string().optional(),
        drug: z.string().optional(),
        therapeuticArea: z.string().optional(),
        protocolTitle: z.string().optional(),
        phase: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return studyService.update(ctx.user.tenantId, id, data);
    }),

  delete: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => studyService.delete(ctx.user.tenantId, input.id)),

  getSettings: p
    .input(z.object({ studyId: z.string().uuid() }))
    .query(({ ctx, input }) => studyService.getSettings(ctx.user.tenantId, input.studyId)),

  updateSettings: p
    .input(
      z.object({
        studyId: z.string().uuid(),
        operatorReviewEnabled: z.boolean().optional(),
        llmThinkingEnabled: z.boolean().optional(),
        excludedSectionPrefixes: z.array(z.string()).optional(),
        auditMode: z.enum(["auto", "single_call", "zone_based"]).optional(),
        crossCheckPairs: z.array(z.tuple([z.string(), z.string()])).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { studyId, ...data } = input;
      return studyService.updateSettings(ctx.user.tenantId, studyId, data);
    }),

  getGlobalConfig: p
    .query(({ ctx }) => studyService.getGlobalConfig(ctx.user.tenantId)),

  updateGlobalConfig: p
    .input(z.object({ excludedSectionPrefixes: z.array(z.string()) }))
    .mutation(({ ctx, input }) => studyService.updateGlobalConfig(ctx.user.tenantId, input)),
});
