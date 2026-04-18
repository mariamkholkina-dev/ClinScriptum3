import { prisma } from "@clinscriptum/db";
import type { ApprovalType } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";
import { logger } from "../lib/logger.js";

export const approvalService = {
  async createRequest(data: {
    tenantId: string;
    type: ApprovalType;
    requestedById: string;
    title: string;
    description: string;
    context: any;
    entityType: string;
    entityId: string;
  }) {
    logger.info("Creating approval request", {
      type: data.type as string, entityType: data.entityType, entityId: data.entityId,
    } as any);

    return prisma.approvalRequest.create({
      data: {
        tenantId: data.tenantId,
        type: data.type,
        requestedById: data.requestedById,
        title: data.title,
        description: data.description,
        context: data.context,
        entityType: data.entityType,
        entityId: data.entityId,
      },
    });
  },

  async listRequests(
    tenantId: string,
    filters?: { status?: string; type?: string; requestedById?: string; reviewedById?: string },
  ) {
    const where: any = { tenantId };
    if (filters?.status) where.status = filters.status;
    if (filters?.type) where.type = filters.type;
    if (filters?.requestedById) where.requestedById = filters.requestedById;
    if (filters?.reviewedById) where.reviewedById = filters.reviewedById;

    return prisma.approvalRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: "desc" },
    });
  },

  async getRequest(id: string) {
    const request = await prisma.approvalRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!request) {
      throw new DomainError("NOT_FOUND", "Approval request not found");
    }

    return request;
  },

  async reviewRequest(
    id: string,
    data: { reviewedById: string; status: "approved" | "rejected"; comment?: string },
  ) {
    const request = await prisma.approvalRequest.findUnique({ where: { id } });

    if (!request) {
      throw new DomainError("NOT_FOUND", "Approval request not found");
    }

    if (request.status !== "pending") {
      throw new DomainError("BAD_REQUEST", `Cannot review request with status '${request.status}'`);
    }

    if (request.requestedById === data.reviewedById) {
      throw new DomainError("FORBIDDEN", "Cannot review your own approval request");
    }

    logger.info("Reviewing approval request", { requestId: id, newStatus: data.status } as any);

    return prisma.approvalRequest.update({
      where: { id },
      data: {
        status: data.status,
        reviewedById: data.reviewedById,
        reviewedAt: new Date(),
        comment: data.comment ?? null,
      },
    });
  },

  async applyApproval(id: string) {
    const request = await prisma.approvalRequest.findUnique({ where: { id } });

    if (!request) {
      throw new DomainError("NOT_FOUND", "Approval request not found");
    }

    if (request.status !== "approved") {
      throw new DomainError("PRECONDITION_FAILED", "Only approved requests can be applied");
    }

    logger.info("Applying approved change", {
      requestId: id, entityType: request.entityType, entityId: request.entityId,
    } as any);

    if (request.entityType === "rule_set_version") {
      const version = await prisma.ruleSetVersion.findUnique({
        where: { id: request.entityId },
      });

      if (!version) {
        throw new DomainError("NOT_FOUND", "Rule set version not found");
      }

      await prisma.$transaction([
        prisma.ruleSetVersion.updateMany({
          where: { ruleSetId: version.ruleSetId, isActive: true },
          data: { isActive: false },
        }),
        prisma.ruleSetVersion.update({
          where: { id: version.id },
          data: { isActive: true },
        }),
      ]);

      logger.info("Activated rule set version via approval", { ruleSetVersionId: version.id } as any);
      return { applied: true, entityType: request.entityType, entityId: request.entityId };
    }

    if (request.entityType === "golden_sample_stage") {
      const stageStatus = await prisma.goldenSampleStageStatus.findUnique({
        where: { id: request.entityId },
      });

      if (!stageStatus) {
        throw new DomainError("NOT_FOUND", "Golden sample stage status not found");
      }

      await prisma.goldenSampleStageStatus.update({
        where: { id: stageStatus.id },
        data: {
          status: "approved",
          approvedAt: new Date(),
          approvedById: request.reviewedById,
        },
      });

      logger.info("Approved golden sample stage via approval", { goldenSampleStageId: stageStatus.id } as any);
      return { applied: true, entityType: request.entityType, entityId: request.entityId };
    }

    logger.warn("No automatic apply handler for entity type", { entityType: request.entityType } as any);
    return { applied: false, entityType: request.entityType, entityId: request.entityId, reason: "No handler for entity type" };
  },

  async getPendingCount(tenantId: string) {
    return prisma.approvalRequest.count({
      where: { tenantId, status: "pending" },
    });
  },

  async getHistory(
    tenantId: string,
    filters?: { entityType?: string; entityId?: string },
  ) {
    const where: any = { tenantId };
    if (filters?.entityType) where.entityType = filters.entityType;
    if (filters?.entityId) where.entityId = filters.entityId;

    return prisma.approvalRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { requestedAt: "desc" },
    });
  },
};
