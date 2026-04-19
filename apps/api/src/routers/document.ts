import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { documentService } from "../services/document.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const documentRouter = router({
  listAll: p.query(({ ctx }) => documentService.listAll(ctx.user.tenantId)),

  listByStudy: p
    .input(z.object({ studyId: z.string().uuid() }))
    .query(({ ctx, input }) => documentService.listByStudy(ctx.user.tenantId, input.studyId)),

  create: p
    .input(
      z.object({
        studyId: z.string().uuid(),
        type: z.enum(["protocol", "icf", "ib", "csr"]),
        title: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) => documentService.create(ctx.user.tenantId, input)),

  getUploadUrl: p
    .input(z.object({ documentId: z.string().uuid(), versionLabel: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      documentService.getUploadUrl(ctx.user.tenantId, input.documentId, input.versionLabel),
    ),

  deleteVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.deleteVersion(ctx.user.tenantId, input.versionId),
    ),

  setCurrentVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.setCurrentVersion(ctx.user.tenantId, input.versionId),
    ),

  confirmUpload: p
    .input(z.object({ versionId: z.string().uuid(), fileBuffer: z.string() }))
    .mutation(({ ctx, input }) =>
      documentService.confirmUpload(ctx.user.tenantId, input.versionId, input.fileBuffer),
    ),

  reprocessVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.reprocessVersion(ctx.user.tenantId, input.versionId),
    ),

  getVersionStatuses: p
    .input(z.object({ versionIds: z.array(z.string().uuid()).min(1).max(50) }))
    .query(({ ctx, input }) =>
      documentService.getVersionStatuses(ctx.user.tenantId, input.versionIds),
    ),

  getVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      documentService.getVersion(ctx.user.tenantId, input.versionId),
    ),

  validateAllStructure: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.validateAllStructure(ctx.user.tenantId, input.versionId),
    ),

  validateAllClassification: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.validateAllClassification(ctx.user.tenantId, input.versionId),
    ),

  validateAllSections: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      documentService.validateAllSections(ctx.user.tenantId, input.versionId),
    ),

  updateSectionClassification: p
    .input(
      z.object({
        sectionId: z.string().uuid(),
        standardSection: z.string().nullable(),
        classificationStatus: z.enum(["validated", "not_validated", "requires_rework"]).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      documentService.updateSectionClassification(
        ctx.user.tenantId,
        input.sectionId,
        input.standardSection,
        input.classificationStatus,
      ),
    ),

  getTaxonomy: p.query(() => documentService.getTaxonomy()),
});
