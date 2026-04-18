import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

export const disagreementService = {
  async listDisagreements(
    tenantId: string,
    filters?: { stage?: string; documentType?: string; docVersionId?: string },
  ) {
    const results: Array<{
      entityId: string;
      entityType: string;
      stage: string;
      algoResult: string | null;
      llmResult: string | null;
      algoConfidence: number;
      llmConfidence: number;
      documentContext: { docVersionId: string; documentTitle: string; documentType: string; versionLabel: string };
    }> = [];

    const shouldIncludeClassification = !filters?.stage || filters.stage === "classification";
    const shouldIncludeExtraction = !filters?.stage || filters.stage === "extraction";

    if (shouldIncludeClassification) {
      const sectionWhere: any = {
        docVersion: { document: { study: { tenantId } } },
        algoSection: { not: null },
        llmSection: { not: null },
      };
      if (filters?.docVersionId) sectionWhere.docVersionId = filters.docVersionId;

      const sections = await prisma.section.findMany({
        where: sectionWhere,
        include: {
          docVersion: {
            include: { document: { select: { title: true, type: true } } },
          },
        },
      });

      for (const s of sections) {
        if (s.algoSection !== s.llmSection) {
          if (filters?.documentType && s.docVersion.document.type !== filters.documentType) continue;

          results.push({
            entityId: s.id,
            entityType: "section",
            stage: "classification",
            algoResult: s.algoSection,
            llmResult: s.llmSection,
            algoConfidence: s.algoConfidence,
            llmConfidence: s.llmConfidence,
            documentContext: {
              docVersionId: s.docVersionId,
              documentTitle: s.docVersion.document.title,
              documentType: s.docVersion.document.type,
              versionLabel: s.docVersion.versionLabel ?? `v${s.docVersion.versionNumber}`,
            },
          });
        }
      }
    }

    if (shouldIncludeExtraction) {
      const factWhere: any = {
        docVersion: { document: { study: { tenantId } } },
        hasContradiction: true,
      };
      if (filters?.docVersionId) factWhere.docVersionId = filters.docVersionId;

      const facts = await prisma.fact.findMany({
        where: factWhere,
        include: {
          docVersion: {
            include: { document: { select: { title: true, type: true } } },
          },
        },
      });

      for (const f of facts) {
        if (filters?.documentType && f.docVersion.document.type !== filters.documentType) continue;

        results.push({
          entityId: f.id,
          entityType: "fact",
          stage: "extraction",
          algoResult: f.value,
          llmResult: f.manualValue,
          algoConfidence: f.confidence,
          llmConfidence: 0,
          documentContext: {
            docVersionId: f.docVersionId,
            documentTitle: f.docVersion.document.title,
            documentType: f.docVersion.document.type,
            versionLabel: f.docVersion.versionLabel ?? `v${f.docVersion.versionNumber}`,
          },
        });
      }
    }

    return results;
  },

  async getDisagreement(entityId: string, stage: string) {
    if (stage === "classification") {
      const section = await prisma.section.findUnique({
        where: { id: entityId },
        include: {
          contentBlocks: { orderBy: { order: "asc" }, take: 5 },
          docVersion: {
            include: { document: { select: { title: true, type: true } } },
          },
        },
      });

      if (!section) {
        throw new DomainError("NOT_FOUND", "Section not found");
      }

      return {
        entityId: section.id,
        entityType: "section",
        stage: "classification",
        algoResult: section.algoSection,
        llmResult: section.llmSection,
        currentResolution: section.standardSection,
        algoConfidence: section.algoConfidence,
        llmConfidence: section.llmConfidence,
        title: section.title,
        level: section.level,
        contentPreview: section.contentBlocks.map((b) => b.content).join(" ").slice(0, 500),
        documentContext: {
          docVersionId: section.docVersionId,
          documentTitle: section.docVersion.document.title,
          documentType: section.docVersion.document.type,
          versionLabel: section.docVersion.versionLabel ?? `v${section.docVersion.versionNumber}`,
        },
      };
    }

    if (stage === "extraction") {
      const fact = await prisma.fact.findUnique({
        where: { id: entityId },
        include: {
          docVersion: {
            include: { document: { select: { title: true, type: true } } },
          },
        },
      });

      if (!fact) {
        throw new DomainError("NOT_FOUND", "Fact not found");
      }

      return {
        entityId: fact.id,
        entityType: "fact",
        stage: "extraction",
        algoResult: fact.value,
        llmResult: fact.manualValue,
        currentResolution: fact.value,
        algoConfidence: fact.confidence,
        llmConfidence: 0,
        factKey: fact.factKey,
        factCategory: fact.factCategory,
        description: fact.description,
        sources: fact.sources,
        documentContext: {
          docVersionId: fact.docVersionId,
          documentTitle: fact.docVersion.document.title,
          documentType: fact.docVersion.document.type,
          versionLabel: fact.docVersion.versionLabel ?? `v${fact.docVersion.versionNumber}`,
        },
      };
    }

    throw new DomainError("BAD_REQUEST", `Unknown disagreement stage: ${stage}`);
  },

  async resolveDisagreement(data: {
    entityId: string;
    stage: string;
    resolution: "algo" | "llm" | "custom";
    customValue?: string;
    resolvedById: string;
    comment?: string;
  }) {
    logger.info("Resolving disagreement", {
      entityId: data.entityId, stage: data.stage, resolution: data.resolution,
    } as any);

    if (data.stage === "classification") {
      const section = await prisma.section.findUnique({ where: { id: data.entityId } });
      if (!section) throw new DomainError("NOT_FOUND", "Section not found");

      let resolvedValue: string;
      if (data.resolution === "algo") {
        resolvedValue = section.algoSection ?? "";
      } else if (data.resolution === "llm") {
        resolvedValue = section.llmSection ?? "";
      } else {
        if (!data.customValue) throw new DomainError("BAD_REQUEST", "customValue is required for custom resolution");
        resolvedValue = data.customValue;
      }

      const originalValue = section.standardSection ?? section.algoSection;

      const updated = await prisma.section.update({
        where: { id: data.entityId },
        data: {
          standardSection: resolvedValue,
          classifiedBy: `resolved_${data.resolution}`,
        },
      });

      if (originalValue !== resolvedValue) {
        await prisma.correctionRecord.create({
          data: {
            tenantId: (await prisma.section.findUnique({
              where: { id: data.entityId },
              include: { docVersion: { include: { document: { include: { study: true } } } } },
            }))!.docVersion.document.study.tenantId,
            userId: data.resolvedById,
            userRole: "resolver",
            documentVersionId: section.docVersionId,
            stage: "classification",
            entityType: "section",
            entityId: data.entityId,
            originalValue: { section: originalValue },
            correctedValue: { section: resolvedValue },
            context: { resolution: data.resolution, comment: data.comment ?? null },
          },
        });
      }

      return updated;
    }

    if (data.stage === "extraction") {
      const fact = await prisma.fact.findUnique({ where: { id: data.entityId } });
      if (!fact) throw new DomainError("NOT_FOUND", "Fact not found");

      let resolvedValue: string;
      if (data.resolution === "algo") {
        resolvedValue = fact.value;
      } else if (data.resolution === "llm") {
        resolvedValue = fact.manualValue ?? fact.value;
      } else {
        if (!data.customValue) throw new DomainError("BAD_REQUEST", "customValue is required for custom resolution");
        resolvedValue = data.customValue;
      }

      const originalValue = fact.value;

      const updated = await prisma.fact.update({
        where: { id: data.entityId },
        data: {
          value: resolvedValue,
          hasContradiction: false,
        },
      });

      if (originalValue !== resolvedValue) {
        await prisma.correctionRecord.create({
          data: {
            tenantId: (await prisma.fact.findUnique({
              where: { id: data.entityId },
              include: { docVersion: { include: { document: { include: { study: true } } } } },
            }))!.docVersion.document.study.tenantId,
            userId: data.resolvedById,
            userRole: "resolver",
            documentVersionId: fact.docVersionId,
            stage: "extraction",
            entityType: "fact",
            entityId: data.entityId,
            originalValue: { value: originalValue },
            correctedValue: { value: resolvedValue },
            context: { resolution: data.resolution, comment: data.comment ?? null },
          },
        });
      }

      return updated;
    }

    throw new DomainError("BAD_REQUEST", `Unknown disagreement stage: ${data.stage}`);
  },

  async getStats(tenantId: string) {
    const sections = await prisma.section.findMany({
      where: {
        docVersion: { document: { study: { tenantId } } },
        algoSection: { not: null },
        llmSection: { not: null },
      },
      select: { algoSection: true, llmSection: true, standardSection: true, classifiedBy: true },
    });

    const classificationDisagreements = sections.filter((s) => s.algoSection !== s.llmSection);
    const classificationResolved = classificationDisagreements.filter(
      (s) => s.classifiedBy?.startsWith("resolved_"),
    );

    const factDisagreements = await prisma.fact.count({
      where: {
        docVersion: { document: { study: { tenantId } } },
        hasContradiction: true,
      },
    });

    return {
      classification: {
        total: classificationDisagreements.length,
        resolved: classificationResolved.length,
        resolutionRate:
          classificationDisagreements.length > 0
            ? classificationResolved.length / classificationDisagreements.length
            : 0,
      },
      extraction: {
        total: factDisagreements,
        resolved: 0,
        resolutionRate: 0,
      },
    };
  },
};
