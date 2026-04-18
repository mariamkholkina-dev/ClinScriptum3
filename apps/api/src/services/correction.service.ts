import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

export const correctionService = {
  async recordCorrection(data: {
    tenantId: string;
    userId: string;
    userRole: string;
    documentVersionId: string;
    stage: string;
    entityType: string;
    entityId: string;
    originalValue: any;
    correctedValue: any;
    context?: any;
  }) {
    logger.info("Recording user correction", { stage: data.stage, entityType: data.entityType, entityId: data.entityId } as any);

    return prisma.correctionRecord.create({
      data: {
        tenantId: data.tenantId,
        userId: data.userId,
        userRole: data.userRole,
        documentVersionId: data.documentVersionId,
        stage: data.stage,
        entityType: data.entityType,
        entityId: data.entityId,
        originalValue: data.originalValue,
        correctedValue: data.correctedValue,
        context: data.context ?? {},
      },
    });
  },

  async listCorrections(
    tenantId: string,
    filters?: { stage?: string; entityType?: string; isProcessed?: boolean; userId?: string },
  ) {
    const where: any = { tenantId };
    if (filters?.stage) where.stage = filters.stage;
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.isProcessed !== undefined) where.isProcessed = filters.isProcessed;
    if (filters?.userId) where.userId = filters.userId;

    return prisma.correctionRecord.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        documentVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getCorrection(id: string) {
    const record = await prisma.correctionRecord.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        documentVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
        recommendation: true,
      },
    });

    if (!record) {
      throw new DomainError("NOT_FOUND", "Correction record not found");
    }

    return record;
  },

  async markProcessed(ids: string[]) {
    if (ids.length === 0) {
      throw new DomainError("BAD_REQUEST", "No correction IDs provided");
    }

    const result = await prisma.correctionRecord.updateMany({
      where: { id: { in: ids } },
      data: { isProcessed: true },
    });

    logger.info("Marked corrections as processed", { count: result.count } as any);
    return result;
  },

  async getAggregatedPatterns(tenantId: string, stage?: string) {
    const where: any = { tenantId };
    if (stage) where.stage = stage;

    const corrections = await prisma.correctionRecord.findMany({
      where,
      select: {
        stage: true,
        entityType: true,
        originalValue: true,
        correctedValue: true,
      },
    });

    const patternMap = new Map<string, { stage: string; entityType: string; originalValue: any; correctedValue: any; frequency: number }>();

    for (const c of corrections) {
      const key = `${c.stage}::${c.entityType}::${JSON.stringify(c.originalValue)}::${JSON.stringify(c.correctedValue)}`;
      const existing = patternMap.get(key);
      if (existing) {
        existing.frequency++;
      } else {
        patternMap.set(key, {
          stage: c.stage,
          entityType: c.entityType,
          originalValue: c.originalValue,
          correctedValue: c.correctedValue,
          frequency: 1,
        });
      }
    }

    return Array.from(patternMap.values()).sort((a, b) => b.frequency - a.frequency);
  },

  async createRecommendation(data: {
    tenantId: string;
    stage: string;
    pattern: string;
    frequency: number;
    suggestedChange: string;
    affectedRuleId?: string;
    correctionIds: string[];
  }) {
    const recommendation = await prisma.correctionRecommendation.create({
      data: {
        tenantId: data.tenantId,
        stage: data.stage,
        pattern: data.pattern,
        frequency: data.frequency,
        suggestedChange: data.suggestedChange,
        affectedRuleId: data.affectedRuleId ?? null,
      },
    });

    if (data.correctionIds.length > 0) {
      await prisma.correctionRecord.updateMany({
        where: { id: { in: data.correctionIds } },
        data: { recommendationId: recommendation.id },
      });
    }

    logger.info("Created correction recommendation", { recommendationId: recommendation.id, linkedCorrections: data.correctionIds.length } as any);
    return recommendation;
  },

  async listRecommendations(
    tenantId: string,
    filters?: { stage?: string; status?: string },
  ) {
    const where: any = { tenantId };
    if (filters?.stage) where.stage = filters.stage;
    if (filters?.status) where.status = filters.status;

    return prisma.correctionRecommendation.findMany({
      where,
      include: {
        reviewedBy: { select: { id: true, name: true, email: true } },
        corrections: {
          select: { id: true, stage: true, entityType: true, entityId: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async reviewRecommendation(
    id: string,
    data: { status: "accepted" | "rejected" | "implemented"; reviewedById: string; comment?: string },
  ) {
    const recommendation = await prisma.correctionRecommendation.findUnique({
      where: { id },
    });

    if (!recommendation) {
      throw new DomainError("NOT_FOUND", "Recommendation not found");
    }

    if (recommendation.status !== "pending" && recommendation.status !== "accepted") {
      throw new DomainError("BAD_REQUEST", `Cannot transition from '${recommendation.status}' to '${data.status}'`);
    }

    logger.info("Reviewing correction recommendation", { recommendationId: id, newStatus: data.status } as any);

    return prisma.correctionRecommendation.update({
      where: { id },
      data: {
        status: data.status,
        reviewedById: data.reviewedById,
        reviewedAt: new Date(),
        comment: data.comment ?? null,
      },
    });
  },

  async getStats(tenantId: string) {
    const [totalCorrections, unprocessedCorrections, recommendations] = await Promise.all([
      prisma.correctionRecord.count({ where: { tenantId } }),
      prisma.correctionRecord.count({ where: { tenantId, isProcessed: false } }),
      prisma.correctionRecommendation.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: true,
      }),
    ]);

    const recommendationsByStatus: Record<string, number> = {};
    for (const r of recommendations) {
      recommendationsByStatus[r.status] = r._count;
    }

    return {
      totalCorrections,
      unprocessedCorrections,
      recommendationsByStatus,
    };
  },
};
