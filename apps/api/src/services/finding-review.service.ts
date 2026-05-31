import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

/**
 * Типы находок, относящиеся к ревью данного auditType. Боевой
 * внутридокументный аудит пишет находки с type=editorial/semantic (а не
 * "intra_audit"), поэтому сопоставлять напрямую type=auditType нельзя —
 * иначе ревью показывает 0 находок. Тот же набор, что в audit.service.
 */
function findingTypesForAudit(auditType: string): string[] {
  return auditType === "intra_audit"
    ? ["intra_audit", "editorial", "semantic"]
    : [auditType];
}

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
            type: { in: findingTypesForAudit(r.auditType) as any },
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

    // Ревьюер должен видеть ВСЕ находки, включая помеченные false_positive
    // (insufficient_context / QA-dismissed / дедуплицированные) — чтобы решать
    // по ним, а не получать уже отфильтрованный набор. Фильтр по статусу
    // делается на клиенте.
    const findings = await prisma.finding.findMany({
      where: {
        docVersionId: review.docVersionId,
        type: { in: findingTypesForAudit(review.auditType) as any },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    });

    // Разделы документа — чтобы детализация находки в Word/web могла показать
    // именно проверяемые разделы (контент, содержащий цитату находки).
    const sectionRows = await prisma.section.findMany({
      where: { docVersionId: review.docVersionId },
      orderBy: { order: "asc" },
      include: { contentBlocks: { orderBy: { order: "asc" } } },
    });
    const sections = sectionRows.map((s) => ({
      id: s.id,
      title: s.title,
      standardSection: s.standardSection,
      content: s.contentBlocks.map((b) => b.content).join("\n"),
    }));

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
      sections,
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

    // «Эффективная» серьёзность intra-audit находок лежит в
    // extraAttributes.severity (колонка Finding.severity у них не заполняется).
    // Берём предыдущее значение оттуда же, чтобы лог и originalSeverity
    // отражали то, что реально видел ревьюер.
    const extra = (finding.extraAttributes ?? {}) as Record<string, unknown>;
    const previousSeverity =
      (extra.severity as string) ?? finding.severity ?? "info";

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
      data: {
        // Пишем И колонку, И extraAttributes.severity — иначе правка ревьюера
        // не отразилась бы на экранах/в отчёте, читающих extraAttributes
        // (внутридокументный аудит, audit-report).
        severity: severity as any,
        extraAttributes: { ...extra, severity } as any,
        // Сохраняем исходную (алгоритмическую) серьёзность при первой правке —
        // для индикатора «Алгоритм: X».
        originalSeverity:
          (finding.originalSeverity as any) ?? (previousSeverity as any),
      },
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

  /**
   * Sprint 6b — promote-to-golden: переносит finding из production-review
   * в expectedResults конкретного GoldenSample (stage='intra_audit').
   * Это закрывает feedback loop production → датасет: реальные defect-ы,
   * отмеченные qc_operator, наполняют golden corpus без отдельной
   * аннотации.
   */
  async promoteFindingToGolden(
    tenantId: string,
    reviewId: string,
    findingId: string,
    goldenSampleId: string,
    userId: string,
  ) {
    const review = await prisma.findingReview.findUnique({
      where: { id: reviewId },
    });
    requireTenantResource(review, tenantId);

    const finding = await prisma.finding.findUnique({ where: { id: findingId } });
    if (!finding || finding.docVersionId !== review!.docVersionId) {
      throw new DomainError("NOT_FOUND", "Finding not in this review");
    }

    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
      include: { stageStatuses: { where: { stage: "intra_audit" } } },
    });
    requireTenantResource(sample, tenantId);

    const src = (finding.sourceRef ?? {}) as Record<string, unknown>;
    const severity =
      finding.severity === "critical" ||
      finding.severity === "high" ||
      finding.severity === "medium" ||
      finding.severity === "low" ||
      finding.severity === "info"
        ? finding.severity
        : "medium";

    const expected = {
      id: finding.id,
      issueFamily: finding.issueFamily ?? "UNKNOWN",
      issueType: finding.issueType ?? "",
      severity,
      anchorZone: finding.anchorZone ?? "",
      targetZone: finding.targetZone ?? undefined,
      anchorQuote: typeof src.anchorQuote === "string" ? src.anchorQuote : "",
      targetQuote: typeof src.targetQuote === "string" ? src.targetQuote : undefined,
      description: finding.description,
      mustDetect: true,
      notes: `promoted from review ${reviewId}`,
    };

    const existing = sample!.stageStatuses[0];
    if (existing) {
      const cur = (existing.expectedResults ?? {}) as Record<string, unknown>;
      const findings = Array.isArray(cur.findings) ? cur.findings : [];
      // Dedup by id
      if (findings.some((f: unknown) => (f as { id?: string }).id === expected.id)) {
        return { promoted: false, reason: "already_present" as const };
      }
      await prisma.goldenSampleStageStatus.update({
        where: { id: existing.id },
        data: {
          expectedResults: { ...cur, findings: [...findings, expected] } as object,
        },
      });
    } else {
      await prisma.goldenSampleStageStatus.create({
        data: {
          goldenSampleId,
          stage: "intra_audit",
          status: "draft",
          expectedResults: {
            findings: [expected],
            problems: [],
            coverage: "complete",
          } as object,
        },
      });
    }

    await prisma.findingReviewLog.create({
      data: {
        reviewId,
        findingId,
        reviewerId: userId,
        action: "promoted_to_golden",
        newValue: goldenSampleId,
      },
    });

    return { promoted: true, goldenSampleId };
  },

  /** Список эталонных наборов тенанта для выбора при promote-to-golden.
   *  Доступен ревьюеру (reviewerProcedure) — минимальный набор полей, чтобы не
   *  открывать ревьюеру весь quality-only goldenDataset.listSamples. */
  async listGoldenSamples(tenantId: string) {
    const samples = await prisma.goldenSample.findMany({
      where: { tenantId },
      select: { id: true, name: true, sampleType: true },
      orderBy: { createdAt: "desc" },
    });
    return samples;
  },

  /** Массовое скрытие/показ находок ревьюером (ложноположительные).
   *  Пишет audit-лог по каждой реально изменённой находке. */
  async bulkSetHidden(
    tenantId: string,
    reviewId: string,
    findingIds: string[],
    hidden: boolean,
    userId: string,
  ) {
    const review = await prisma.findingReview.findUnique({ where: { id: reviewId } });
    requireTenantResource(review, tenantId);

    // Ограничиваем находки документом этого ревью — гарантия принадлежности тенанту.
    const findings = await prisma.finding.findMany({
      where: { id: { in: findingIds }, docVersionId: review.docVersionId },
    });

    let updated = 0;
    for (const f of findings) {
      if (f.hiddenByReviewer === hidden) continue;
      await prisma.findingReviewLog.create({
        data: {
          reviewId,
          findingId: f.id,
          reviewerId: userId,
          action: hidden ? "hide" : "unhide",
          previousValue: String(f.hiddenByReviewer),
          newValue: String(hidden),
        },
      });
      await prisma.finding.update({
        where: { id: f.id },
        data: { hiddenByReviewer: hidden },
      });
      updated += 1;
    }
    return { updated };
  },

  /** Массовая смена серьёзности. Как и одиночная changeSeverity, пишет И
   *  колонку, И extraAttributes.severity, и сохраняет originalSeverity. */
  async bulkChangeSeverity(
    tenantId: string,
    reviewId: string,
    findingIds: string[],
    severity: "critical" | "high" | "medium" | "low" | "info",
    userId: string,
  ) {
    const review = await prisma.findingReview.findUnique({ where: { id: reviewId } });
    requireTenantResource(review, tenantId);

    const findings = await prisma.finding.findMany({
      where: { id: { in: findingIds }, docVersionId: review.docVersionId },
    });

    let updated = 0;
    for (const f of findings) {
      const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
      const previousSeverity = (extra.severity as string) ?? f.severity ?? "info";
      if (f.severity === severity && extra.severity === severity) continue;
      await prisma.findingReviewLog.create({
        data: {
          reviewId,
          findingId: f.id,
          reviewerId: userId,
          action: "change_severity",
          previousValue: previousSeverity,
          newValue: severity,
        },
      });
      await prisma.finding.update({
        where: { id: f.id },
        data: {
          severity: severity as any,
          extraAttributes: { ...extra, severity } as any,
          originalSeverity: (f.originalSeverity as any) ?? (previousSeverity as any),
        },
      });
      updated += 1;
    }
    return { updated };
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
