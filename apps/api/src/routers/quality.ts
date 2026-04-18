import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { correctionService } from "../services/correction.service.js";
import { disagreementService } from "../services/disagreement.service.js";
import { approvalService } from "../services/approval.service.js";

const p = qualityProcedure.use(withDomainErrors);

const stageEnum = z.enum([
  "section_classification",
  "fact_extraction",
  "contradiction_detection",
  "soa_detection",
  "icf_generation",
  "csr_generation",
]);

const entityTypeEnum = z.enum(["section", "fact", "contradiction", "soa_cell"]);
const documentTypeEnum = z.enum(["protocol", "icf", "ib", "csr"]);
const resolutionEnum = z.enum(["algo", "llm", "custom"]);
const recommendationStatusEnum = z.enum(["pending", "accepted", "rejected"]);

const approvalTypeEnum = z.enum(["rule_activation", "llm_config_change", "golden_dataset_approval"]);
const approvalStatusEnum = z.enum(["pending", "approved", "rejected"]);
const approvalEntityTypeEnum = z.enum(["rule_set_version", "llm_config", "golden_sample"]);

export const qualityRouter = router({
  /* ═══════════════ Corrections ═══════════════ */

  recordCorrection: p
    .input(
      z.object({
        documentVersionId: z.string().uuid(),
        stage: stageEnum,
        entityType: entityTypeEnum,
        entityId: z.string().uuid(),
        originalValue: z.string(),
        correctedValue: z.string(),
        context: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      correctionService.recordCorrection({
        tenantId: ctx.user.tenantId,
        userId: ctx.user.userId,
        userRole: ctx.user.role,
        documentVersionId: input.documentVersionId,
        stage: input.stage,
        entityType: input.entityType,
        entityId: input.entityId,
        originalValue: input.originalValue,
        correctedValue: input.correctedValue,
        context: input.context,
      }),
    ),

  listCorrections: p
    .input(
      z.object({
        stage: stageEnum.optional(),
        entityType: entityTypeEnum.optional(),
        isProcessed: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      correctionService.listCorrections(ctx.user.tenantId, input),
    ),

  getAggregatedPatterns: p
    .input(z.object({ stage: stageEnum.optional() }))
    .query(({ ctx, input }) =>
      correctionService.getAggregatedPatterns(ctx.user.tenantId, input.stage),
    ),

  listRecommendations: p
    .input(
      z.object({
        stage: stageEnum.optional(),
        status: recommendationStatusEnum.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      correctionService.listRecommendations(ctx.user.tenantId, input),
    ),

  reviewRecommendation: p
    .input(
      z.object({
        id: z.string().uuid(),
        status: recommendationStatusEnum,
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      correctionService.reviewRecommendation(input.id, {
        status: input.status as "accepted" | "rejected" | "implemented",
        reviewedById: ctx.user.userId,
        comment: input.comment,
      }),
    ),

  /* ═══════════════ Disagreements ═══════════════ */

  listDisagreements: p
    .input(
      z.object({
        stage: stageEnum.optional(),
        documentType: documentTypeEnum.optional(),
        docVersionId: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      disagreementService.listDisagreements(ctx.user.tenantId, input),
    ),

  resolveDisagreement: p
    .input(
      z.object({
        entityId: z.string().uuid(),
        stage: stageEnum,
        resolution: resolutionEnum,
        customValue: z.string().optional(),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      disagreementService.resolveDisagreement({
        entityId: input.entityId,
        stage: input.stage,
        resolution: input.resolution,
        customValue: input.customValue,
        resolvedById: ctx.user.userId,
        comment: input.comment,
      }),
    ),

  getDisagreementStats: p
    .query(({ ctx }) =>
      disagreementService.getStats(ctx.user.tenantId),
    ),

  /* ═══════════════ Approvals ═══════════════ */

  createApprovalRequest: p
    .input(
      z.object({
        type: approvalTypeEnum,
        title: z.string(),
        description: z.string(),
        context: z.record(z.unknown()),
        entityType: approvalEntityTypeEnum,
        entityId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      approvalService.createRequest({
        tenantId: ctx.user.tenantId,
        type: input.type as any,
        requestedById: ctx.user.userId,
        title: input.title,
        description: input.description,
        context: input.context,
        entityType: input.entityType,
        entityId: input.entityId,
      }),
    ),

  listApprovalRequests: p
    .input(
      z.object({
        status: approvalStatusEnum.optional(),
        type: approvalTypeEnum.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      approvalService.listRequests(ctx.user.tenantId, input),
    ),

  getApprovalRequest: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      approvalService.getRequest(input.id),
    ),

  reviewApprovalRequest: p
    .input(
      z.object({
        id: z.string().uuid(),
        status: z.enum(["approved", "rejected"]),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      approvalService.reviewRequest(input.id, {
        reviewedById: ctx.user.userId,
        status: input.status,
        comment: input.comment,
      }),
    ),

  getPendingApprovalCount: p
    .query(({ ctx }) =>
      approvalService.getPendingCount(ctx.user.tenantId),
    ),
});
