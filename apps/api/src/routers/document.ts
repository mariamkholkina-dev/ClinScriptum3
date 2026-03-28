import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { storage } from "../lib/storage.js";

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
          fileUrl: key,
          status: "uploading",
        },
      });

      return { versionId: version.id, storageKey: key };
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

      await prisma.documentVersion.update({
        where: { id: version.id },
        data: { status: "parsing" },
      });

      return { versionId: version.id, status: "parsing" };
    }),

  getVersion: protectedProcedure
    .input(z.object({ versionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.versionId },
        include: {
          document: { include: { study: true } },
          sections: { orderBy: { order: "asc" }, include: { contentBlocks: { orderBy: { order: "asc" } } } },
        },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return version;
    }),
});
