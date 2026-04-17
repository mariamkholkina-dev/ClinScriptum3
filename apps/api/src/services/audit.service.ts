import { prisma } from "@clinscriptum/db";
import { runIntraDocAudit } from "../lib/intra-audit.js";
import { runInterDocAudit } from "../lib/inter-audit.js";
import { logger } from "../lib/logger.js";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

const REVIEWER_ROLES = new Set(["findings_reviewer", "rule_admin", "tenant_admin"]);

export const auditService = {
  /* ═══════════ Intra-document audit ═══════════ */

  async startIntraAudit(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    if (version.status === "intra_audit") {
      const existingRun = await prisma.processingRun.findFirst({
        where: {
          docVersionId,
          type: "intra_doc_audit",
          status: "running",
        },
      });
      if (existingRun) {
        return { runId: existingRun.id, status: "already_running" as const };
      }
    }

    runIntraDocAudit(docVersionId).catch((err) =>
      logger.error(`[audit] Background error for ${docVersionId}:`, { error: String(err) }),
    );

    return { runId: null, status: "started" as const };
  },

  async getAuditStatus(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const latestRun = await prisma.processingRun.findFirst({
      where: { docVersionId, type: "intra_doc_audit" },
      orderBy: { createdAt: "desc" },
    });

    const findingsCount = await prisma.finding.count({
      where: { docVersionId, type: "intra_audit" },
    });
    const editorialCount = await prisma.finding.count({
      where: { docVersionId, type: "editorial", issueFamily: "EDITORIAL" },
    });

    const review = await prisma.findingReview.findUnique({
      where: {
        docVersionId_auditType: {
          docVersionId,
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
  },

  async getAuditFindings(
    tenantId: string,
    userRole: string,
    input: {
      docVersionId: string;
      severity?: string;
      category?: string;
      status?: string;
    },
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: input.docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const isReviewer = REVIEWER_ROLES.has(userRole);

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
  },

  async getAuditSummary(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const findings = await prisma.finding.findMany({
      where: {
        docVersionId,
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
  },

  async updateAuditFindingStatus(
    tenantId: string,
    findingId: string,
    status: string,
  ) {
    const finding = await prisma.finding.findUnique({
      where: { id: findingId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(finding, tenantId, (f) => f.docVersion.document.study.tenantId);

    return prisma.finding.update({
      where: { id: findingId },
      data: { status: status as any },
    });
  },

  async validateAllAuditFindings(
    tenantId: string,
    docVersionId: string,
    action: "resolve" | "reject",
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const newStatus = action === "resolve" ? "resolved" : "rejected";

    await prisma.finding.updateMany({
      where: {
        docVersionId,
        status: "pending",
        OR: [
          { type: "intra_audit" },
          { type: "editorial", issueFamily: "EDITORIAL" },
        ],
      },
      data: { status: newStatus as any },
    });

    return { success: true };
  },

  async getDocumentSections(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const sections = await prisma.section.findMany({
      where: { docVersionId },
      orderBy: { order: "asc" },
      include: { contentBlocks: { orderBy: { order: "asc" } } },
    });

    return sections.map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      content: s.contentBlocks.map((b) => b.content).join("\n"),
    }));
  },

  /* ═══════════ Inter-document audit (cross-doc concordance) ═══════════ */

  async startInterAudit(
    tenantId: string,
    protocolVersionId: string,
    checkedVersionId: string,
  ) {
    const [protocolVersion, checkedVersion] = await Promise.all([
      prisma.documentVersion.findUnique({
        where: { id: protocolVersionId },
        include: { document: { include: { study: true } } },
      }),
      prisma.documentVersion.findUnique({
        where: { id: checkedVersionId },
        include: { document: { include: { study: true } } },
      }),
    ]);

    requireTenantResource(protocolVersion, tenantId, (v) => v.document.study.tenantId);
    requireTenantResource(checkedVersion, tenantId, (v) => v.document.study.tenantId);

    if (checkedVersion.document.type !== "icf" && checkedVersion.document.type !== "csr") {
      throw new DomainError(
        "BAD_REQUEST",
        "Inter-audit supports only ICF and CSR documents",
      );
    }

    if (checkedVersion.status === "inter_audit") {
      const existingRun = await prisma.processingRun.findFirst({
        where: {
          docVersionId: checkedVersionId,
          type: "inter_doc_audit",
          status: "running",
        },
      });
      if (existingRun) {
        return { runId: existingRun.id, status: "already_running" as const };
      }
    }

    runInterDocAudit(protocolVersionId, checkedVersionId).catch((err) =>
      logger.error(`[inter-audit] Background error:`, { error: String(err) }),
    );

    return { runId: null, status: "started" as const };
  },

  async getInterAuditStatus(
    tenantId: string,
    checkedVersionId: string,
  ) {
    const checkedVersion = await prisma.documentVersion.findUnique({
      where: { id: checkedVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(checkedVersion, tenantId, (v) => v.document.study.tenantId);

    const latestRun = await prisma.processingRun.findFirst({
      where: { docVersionId: checkedVersionId, type: "inter_doc_audit" },
      orderBy: { createdAt: "desc" },
    });

    const findingsCount = await prisma.finding.count({
      where: { docVersionId: checkedVersionId, type: "inter_audit" },
    });

    const review = await prisma.findingReview.findUnique({
      where: {
        docVersionId_auditType: {
          docVersionId: checkedVersionId,
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
  },

  async getInterAuditFindings(
    tenantId: string,
    userRole: string,
    input: {
      protocolVersionId: string;
      checkedVersionId: string;
      severity?: string;
      status?: string;
    },
  ) {
    const checkedVersion = await prisma.documentVersion.findUnique({
      where: { id: input.checkedVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(checkedVersion, tenantId, (v) => v.document.study.tenantId);

    const isReviewerUser = REVIEWER_ROLES.has(userRole);

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
  },

  async getInterAuditSummary(
    tenantId: string,
    checkedVersionId: string,
  ) {
    const checkedVersion = await prisma.documentVersion.findUnique({
      where: { id: checkedVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(checkedVersion, tenantId, (v) => v.document.study.tenantId);

    const findings = await prisma.finding.findMany({
      where: { docVersionId: checkedVersionId, type: "inter_audit" },
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
  },

  async validateAllInterAuditFindings(
    tenantId: string,
    checkedVersionId: string,
    action: "resolve" | "reject",
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: checkedVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const newStatus = action === "resolve" ? "resolved" : "rejected";

    await prisma.finding.updateMany({
      where: {
        docVersionId: checkedVersionId,
        type: "inter_audit",
        status: "pending",
      },
      data: { status: newStatus as any },
    });

    return { success: true };
  },

  async getStudyDocumentsForInterAudit(tenantId: string, studyId: string) {
    const study = await prisma.study.findUnique({
      where: { id: studyId },
    });
    requireTenantResource(study, tenantId);

    const documents = await prisma.document.findMany({
      where: {
        studyId,
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
  },
};
