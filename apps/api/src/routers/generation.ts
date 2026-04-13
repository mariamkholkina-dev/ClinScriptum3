import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import {
  runDocGeneration,
  getDefaultTemplate,
  type TemplateSectionDef,
} from "../lib/doc-generation.js";

export const generationRouter = router({
  /* ═══════════════ Templates ═══════════════ */

  listTemplates: protectedProcedure
    .input(z.object({ docType: z.enum(["icf", "csr"]) }))
    .query(async ({ ctx, input }) => {
      const templates = await prisma.docTemplate.findMany({
        where: { tenantId: ctx.user.tenantId, docType: input.docType },
        orderBy: { createdAt: "desc" },
      });
      return templates.map((t) => ({
        id: t.id,
        name: t.name,
        docType: t.docType,
        sections: t.sections as unknown as TemplateSectionDef[],
        createdAt: t.createdAt,
      }));
    }),

  createTemplate: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        docType: z.enum(["icf", "csr"]),
        sections: z.array(
          z.object({
            title: z.string(),
            standardSection: z.string().nullable(),
            order: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const template = await prisma.docTemplate.create({
        data: {
          tenantId: ctx.user.tenantId,
          name: input.name,
          docType: input.docType,
          sections: input.sections as any,
        },
      });
      return { id: template.id };
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await prisma.docTemplate.findUnique({
        where: { id: input.templateId },
      });
      if (!template || template.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await prisma.docTemplate.delete({ where: { id: input.templateId } });
      return { success: true };
    }),

  /* ═══════════════ Generation ═══════════════ */

  startGeneration: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        docType: z.enum(["icf", "csr"]),
        templateId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      if (version.document.type !== "protocol") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Source must be a protocol" });
      }

      let templateSections: TemplateSectionDef[];

      if (input.templateId) {
        const template = await prisma.docTemplate.findUnique({
          where: { id: input.templateId },
        });
        if (!template || template.tenantId !== ctx.user.tenantId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Template not found" });
        }
        if (template.docType !== input.docType) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Template type mismatch" });
        }
        templateSections = template.sections as unknown as TemplateSectionDef[];
      } else {
        templateSections = getDefaultTemplate(input.docType);
      }

      const generatedDoc = await prisma.generatedDoc.create({
        data: {
          protocolVersionId: input.protocolVersionId,
          templateId: input.templateId ?? null,
          docType: input.docType,
          status: "generating",
          sections: {
            create: templateSections.map((s) => ({
              title: s.title,
              standardSection: s.standardSection,
              order: s.order,
              status: "pending",
            })),
          },
        },
      });

      runDocGeneration(generatedDoc.id).catch((err) =>
        console.error(`[generation] Background error for ${generatedDoc.id}:`, err)
      );

      return { generatedDocId: generatedDoc.id };
    }),

  getGeneratedDoc: protectedProcedure
    .input(z.object({ generatedDocId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const doc = await prisma.generatedDoc.findUnique({
        where: { id: input.generatedDocId },
        include: {
          sections: { orderBy: { order: "asc" } },
          protocolVersion: {
            include: { document: { include: { study: true } } },
          },
        },
      });
      if (!doc || doc.protocolVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return {
        id: doc.id,
        docType: doc.docType,
        status: doc.status,
        createdAt: doc.createdAt,
        studyTitle: doc.protocolVersion.document.study.title,
        protocolTitle: doc.protocolVersion.document.title,
        protocolLabel: doc.protocolVersion.versionLabel ?? `v${doc.protocolVersion.versionNumber}`,
        sections: doc.sections.map((s) => ({
          id: s.id,
          title: s.title,
          standardSection: s.standardSection,
          order: s.order,
          content: s.content,
          status: s.status,
          qaFindings: s.qaFindings,
        })),
      };
    }),

  updateSectionContent: protectedProcedure
    .input(
      z.object({
        sectionId: z.string().uuid(),
        content: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const section = await prisma.generatedDocSection.findUnique({
        where: { id: input.sectionId },
        include: {
          generatedDoc: {
            include: {
              protocolVersion: { include: { document: { include: { study: true } } } },
            },
          },
        },
      });
      if (!section || section.generatedDoc.protocolVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await prisma.generatedDocSection.update({
        where: { id: input.sectionId },
        data: { content: input.content },
      });

      return { success: true };
    }),

  listGeneratedDocs: protectedProcedure
    .input(z.object({ protocolVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const docs = await prisma.generatedDoc.findMany({
        where: { protocolVersionId: input.protocolVersionId },
        orderBy: { createdAt: "desc" },
        include: { sections: { select: { id: true, status: true } } },
      });

      return docs.map((d) => ({
        id: d.id,
        docType: d.docType,
        status: d.status,
        createdAt: d.createdAt,
        totalSections: d.sections.length,
        completedSections: d.sections.filter((s) => s.status === "completed").length,
      }));
    }),
});
