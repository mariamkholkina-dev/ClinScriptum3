import { prisma } from "@clinscriptum/db";
import { requireTenantResource } from "./tenant-guard.js";

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
};
