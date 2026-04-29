import { prisma } from "@clinscriptum/db";
import { Prisma } from "@prisma/client";
import { requireTenantResource } from "./tenant-guard.js";
import { EXCLUDED_SECTION_PREFIXES } from "@clinscriptum/shared/fact-extraction";

const GLOBAL_DEFAULT_PREFIXES = EXCLUDED_SECTION_PREFIXES;

export const studyService = {
  async list(tenantId: string) {
    return prisma.study.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(tenantId: string, studyId: string) {
    return prisma.study.findFirst({
      where: { id: studyId, tenantId },
      include: {
        documents: {
          include: {
            versions: { orderBy: { versionNumber: "desc" } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },

  async create(
    tenantId: string,
    input: {
      title: string;
      sponsor?: string;
      drug?: string;
      therapeuticArea?: string;
      protocolTitle?: string;
      phase: string;
    },
  ) {
    return prisma.study.create({
      data: {
        tenantId,
        title: input.title,
        sponsor: input.sponsor || null,
        drug: input.drug || null,
        therapeuticArea: input.therapeuticArea || null,
        protocolTitle: input.protocolTitle || null,
        phase: input.phase,
      },
    });
  },

  async update(
    tenantId: string,
    studyId: string,
    data: {
      title?: string;
      sponsor?: string;
      drug?: string;
      therapeuticArea?: string;
      protocolTitle?: string;
      phase?: string;
    },
  ) {
    return prisma.study.updateMany({
      where: { id: studyId, tenantId },
      data,
    });
  },

  async delete(tenantId: string, studyId: string) {
    return prisma.study.deleteMany({
      where: { id: studyId, tenantId },
    });
  },

  async getSettings(tenantId: string, studyId: string) {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
      select: { id: true, tenantId: true, operatorReviewEnabled: true, llmThinkingEnabled: true, excludedSectionPrefixes: true, auditMode: true, crossCheckPairs: true },
    });
    requireTenantResource(study, tenantId);
    return {
      operatorReviewEnabled: study.operatorReviewEnabled,
      llmThinkingEnabled: study.llmThinkingEnabled,
      excludedSectionPrefixes: study.excludedSectionPrefixes,
      auditMode: study.auditMode,
      crossCheckPairs: study.crossCheckPairs as [string, string][] | null,
    };
  },

  async updateSettings(
    tenantId: string,
    studyId: string,
    data: { operatorReviewEnabled?: boolean; llmThinkingEnabled?: boolean; excludedSectionPrefixes?: string[]; auditMode?: string; crossCheckPairs?: [string, string][] | null },
  ) {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
    });
    requireTenantResource(study, tenantId);

    const prismaData: Record<string, unknown> = { ...data };
    if ("crossCheckPairs" in data) {
      prismaData.crossCheckPairs = data.crossCheckPairs === null
        ? Prisma.JsonNull
        : data.crossCheckPairs;
    }

    await prisma.study.update({
      where: { id: studyId },
      data: prismaData,
    });
    return { success: true };
  },

  async getGlobalConfig(tenantId: string) {
    const config = await prisma.tenantConfig.findUnique({ where: { tenantId } });
    return {
      excludedSectionPrefixes: config?.excludedSectionPrefixes ?? GLOBAL_DEFAULT_PREFIXES,
    };
  },

  async updateGlobalConfig(tenantId: string, data: { excludedSectionPrefixes: string[] }) {
    await prisma.tenantConfig.upsert({
      where: { tenantId },
      create: { tenantId, excludedSectionPrefixes: data.excludedSectionPrefixes },
      update: { excludedSectionPrefixes: data.excludedSectionPrefixes },
    });
    return { success: true };
  },

  async resolveExcludedPrefixes(tenantId: string, studyId: string): Promise<string[]> {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
      select: { excludedSectionPrefixes: true },
    });
    if (study && study.excludedSectionPrefixes.length > 0) {
      return study.excludedSectionPrefixes;
    }
    const config = await prisma.tenantConfig.findUnique({ where: { tenantId } });
    return config?.excludedSectionPrefixes ?? GLOBAL_DEFAULT_PREFIXES;
  },
};
