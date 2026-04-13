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

  getVersionStatuses: protectedProcedure
    .input(z.object({ versionIds: z.array(z.string().uuid()).min(1).max(50) }))
    .query(async ({ ctx, input }) => {
      const versions = await prisma.documentVersion.findMany({
        where: { id: { in: input.versionIds } },
        select: {
          id: true,
          status: true,
          document: { select: { study: { select: { tenantId: true } } } },
        },
      });
      return versions
        .filter((v) => v.document.study.tenantId === ctx.user.tenantId)
        .map((v) => ({ id: v.id, status: v.status }));
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const versionBase = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        select: {
          id: true,
          versionNumber: true,
          versionLabel: true,
          status: true,
          document: {
            select: {
              id: true,
              studyId: true,
              type: true,
              title: true,
              study: {
                select: {
                  id: true,
                  title: true,
                  tenantId: true,
                },
              },
            },
          },
        },
      });

      if (!versionBase || versionBase.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      try {
        const sections = await prisma.section.findMany({
          where: { docVersionId: input.versionId },
          orderBy: { order: "asc" },
          select: {
            id: true,
            title: true,
            standardSection: true,
            confidence: true,
            classifiedBy: true,
            level: true,
            order: true,
            status: true,
            contentBlocks: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                type: true,
                content: true,
                rawHtml: true,
                order: true,
              },
            },
          },
        });

        return { ...versionBase, sections };
      } catch (err) {
        console.error("[document.getVersion] Prisma read failed, using raw fallback:", err);

        type RawSectionRow = {
          id: string;
          title: string;
          standardSection: string | null;
          confidence: number | null;
          classifiedBy: string | null;
          level: number | null;
          order: number | null;
          status: string | null;
        };

        type RawBlockRow = {
          id: string;
          sectionId: string;
          type: string | null;
          content: string;
          rawHtml: string | null;
          order: number | null;
        };

        const rawSections = await prisma.$queryRaw<RawSectionRow[]>`
          SELECT
            s.id,
            s.title,
            s.standard_section AS "standardSection",
            s.confidence,
            s.classified_by AS "classifiedBy",
            s.level,
            s."order",
            s.status::text AS status
          FROM sections s
          WHERE s.doc_version_id = ${input.versionId}::uuid
          ORDER BY s."order" ASC
        `;

        const rawBlocks = await prisma.$queryRaw<RawBlockRow[]>`
          SELECT
            cb.id,
            cb.section_id AS "sectionId",
            cb.type::text AS type,
            cb.content,
            cb.raw_html AS "rawHtml",
            cb."order"
          FROM content_blocks cb
          INNER JOIN sections s ON s.id = cb.section_id
          WHERE s.doc_version_id = ${input.versionId}::uuid
          ORDER BY cb."order" ASC
        `;

        const blocksBySection = new Map<string, RawBlockRow[]>();
        for (const block of rawBlocks) {
          const existing = blocksBySection.get(block.sectionId) ?? [];
          existing.push(block);
          blocksBySection.set(block.sectionId, existing);
        }

        const sections = rawSections.map((section) => ({
          id: section.id,
          title: section.title,
          standardSection: section.standardSection,
          confidence: Number(section.confidence ?? 0),
          classifiedBy: section.classifiedBy,
          level: Number(section.level ?? 1),
          order: Number(section.order ?? 0),
          status:
            section.status === "validated" ||
            section.status === "requires_rework" ||
            section.status === "not_validated"
              ? section.status
              : "not_validated",
          contentBlocks: (blocksBySection.get(section.id) ?? []).map((block) => ({
            id: block.id,
            type:
              block.type === "paragraph" ||
              block.type === "table" ||
              block.type === "table_cell" ||
              block.type === "footnote" ||
              block.type === "list" ||
              block.type === "image"
                ? block.type
                : "paragraph",
            content: block.content ?? "",
            rawHtml: block.rawHtml,
            order: Number(block.order ?? 0),
          })),
        }));

        return {
          ...versionBase,
          sections,
        };
      }
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
