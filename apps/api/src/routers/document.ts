import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { storage } from "../lib/storage.js";
import { runProcessingPipeline } from "../lib/processing-pipeline.js";

export const documentRouter = router({
  listByStudy: protectedProcedure
    .input(z.object({ studyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const study = await prisma.study.findFirst({
        where: { id: input.studyId, tenantId: ctx.user.tenantId },
      });
      if (!study) throw new TRPCError({ code: "NOT_FOUND" });

      return prisma.document.findMany({
        where: { studyId: input.studyId },
        include: { versions: { orderBy: { versionNumber: "desc" } } },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        studyId: z.string().uuid(),
        type: z.enum(["protocol", "icf", "ib", "csr"]),
        title: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const study = await prisma.study.findFirst({
        where: { id: input.studyId, tenantId: ctx.user.tenantId },
      });
      if (!study) throw new TRPCError({ code: "NOT_FOUND" });

      if (input.type !== "protocol") {
        const hasProtocol = await prisma.document.findFirst({
          where: { studyId: input.studyId, type: "protocol" },
        });
        if (!hasProtocol) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Protocol must be uploaded first (URS-068)",
          });
        }
      }

      return prisma.document.create({
        data: {
          studyId: input.studyId,
          type: input.type,
          title: input.title,
        },
      });
    }),

  getUploadUrl: protectedProcedure
    .input(
      z.object({
        documentId: z.string().uuid(),
        versionLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId },
        include: { study: true, versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!doc || doc.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const nextVersion = (doc.versions[0]?.versionNumber ?? 0) + 1;
      const key = `${ctx.user.tenantId}/${doc.studyId}/${doc.id}/v${nextVersion}.docx`;

      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersion,
          versionLabel: input.versionLabel || `v${nextVersion}.0`,
          fileUrl: key,
          status: "uploading",
        },
      });

      return { versionId: version.id, storageKey: key };
    }),

  deleteVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.documentVersion.delete({ where: { id: input.versionId } });
      return { success: true };
    }),

  setCurrentVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.documentVersion.updateMany({
        where: { documentId: version.documentId },
        data: { isCurrent: false },
      });
      await prisma.documentVersion.update({
        where: { id: input.versionId },
        data: { isCurrent: true },
      });
      return { success: true };
    }),

  confirmUpload: protectedProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        fileBuffer: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const buffer = Buffer.from(input.fileBuffer, "base64");
      await storage.upload(version.fileUrl, buffer);

      // Fire-and-forget: run the full processing pipeline asynchronously
      runProcessingPipeline(version.id).catch((err) =>
        console.error(`[pipeline] Background error for ${version.id}:`, err)
      );

      return { versionId: version.id, status: "parsing" };
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: {
          document: { include: { study: true } },
          sections: {
            orderBy: { order: "asc" },
            include: { contentBlocks: { orderBy: { order: "asc" } } },
          },
        },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return version;
    }),

  validateAllSections: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.section.updateMany({
        where: { docVersionId: input.versionId },
        data: { status: "validated" },
      });
      return { success: true };
    }),

  updateSectionClassification: protectedProcedure
    .input(
      z.object({
        sectionId: z.string().uuid(),
        standardSection: z.string().nullable(),
        status: z.enum(["validated", "not_validated", "requires_rework"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const section = await prisma.section.findUnique({
        where: { id: input.sectionId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!section || section.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.section.update({
        where: { id: input.sectionId },
        data: {
          standardSection: input.standardSection,
          status: input.status ?? section.status,
        },
      });
    }),

  getTaxonomy: protectedProcedure.query(async () => {
    const ruleSet = await prisma.ruleSet.findFirst({
      where: { type: "section_classification" },
      include: {
        versions: {
          where: { isActive: true },
          include: { rules: true },
          take: 1,
        },
      },
    });
    if (!ruleSet?.versions[0]) return [];
    return ruleSet.versions[0].rules.map((r) => ({
      name: r.name,
      pattern: r.pattern,
      config: r.config as any,
    }));
  }),
});
