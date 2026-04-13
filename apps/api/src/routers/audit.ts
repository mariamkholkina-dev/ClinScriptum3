import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { runIntraDocAudit } from "../lib/intra-audit.js";
import { runInterDocAudit } from "../lib/inter-audit.js";

const REVIEWER_ROLES = new Set(["findings_reviewer", "rule_admin", "tenant_admin"]);

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

      const review = await prisma.findingReview.findUnique({
        where: {
          docVersionId_auditType: {
            docVersionId: input.docVersionId,
            auditType: "intra_audit",
          },
        },
        select: { id: true, status: true },
      });

      return {
        versionStatus: version.status,
        runStatus: latestRun?.status ?? null,
        runId: latestRun?.id ?? null,
        totalFindings: findingsCount + editorialCount,
        isRunning: version.status === "intra_audit" || latestRun?.status === "running",
        reviewStatus: review?.status ?? null,
        reviewId: review?.id ?? null,
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

      const isReviewer = REVIEWER_ROLES.has(ctx.user.role);

      if (!isReviewer) {
        const review = await prisma.findingReview.findUnique({
          where: {
            docVersionId_auditType: {
              docVersionId: input.docVersionId,
              auditType: "intra_audit",
            },
          },
        });
        if (review && review.status !== "published") {
          return {
            findings: [],
            documentTitle: version.document.title,
            versionLabel: version.versionLabel ?? `v${version.versionNumber}`,
            documentType: version.document.type,
            reviewPending: true,
          };
        }
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

      if (!isReviewer) {
        where.hiddenByReviewer = false;
      }

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
        reviewPending: false,
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

  /* ═══════════ Inter-document audit (cross-doc concordance) ═══════════ */

  startInterAudit: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [protocolVersion, checkedVersion] = await Promise.all([
        prisma.documentVersion.findUnique({
          where: { id: input.protocolVersionId },
          include: { document: { include: { study: true } } },
        }),
        prisma.documentVersion.findUnique({
          where: { id: input.checkedVersionId },
          include: { document: { include: { study: true } } },
        }),
      ]);

      if (!protocolVersion || protocolVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Protocol version not found" });
      }
      if (!checkedVersion || checkedVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Checked version not found" });
      }

      if (checkedVersion.document.type !== "icf" && checkedVersion.document.type !== "csr") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Inter-audit supports only ICF and CSR documents",
        });
      }

      if (checkedVersion.status === "inter_audit") {
        const existingRun = await prisma.processingRun.findFirst({
          where: {
            docVersionId: input.checkedVersionId,
            type: "inter_doc_audit",
            status: "running",
          },
        });
        if (existingRun) {
          return { runId: existingRun.id, status: "already_running" as const };
        }
      }

      runInterDocAudit(input.protocolVersionId, input.checkedVersionId).catch((err) =>
        console.error(`[inter-audit] Background error:`, err)
      );

      return { runId: null, status: "started" as const };
    }),

  getInterAuditStatus: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const checkedVersion = await prisma.documentVersion.findUnique({
        where: { id: input.checkedVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!checkedVersion || checkedVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const latestRun = await prisma.processingRun.findFirst({
        where: { docVersionId: input.checkedVersionId, type: "inter_doc_audit" },
        orderBy: { createdAt: "desc" },
      });

      const findingsCount = await prisma.finding.count({
        where: { docVersionId: input.checkedVersionId, type: "inter_audit" },
      });

      const review = await prisma.findingReview.findUnique({
        where: {
          docVersionId_auditType: {
            docVersionId: input.checkedVersionId,
            auditType: "inter_audit",
          },
        },
        select: { id: true, status: true },
      });

      return {
        versionStatus: checkedVersion.status,
        runStatus: latestRun?.status ?? null,
        runId: latestRun?.id ?? null,
        totalFindings: findingsCount,
        isRunning: checkedVersion.status === "inter_audit" || latestRun?.status === "running",
        reviewStatus: review?.status ?? null,
        reviewId: review?.id ?? null,
      };
    }),

  getInterAuditFindings: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const checkedVersion = await prisma.documentVersion.findUnique({
        where: { id: input.checkedVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!checkedVersion || checkedVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const isReviewerUser = REVIEWER_ROLES.has(ctx.user.role);

      if (!isReviewerUser) {
        const review = await prisma.findingReview.findUnique({
          where: {
            docVersionId_auditType: {
              docVersionId: input.checkedVersionId,
              auditType: "inter_audit",
            },
          },
        });
        if (review && review.status !== "published") {
          return {
            findings: [],
            protocolTitle: "",
            protocolLabel: "",
            checkedDocTitle: checkedVersion.document.title,
            checkedDocLabel: checkedVersion.versionLabel ?? `v${checkedVersion.versionNumber}`,
            checkedDocType: checkedVersion.document.type,
            studyTitle: checkedVersion.document.study.title,
            reviewPending: true,
          };
        }
      }

      const protocolVersion = await prisma.documentVersion.findUnique({
        where: { id: input.protocolVersionId },
        include: { document: true },
      });

      const where: any = {
        docVersionId: input.checkedVersionId,
        type: "inter_audit",
      };
      if (input.severity) where.severity = input.severity;
      if (input.status) where.status = input.status;

      if (!isReviewerUser) {
        where.hiddenByReviewer = false;
      }

      const findings = await prisma.finding.findMany({
        where,
        orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
      });

      return {
        findings,
        protocolTitle: protocolVersion?.document.title ?? "",
        protocolLabel: protocolVersion?.versionLabel ?? `v${protocolVersion?.versionNumber}`,
        checkedDocTitle: checkedVersion.document.title,
        checkedDocLabel: checkedVersion.versionLabel ?? `v${checkedVersion.versionNumber}`,
        checkedDocType: checkedVersion.document.type,
        studyTitle: checkedVersion.document.study.title,
        reviewPending: false,
      };
    }),

  getInterAuditSummary: protectedProcedure
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      })
    )
    .query(async ({ ctx, input }) => {
      const checkedVersion = await prisma.documentVersion.findUnique({
        where: { id: input.checkedVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!checkedVersion || checkedVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const findings = await prisma.finding.findMany({
        where: { docVersionId: input.checkedVersionId, type: "inter_audit" },
        select: { severity: true, issueFamily: true, status: true },
      });

      const bySeverity: Record<string, number> = {};
      const byFamily: Record<string, number> = {};
      const byStatus: Record<string, number> = {};

      for (const f of findings) {
        bySeverity[f.severity ?? "info"] = (bySeverity[f.severity ?? "info"] ?? 0) + 1;
        byFamily[f.issueFamily ?? "other"] = (byFamily[f.issueFamily ?? "other"] ?? 0) + 1;
        byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
      }

      return { total: findings.length, bySeverity, byFamily, byStatus };
    }),

  validateAllInterAuditFindings: protectedProcedure
    .input(
      z.object({
        checkedVersionId: z.string().uuid(),
        action: z.enum(["resolve", "reject"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const version = await prisma.documentVersion.findUnique({
        where: { id: input.checkedVersionId },
        include: { document: { include: { study: true } } },
      });
      if (!version || version.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const newStatus = input.action === "resolve" ? "resolved" : "rejected";

      await prisma.finding.updateMany({
        where: {
          docVersionId: input.checkedVersionId,
          type: "inter_audit",
          status: "pending",
        },
        data: { status: newStatus as any },
      });

      return { success: true };
    }),

  getStudyDocumentsForInterAudit: protectedProcedure
    .input(z.object({ studyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const study = await prisma.study.findUnique({
        where: { id: input.studyId },
      });
      if (!study || study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const documents = await prisma.document.findMany({
        where: {
          studyId: input.studyId,
          type: { in: ["icf", "csr"] },
        },
        include: {
          versions: {
            where: { status: { in: ["ready", "parsed"] } },
            orderBy: { versionNumber: "desc" },
          },
        },
      });

      return documents.map((d) => ({
        id: d.id,
        type: d.type,
        title: d.title,
        versions: d.versions.map((v) => ({
          id: v.id,
          versionNumber: v.versionNumber,
          versionLabel: v.versionLabel,
          isCurrent: v.isCurrent,
          status: v.status,
        })),
      }));
    }),
});
