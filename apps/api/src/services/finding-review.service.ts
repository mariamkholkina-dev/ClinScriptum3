import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

export const findingReviewService = {
  async dashboard(tenantId: string) {
    const reviews = await prisma.findingReview.findMany({
      where: {
        tenantId,
        status: { in: ["pending", "in_review"] },
      },
      include: {
        docVersion: {
          include: { document: { include: { study: true } } },
        },
        reviewer: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = await Promise.all(
      reviews.map(async (r) => {
        const findingsCount = await prisma.finding.count({
          where: {
            docVersionId: r.docVersionId,
            type: r.auditType as any,
            status: { not: "false_positive" },
          },
        });

        return {
          id: r.id,
          docVersionId: r.docVersionId,
          auditType: r.auditType,
          protocolVersionId: r.protocolVersionId,
          status: r.status,
          createdAt: r.createdAt,
          reviewer: r.reviewer,
          documentTitle: r.docVersion.document.title,
          documentType: r.docVersion.document.type,
          versionLabel: r.docVersion.versionLabel ?? `v${r.docVersion.versionNumber}`,
          studyTitle: r.docVersion.document.study.title,
          findingsCount,
        };
      }),
    );

    return result;
  },

  async getReview(tenantId: string, reviewId: string) {
    const review = await prisma.findingReview.findUnique({
      where: { id: reviewId },
      include: {
        docVersion: {
          include: { document: { include: { study: true } } },
        },
        reviewer: { select: { id: true, name: true } },
      },
    });
    requireTenantResource(review, tenantId);

    const findings = await prisma.finding.findMany({
      where: {
        docVersionId: review.docVersionId,
        type: review.auditType as any,
        status: { not: "false_positive" },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    return {
      review: {
        id: review.id,
        docVersionId: review.docVersionId,
        auditType: review.auditType,
        protocolVersionId: review.protocolVersionId,
        status: review.status,
        createdAt: review.createdAt,
        publishedAt: review.publishedAt,
        reviewer: review.reviewer,
      },
      documentTitle: review.docVersion.document.title,
      documentType: review.docVersion.document.type,
      versionLabel: review.docVersion.versionLabel ?? `v${review.docVersion.versionNumber}`,
      studyTitle: review.docVersion.document.study.title,
      findings,
    };
  },

  async startReview(tenantId: string, reviewId: string, userId: string) {
    const review = await prisma.findingReview.findUnique({
      where: { id: reviewId },
    });
    requireTenantResource(review, tenantId);

    if (review.status !== "pending" && review.status !== "in_review") {
      throw new DomainError("BAD_REQUEST", "Review is already published");
    }

    return prisma.findingReview.update({
      where: { id: reviewId },
      data: {
        status: "in_review",
        reviewerId: userId,
      },
    });
  },

  async toggleHidden(
    tenantId: string,
    reviewId: string,
    findingId: string,
    userId: string,
  ) {
    const [review, finding] = await Promise.all([
      prisma.findingReview.findUnique({ where: { id: reviewId } }),
      prisma.finding.findUnique({
        where: { id: findingId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      }),
    ]);

    requireTenantResource(review, tenantId);
    requireTenantResource(finding, tenantId, (f) => f.docVersion.document.study.tenantId);

    const newValue = !finding.hiddenByReviewer;

    await prisma.findingReviewLog.create({
      data: {
        reviewId,
        findingId,
        reviewerId: userId,
        action: newValue ? "hide" : "unhide",
        previousValue: String(!newValue),
        newValue: String(newValue),
      },
    });

    return prisma.finding.update({
      where: { id: findingId },
      data: { hiddenByReviewer: newValue },
    });
  },

  async changeSeverity(
    tenantId: string,
    reviewId: string,
    findingId: string,
    severity: "critical" | "high" | "medium" | "low" | "info",
    userId: string,
  ) {
    const [review, finding] = await Promise.all([
      prisma.findingReview.findUnique({ where: { id: reviewId } }),
      prisma.finding.findUnique({
        where: { id: findingId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      }),
    ]);

    requireTenantResource(review, tenantId);
    requireTenantResource(finding, tenantId, (f) => f.docVersion.document.study.tenantId);

    const previousSeverity = finding.severity ?? "info";

    await prisma.findingReviewLog.create({
      data: {
        reviewId,
        findingId,
        reviewerId: userId,
        action: "change_severity",
        previousValue: previousSeverity,
        newValue: severity,
      },
    });

    return prisma.finding.update({
      where: { id: findingId },
      data: { severity: severity as any },
    });
  },

  async addNote(
    tenantId: string,
    reviewId: string,
    findingId: string,
    note: string,
    userId: string,
  ) {
    const [review, finding] = await Promise.all([
      prisma.findingReview.findUnique({ where: { id: reviewId } }),
      prisma.finding.findUnique({
        where: { id: findingId },
        include: { docVersion: { include: { document: { include: { study: true } } } } },
      }),
    ]);

    requireTenantResource(review, tenantId);
    requireTenantResource(finding, tenantId, (f) => f.docVersion.document.study.tenantId);

    await prisma.findingReviewLog.create({
      data: {
        reviewId,
        findingId,
        reviewerId: userId,
        action: "add_note",
        previousValue: finding.reviewerNote ?? null,
        newValue: note,
      },
    });

    return prisma.finding.update({
      where: { id: findingId },
      data: { reviewerNote: note },
    });
  },

  async publish(tenantId: string, reviewId: string, userId: string) {
    const review = await prisma.findingReview.findUnique({
      where: { id: reviewId },
    });
    requireTenantResource(review, tenantId);

    if (review.status === "published") {
      throw new DomainError("BAD_REQUEST", "Review is already published");
    }

    return prisma.findingReview.update({
      where: { id: reviewId },
      data: {
        status: "published",
        publishedAt: new Date(),
        reviewerId: review.reviewerId ?? userId,
      },
    });
  },

  async getReviewStatus(
    docVersionId: string,
    auditType: "intra_audit" | "inter_audit",
  ) {
    const review = await prisma.findingReview.findUnique({
      where: {
        docVersionId_auditType: {
          docVersionId,
          auditType: auditType as any,
        },
      },
      select: { id: true, status: true, publishedAt: true },
    });

    return review ?? null;
  },
};
