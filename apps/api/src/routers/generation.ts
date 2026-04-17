import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { generationService } from "../services/generation.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const generationRouter = router({
  /* ═══════════════ Templates ═══════════════ */

  listTemplates: p
    .input(z.object({ docType: z.enum(["icf", "csr"]) }))
    .query(({ ctx, input }) => generationService.listTemplates(ctx.user.tenantId, input.docType)),

  createTemplate: p
    .input(
      z.object({
        name: z.string().min(1),
        docType: z.enum(["icf", "csr"]),
        sections: z.array(
          z.object({
            title: z.string(),
            standardSection: z.string().nullable(),
            order: z.number(),
          }),
        ),
      }),
    )
    .mutation(({ ctx, input }) => generationService.createTemplate(ctx.user.tenantId, input)),

  deleteTemplate: p
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      generationService.deleteTemplate(ctx.user.tenantId, input.templateId),
    ),

  /* ═══════════════ Generation ═══════════════ */

  startGeneration: p
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        docType: z.enum(["icf", "csr"]),
        templateId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => generationService.startGeneration(ctx.user.tenantId, input)),

  getGeneratedDoc: p
    .input(z.object({ generatedDocId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      generationService.getGeneratedDoc(ctx.user.tenantId, input.generatedDocId),
    ),

  updateSectionContent: p
    .input(
      z.object({
        sectionId: z.string().uuid(),
        content: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      generationService.updateSectionContent(ctx.user.tenantId, input.sectionId, input.content),
    ),

  listGeneratedDocs: p
    .input(z.object({ protocolVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      generationService.listGeneratedDocs(ctx.user.tenantId, input.protocolVersionId),
    ),
});
