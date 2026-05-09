import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { storage } from "../lib/storage.js";
import { enqueueJob } from "../lib/queue.js";
import { logger } from "../lib/logger.js";

export const wordAddinRouter = router({
  getContext: protectedProcedure
    .input(z.object({ includeAllStatuses: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // По умолчанию add-in работает только с готовыми (parsed/ready) версиями.
      // Для режима «Парсинг» add-in передаёт includeAllStatuses=true чтобы
      // увидеть и uploading/parsing/error и иметь возможность перезапустить.
      const versionsWhere = input?.includeAllStatuses
        ? undefined
        : { status: { in: ["parsed" as const, "ready" as const] } };

      const studies = await prisma.study.findMany({
        where: { tenantId: ctx.user.tenantId },
        include: {
          documents: {
            include: {
              versions: {
                where: versionsWhere,
                orderBy: { versionNumber: "desc" },
                take: 3,
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      });

      return studies.map((s) => ({
        id: s.id,
        title: s.title,
        documents: s.documents.map((d) => ({
          id: d.id,
          title: d.title,
          type: d.type,
          versions: d.versions.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            versionLabel: v.versionLabel,
            status: v.status,
          })),
        })),
      }));
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
