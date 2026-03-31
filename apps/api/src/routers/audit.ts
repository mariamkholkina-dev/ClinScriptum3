import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { runIntraDocAudit } from "../lib/intra-audit.js";

export const auditRouter = router({
  startIntraAudit: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (version.status === "intra_audit") {
        const existingRun = await prisma.processingRun.findFirst({
          where: {
            docVersionId: input.docVersionId,
            type: "intra_doc_audit",
            status: "running",
          },
        });
        if (existingRun) {
          return { runId: existingRun.id, status: "already_running" as const };
        }
      }

      runIntraDocAudit(input.docVersionId).catch((err) =>
        console.error(`[audit] Background error for ${input.docVersionId}:`, err)
      );

      return { runId: null, status: "started" as const };
    }),

  getAuditStatus: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const latestRun = await prisma.processingRun.findFirst({
        where: { docVersionId: input.docVersionId, type: "intra_doc_audit" },
        orderBy: { createdAt: "desc" },
      });

      const findingsCount = await prisma.finding.count({
        where: { docVersionId: input.docVersionId, type: "intra_audit" },
      });
      const editorialCount = await prisma.finding.count({
        where: { docVersionId: input.docVersionId, type: "editorial", issueFamily: "EDITORIAL" },
      });

      return {
        versionStatus: version.status,
        runStatus: latestRun?.status ?? null,
        runId: latestRun?.id ?? null,
        totalFindings: findingsCount + editorialCount,
        isRunning: version.status === "intra_audit" || latestRun?.status === "running",
      };
    }),

  getAuditFindings: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        category: z.string().optional(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const where: any = {
        docVersionId: input.docVersionId,
        OR: [
          { type: "intra_audit" },
          { type: "editorial", issueFamily: "EDITORIAL" },
        ],
      };
      if (input.severity) where.severity = input.severity;
      if (input.category) where.auditCategory = input.category;
      if (input.status) where.status = input.status;

      const findings = await prisma.finding.findMany({
        where,
        orderBy: [
          { severity: "asc" },
          { createdAt: "asc" },
        ],
      });

      return {
        findings,
        documentTitle: version.document.title,
        versionLabel: version.versionLabel ?? `v${version.versionNumber}`,
        documentType: version.document.type,
      };
    }),

  getAuditSummary: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const findings = await prisma.finding.findMany({
        where: {
          docVersionId: input.docVersionId,
          OR: [
            { type: "intra_audit" },
            { type: "editorial", issueFamily: "EDITORIAL" },
          ],
        },
        select: { severity: true, auditCategory: true, status: true },
      });

      const bySeverity: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const f of findings) {
        bySeverity[f.severity ?? "info"] = (bySeverity[f.severity ?? "info"] ?? 0) + 1;
        byCategory[f.auditCategory ?? "other"] = (byCategory[f.auditCategory ?? "other"] ?? 0) + 1;
        byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
      }

      return { total: findings.length, bySeverity, byCategory, byStatus };
    }),

  updateAuditFindingStatus: protectedProcedure
    .input(
      z.object({
        findingId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]),
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

  validateAllAuditFindings: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        action: z.enum(["resolve", "reject"]),
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

      const newStatus = input.action === "resolve" ? "resolved" : "rejected";

      await prisma.finding.updateMany({
        where: {
          docVersionId: input.docVersionId,
          status: "pending",
          OR: [
            { type: "intra_audit" },
            { type: "editorial", issueFamily: "EDITORIAL" },
          ],
        },
        data: { status: newStatus as any },
      });

      return { success: true };
    }),

  getDocumentSections: protectedProcedure
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.docVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const sections = await prisma.section.findMany({
        where: { docVersionId: input.docVersionId },
        orderBy: { order: "asc" },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
      });

      return sections.map((s) => ({
        id: s.id,
        title: s.title,
        standardSection: s.standardSection,
        content: s.contentBlocks.map((b) => b.content).join("\n"),
      }));
    }),
});
