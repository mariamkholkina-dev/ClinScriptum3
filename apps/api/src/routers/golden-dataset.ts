import { z } from "zod";
import { prisma } from "@clinscriptum/db";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { goldenDatasetService } from "../services/golden-dataset.service.js";

const p = qualityProcedure.use(withDomainErrors);

const sampleTypeEnum = z.enum([
  "single_document",
  "multi_document",
]);

const stageStatusEnum = z.enum(["draft", "in_review", "approved"]);

const documentTypeEnum = z.enum(["protocol", "icf", "ib", "csr"]);

export const goldenDatasetRouter = router({
  /* ═══════════════ Samples CRUD ═══════════════ */

  createSample: p
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        sampleType: sampleTypeEnum,
      }),
    )
    .mutation(({ ctx, input }) =>
      goldenDatasetService.createSample(ctx.user.tenantId, {
        name: input.name,
        description: input.description,
        sampleType: input.sampleType,
        createdById: ctx.user.userId,
      }),
    ),

  listSamples: p
    .input(
      z.object({
        sampleType: sampleTypeEnum.optional(),
        stage: z.string().optional(),
        stageStatus: stageStatusEnum.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      goldenDatasetService.listSamples(ctx.user.tenantId, input),
    ),

  getSample: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) =>
      goldenDatasetService.getSample(input.id),
    ),

  deleteSample: p
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) =>
      goldenDatasetService.deleteSample(input.id),
    ),

  /* ═══════════════ Documents ═══════════════ */

  addDocument: p
    .input(
      z.object({
        goldenSampleId: z.string().uuid(),
        documentVersionId: z.string().uuid(),
        documentType: documentTypeEnum,
        role: z.string().optional(),
        order: z.number().int().optional(),
      }),
    )
    .mutation(({ input }) =>
      goldenDatasetService.addDocument(input.goldenSampleId, {
        documentVersionId: input.documentVersionId,
        documentType: input.documentType,
        role: input.role,
        order: input.order,
      }),
    ),

  removeDocument: p
    .input(z.object({ goldenSampleDocumentId: z.string().uuid() }))
    .mutation(({ input }) =>
      goldenDatasetService.removeDocument(input.goldenSampleDocumentId),
    ),

  /* ═══════════════ Stage Status & Approval ═══════════════ */

  updateStageStatus: p
    .input(
      z.object({
        goldenSampleId: z.string().uuid(),
        stage: z.string(),
        status: stageStatusEnum,
        expectedResults: z.record(z.unknown()).optional(),
        reviewComment: z.string().optional(),
        reviewedById: z.string().uuid().optional(),
        approvedById: z.string().uuid().optional(),
      }),
    )
    .mutation(({ input }) =>
      goldenDatasetService.updateStageStatus(input.goldenSampleId, input.stage, {
        status: input.status,
        expectedResults: input.expectedResults,
        reviewComment: input.reviewComment,
        reviewedById: input.reviewedById,
        approvedById: input.approvedById,
      }),
    ),

  getApprovedStages: p
    .input(z.object({ goldenSampleId: z.string().uuid() }))
    .query(({ input }) =>
      goldenDatasetService.getApprovedStages(input.goldenSampleId),
    ),

  listApprovedSamples: p
    .input(z.object({ stage: z.string().optional() }))
    .query(({ ctx, input }) =>
      goldenDatasetService.listApprovedSamples(ctx.user.tenantId, input.stage),
    ),

  /* ═══════════════ Document Search ═══════════════ */

  searchDocumentVersions: p
    .input(
      z.object({
        query: z.string().optional(),
        documentType: documentTypeEnum.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        document: {
          study: { tenantId: ctx.user.tenantId },
          ...(input.documentType ? { type: input.documentType } : {}),
        },
      };
      if (input.query) {
        (where.document as Record<string, unknown>).title = {
          contains: input.query,
          mode: "insensitive",
        };
      }
      return prisma.documentVersion.findMany({
        where,
        include: {
          document: {
            select: { id: true, title: true, type: true, study: { select: { id: true, title: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
    }),

  /* ═══════════════ Batch ═══════════════ */

  batchImport: p
    .input(
      z.object({
        items: z.array(
          z.object({
            name: z.string(),
            documentVersionIds: z.array(z.string().uuid()),
            documentTypes: z.array(documentTypeEnum),
            sampleType: sampleTypeEnum,
          }),
        ),
      }),
    )
    .mutation(({ ctx, input }) =>
      goldenDatasetService.batchImport(ctx.user.tenantId, ctx.user.userId, input.items),
    ),
});
