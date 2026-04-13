import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { storage } from "../lib/storage.js";
import { runProcessingPipeline } from "../lib/processing-pipeline.js";

export const wordAddinRouter = router({
  getContext: protectedProcedure.query(async ({ ctx }) => {
    const studies = await prisma.study.findMany({
      where: { tenantId: ctx.user.tenantId },
      include: {
        documents: {
          include: {
            versions: {
              where: { status: { in: ["parsed", "ready"] } },
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

      runProcessingPipeline(newVersion.id).catch((err) =>
        console.error(`[word-addin-upload] Pipeline error for ${newVersion.id}:`, err)
      );

      return {
        versionId: newVersion.id,
        versionNumber: nextNumber,
        versionLabel: newVersion.versionLabel,
      };
    }),
});
