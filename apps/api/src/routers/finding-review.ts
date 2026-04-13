import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "@clinscriptum/db";
import { router, reviewerProcedure, protectedProcedure } from "../trpc/trpc.js";

export const findingReviewRouter = router({
  dashboard: reviewerProcedure.query(async ({ ctx }) => {
    const reviews = await prisma.findingReview.findMany({
      where: {
        tenantId: ctx.user.tenantId,
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
      })
    );

    return result;
  }),

  getReview: reviewerProcedure
    .input(z.object({ reviewId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const review = await prisma.findingReview.findUnique({
        where: { id: input.reviewId },
        include: {
          docVersion: {
            include: { document: { include: { study: true } } },
          },
          reviewer: { select: { id: true, name: true } },
        },
      });

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

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
    }),

  startReview: reviewerProcedure
    .input(z.object({ reviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const review = await prisma.findingReview.findUnique({
        where: { id: input.reviewId },
      });

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (review.status !== "pending" && review.status !== "in_review") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Review is already published",
        });
      }

      return prisma.findingReview.update({
        where: { id: input.reviewId },
        data: {
          status: "in_review",
          reviewerId: ctx.user.id,
        },
      });
    }),

  toggleHidden: reviewerProcedure
    .input(z.object({ reviewId: z.string().uuid(), findingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [review, finding] = await Promise.all([
        prisma.findingReview.findUnique({ where: { id: input.reviewId } }),
        prisma.finding.findUnique({
          where: { id: input.findingId },
          include: { docVersion: { include: { document: { include: { study: true } } } } },
        }),
      ]);

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      }
      if (!finding || finding.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      }

      const newValue = !finding.hiddenByReviewer;

      await prisma.findingReviewLog.create({
        data: {
          reviewId: input.reviewId,
          findingId: input.findingId,
          reviewerId: ctx.user.id,
          action: newValue ? "hide" : "unhide",
          previousValue: String(!newValue),
          newValue: String(newValue),
        },
      });

      return prisma.finding.update({
        where: { id: input.findingId },
        data: { hiddenByReviewer: newValue },
      });
    }),

  changeSeverity: reviewerProcedure
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [review, finding] = await Promise.all([
        prisma.findingReview.findUnique({ where: { id: input.reviewId } }),
        prisma.finding.findUnique({
          where: { id: input.findingId },
          include: { docVersion: { include: { document: { include: { study: true } } } } },
        }),
      ]);

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      }
      if (!finding || finding.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      }

      const previousSeverity = finding.severity ?? "info";

      await prisma.findingReviewLog.create({
        data: {
          reviewId: input.reviewId,
          findingId: input.findingId,
          reviewerId: ctx.user.id,
          action: "change_severity",
          previousValue: previousSeverity,
          newValue: input.severity,
        },
      });

      return prisma.finding.update({
        where: { id: input.findingId },
        data: { severity: input.severity as any },
      });
    }),

  addNote: reviewerProcedure
    .input(
      z.object({
        reviewId: z.string().uuid(),
        findingId: z.string().uuid(),
        note: z.string().max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [review, finding] = await Promise.all([
        prisma.findingReview.findUnique({ where: { id: input.reviewId } }),
        prisma.finding.findUnique({
          where: { id: input.findingId },
          include: { docVersion: { include: { document: { include: { study: true } } } } },
        }),
      ]);

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      }
      if (!finding || finding.docVersion.document.study.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Finding not found" });
      }

      await prisma.findingReviewLog.create({
        data: {
          reviewId: input.reviewId,
          findingId: input.findingId,
          reviewerId: ctx.user.id,
          action: "add_note",
          previousValue: finding.reviewerNote ?? null,
          newValue: input.note,
        },
      });

      return prisma.finding.update({
        where: { id: input.findingId },
        data: { reviewerNote: input.note },
      });
    }),

  publish: reviewerProcedure
    .input(z.object({ reviewId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const review = await prisma.findingReview.findUnique({
        where: { id: input.reviewId },
      });

      if (!review || review.tenantId !== ctx.user.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (review.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Review is already published",
        });
      }

      return prisma.findingReview.update({
        where: { id: input.reviewId },
        data: {
          status: "published",
          publishedAt: new Date(),
          reviewerId: review.reviewerId ?? ctx.user.id,
        },
      });
    }),

  getReviewStatus: protectedProcedure
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        auditType: z.enum(["intra_audit", "inter_audit"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const review = await prisma.findingReview.findUnique({
        where: {
          docVersionId_auditType: {
            docVersionId: input.docVersionId,
            auditType: input.auditType as any,
          },
        },
        select: { id: true, status: true, publishedAt: true },
      });

      return review ?? null;
    }),
});
