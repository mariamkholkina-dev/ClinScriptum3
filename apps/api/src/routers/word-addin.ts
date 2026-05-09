import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { storage } from "../lib/storage.js";
import { enqueueJob } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

export const wordAddinRouter = router({
  // Cursor-paginated список готовых версий (parsed/ready) для tenant'а.
  // Возвращает плоский список с метаданными study/document, сортировка по
  // createdAt версии (свежие сверху). UI группирует по study при рендеринге.
  // Для inter_audit на втором шаге используется фильтр docType='protocol'.
  listVersions: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        take: z.number().int().min(1).max(200).optional(),
        docType: z.enum(["protocol", "icf", "ib", "csr"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const take = input.take ?? 50;
      const versions = await prisma.documentVersion.findMany({
        where: {
          status: { in: ["parsed", "ready"] },
          document: {
            ...(input.docType ? { type: input.docType } : {}),
            study: { tenantId: ctx.user.tenantId },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          versionNumber: true,
          versionLabel: true,
          status: true,
          createdAt: true,
          document: {
            select: {
              id: true,
              title: true,
              type: true,
              study: { select: { id: true, title: true } },
            },
          },
        },
      });

      const hasMore = versions.length > take;
      const items = hasMore ? versions.slice(0, take) : versions;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      return {
        items: items.map((v) => ({
          versionId: v.id,
          versionNumber: v.versionNumber,
          versionLabel: v.versionLabel,
          status: v.status,
          documentId: v.document.id,
          documentTitle: v.document.title,
          documentType: v.document.type,
          studyId: v.document.study.id,
          studyTitle: v.document.study.title,
        })),
        nextCursor,
      };
    }),

  // Список всех сгенерированных документов tenant'а — для выбора в add-in
  // (режимы generation_review / generation_insert). Унаследовано через
  // protocolVersion → document → study → tenantId.
  listGeneratedDocs: protectedProcedure.query(async ({ ctx }) => {
    const docs = await prisma.generatedDoc.findMany({
      where: {
        protocolVersion: {
          document: { study: { tenantId: ctx.user.tenantId } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        sections: { select: { id: true, status: true } },
        protocolVersion: {
          include: { document: { include: { study: true } } },
        },
      },
    });

    return docs.map((d) => ({
      id: d.id,
      docType: d.docType,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      studyTitle: d.protocolVersion.document.study.title,
      protocolTitle: d.protocolVersion.document.title,
      protocolLabel: d.protocolVersion.versionLabel ?? `v${d.protocolVersion.versionNumber}`,
      totalSections: d.sections.length,
      completedSections: d.sections.filter((s) => s.status === "completed").length,
    }));
  }),

  uploadNewVersion: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        base64: z.string(),
        versionLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sourceVersion = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });

      if (!sourceVersion || sourceVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const latestVersion = await prisma.documentVersion.findFirst({
        where: { documentId: sourceVersion.documentId },
        orderBy: { versionNumber: "desc" },
      });

      const nextNumber = (latestVersion?.versionNumber ?? 0) + 1;
      const key = `${ctx.user.tenantId}/${sourceVersion.document.studyId}/${sourceVersion.documentId}/v${nextNumber}.docx`;

      const buffer = Buffer.from(input.base64, "base64");
      await storage.upload(key, buffer);

      const newVersion = await prisma.documentVersion.create({
        data: {
          documentId: sourceVersion.documentId,
          versionNumber: nextNumber,
          versionLabel: input.versionLabel || `v${nextNumber}.0`,
          fileUrl: key,
          status: "parsing",
        },
      });

      await enqueueJob("run_pipeline", { versionId: newVersion.id });
      logger.info("[word-addin-upload] Enqueued run_pipeline job", { versionId: newVersion.id });

      return {
        versionId: newVersion.id,
        versionNumber: nextNumber,
        versionLabel: newVersion.versionLabel,
      };
    }),
});
