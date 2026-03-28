import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";

export const processingRouter = router({
  startRun: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        type: z.enum([
          "section_classification",
          "fact_extraction",
          "intra_doc_audit",
          "inter_doc_audit",
          "icf_generation",
          "csr_generation",
          "version_comparison",
        ]),
        ruleSetVersionId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const run = await prisma.processingRun.create({
        data: {
          studyId: version.document.studyId,
          docVersionId: input.docVersionId,
          type: input.type,
          ruleSetVersionId: input.ruleSetVersionId ?? null,
        },
      });

      return { runId: run.id, status: run.status };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await prisma.processingRun.findUnique({
        where: { id: input.runId },
        include: {
          steps: { orderBy: { startedAt: "asc" } },
          study: true,
        },
      });
      if (!run || run.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return run;
    }),

  listRuns: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return prisma.processingRun.findMany({
        where: {
          docVersionId: input.docVersionId,
          study: { tenantId: ctx.user.tenantId },
        },
        include: { steps: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  listFacts: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.fact.findMany({
        where: { docVersionId: input.docVersionId },
        orderBy: { factKey: "asc" },
      });
    }),

  listFindings: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.finding.findMany({
        where: { docVersionId: input.docVersionId },
        orderBy: { createdAt: "desc" },
      });
    }),

  updateFindingStatus: protectedProcedure
    .input(
      z.object({
        findingId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const finding = await prisma.finding.findUnique({
        where: { id: input.findingId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      });
      if (!finding || finding.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return prisma.finding.update({
        where: { id: input.findingId },
        data: { status: input.status },
      });
    }),

  updateSectionStatus: protectedProcedure
    .input(
      z.object({
        sectionId: z.string().uuid(),
        status: z.enum(["validated", "not_validated", "requires_rework"]),
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
        data: { status: input.status },
      });
    }),
});
