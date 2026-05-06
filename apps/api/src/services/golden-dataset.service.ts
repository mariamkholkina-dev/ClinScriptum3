import { prisma } from "@clinscriptum/db";
import type { DocumentType, GoldenStageStatus } from "@prisma/client";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

type SampleType = "single_document" | "multi_document";

export const goldenDatasetService = {
  async createSample(
    tenantId: string,
    data: {
      name: string;
      description?: string;
      sampleType: SampleType;
      createdById: string;
    },
  ) {
    return prisma.goldenSample.create({
      data: {
        tenantId,
        name: data.name,
        description: data.description,
        sampleType: data.sampleType,
        createdById: data.createdById,
      },
    });
  },

  async addDocument(
    goldenSampleId: string,
    data: {
      documentVersionId: string;
      documentType: DocumentType;
      role?: string;
      order?: number;
    },
  ) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    return prisma.goldenSampleDocument.create({
      data: {
        goldenSampleId,
        documentVersionId: data.documentVersionId,
        documentType: data.documentType,
        role: data.role ?? "primary",
        order: data.order ?? 0,
      },
    });
  },

  async removeDocument(goldenSampleDocumentId: string) {
    const doc = await prisma.goldenSampleDocument.findUnique({
      where: { id: goldenSampleDocumentId },
    });
    if (!doc) {
      throw new DomainError("NOT_FOUND", "Golden sample document not found");
    }

    await prisma.goldenSampleDocument.delete({
      where: { id: goldenSampleDocumentId },
    });
    return { success: true };
  },

  async listSamples(
    tenantId: string,
    filters?: { sampleType?: string; stage?: string; stageStatus?: string },
  ) {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.sampleType) {
      where.sampleType = filters.sampleType;
    }
    if (filters?.stage || filters?.stageStatus) {
      const stageWhere: Record<string, unknown> = {};
      if (filters.stage) stageWhere.stage = filters.stage;
      if (filters.stageStatus) stageWhere.status = filters.stageStatus;
      where.stageStatuses = { some: stageWhere };
    }

    return prisma.goldenSample.findMany({
      where,
      include: {
        documents: {
          include: {
            documentVersion: {
              select: { id: true, versionLabel: true, versionNumber: true },
            },
          },
        },
        stageStatuses: true,
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async getSample(id: string) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id },
      include: {
        documents: {
          include: {
            documentVersion: {
              select: {
                id: true,
                versionLabel: true,
                versionNumber: true,
                status: true,
                document: { select: { id: true, title: true, type: true } },
              },
            },
          },
          orderBy: { order: "asc" },
        },
        stageStatuses: { orderBy: { stage: "asc" } },
        createdBy: { select: { id: true, email: true, name: true } },
      },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }
    return sample;
  },

  async deleteSample(id: string) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    await prisma.goldenSample.delete({ where: { id } });
    return { success: true };
  },

  async updateStageStatus(
    goldenSampleId: string,
    stage: string,
    data: {
      status: "draft" | "in_review" | "approved";
      expectedResults?: unknown;
      reviewComment?: string;
      reviewedById?: string;
      approvedById?: string;
    },
  ) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    const updateData: Record<string, unknown> = {
      status: data.status as GoldenStageStatus,
    };
    if (data.expectedResults !== undefined) {
      updateData.expectedResults = data.expectedResults;
    }
    if (data.reviewComment !== undefined) {
      updateData.reviewComment = data.reviewComment;
    }
    if (data.reviewedById) {
      updateData.reviewedById = data.reviewedById;
    }
    if (data.approvedById) {
      updateData.approvedById = data.approvedById;
    }
    // Status-driven timestamps: write reviewedAt / approvedAt whenever the
    // stage transitions into the corresponding state, regardless of whether
    // the caller passed a user id. Without this, audit trails are lost when
    // the endpoint is called without explicit ids (e.g. UI calls before
    // 2026-05-06 fix). See memory project_golden_stage_status_timestamps.
    const now = new Date();
    if (data.status === "in_review") {
      updateData.reviewedAt = now;
    }
    if (data.status === "approved") {
      updateData.approvedAt = now;
      // Approved is the «final» state — also set reviewedAt if it wasn't
      // already (the row may go straight draft → approved).
      if (!updateData.reviewedAt) updateData.reviewedAt = now;
    }

    return prisma.goldenSampleStageStatus.upsert({
      where: {
        goldenSampleId_stage: { goldenSampleId, stage },
      },
      create: {
        goldenSampleId,
        stage,
        ...updateData,
      },
      update: updateData,
    });
  },

  async getApprovedStages(goldenSampleId: string) {
    const sample = await prisma.goldenSample.findUnique({
      where: { id: goldenSampleId },
    });
    if (!sample) {
      throw new DomainError("NOT_FOUND", "Golden sample not found");
    }

    return prisma.goldenSampleStageStatus.findMany({
      where: { goldenSampleId, status: "approved" },
      orderBy: { stage: "asc" },
    });
  },

  async listApprovedSamples(tenantId: string, stage?: string) {
    const stageWhere: Record<string, unknown> = { status: "approved" };
    if (stage) {
      stageWhere.stage = stage;
    }

    return prisma.goldenSample.findMany({
      where: {
        tenantId,
        stageStatuses: { some: stageWhere },
      },
      include: {
        documents: {
          include: {
            documentVersion: {
              select: { id: true, versionLabel: true, versionNumber: true },
            },
          },
        },
        stageStatuses: { where: { status: "approved" } },
        _count: { select: { documents: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async batchImport(
    tenantId: string,
    createdById: string,
    items: Array<{
      name: string;
      documentVersionIds: string[];
      documentTypes: DocumentType[];
      sampleType: SampleType;
    }>,
  ) {
    const results = await prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; name: string; documentCount: number }> = [];

      for (const item of items) {
        if (item.documentVersionIds.length !== item.documentTypes.length) {
          throw new DomainError(
            "BAD_REQUEST",
            `Mismatch between documentVersionIds and documentTypes length for "${item.name}"`,
          );
        }

        const sample = await tx.goldenSample.create({
          data: {
            tenantId,
            name: item.name,
            sampleType: item.sampleType,
            createdById,
          },
        });

        if (item.documentVersionIds.length > 0) {
          await tx.goldenSampleDocument.createMany({
            data: item.documentVersionIds.map((dvId, idx) => ({
              goldenSampleId: sample.id,
              documentVersionId: dvId,
              documentType: item.documentTypes[idx],
              order: idx,
            })),
          });
        }

        created.push({
          id: sample.id,
          name: sample.name,
          documentCount: item.documentVersionIds.length,
        });
      }

      return created;
    });

    logger.info("Golden dataset batch import completed", {
      tenantId,
      count: results.length,
    });

    return results;
  },
};
