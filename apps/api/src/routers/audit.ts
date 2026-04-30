import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { auditService } from "../services/audit.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const auditRouter = router({
  startIntraAudit: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      auditService.startIntraAudit(ctx.user.tenantId, input.docVersionId),
    ),

  getAuditStatus: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      auditService.getAuditStatus(ctx.user.tenantId, input.docVersionId),
    ),

  getAuditFindings: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        category: z.string().optional(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]).optional(),
        take: z.number().int().min(1).max(500).optional(),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      auditService.getAuditFindings(ctx.user.tenantId, ctx.user.role, input),
    ),

  getAuditSummary: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      auditService.getAuditSummary(ctx.user.tenantId, input.docVersionId),
    ),

  updateAuditFindingStatus: p
    .input(
      z.object({
        findingId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      auditService.updateAuditFindingStatus(ctx.user.tenantId, input.findingId, input.status),
    ),

  validateAllAuditFindings: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        action: z.enum(["resolve", "reject"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      auditService.validateAllAuditFindings(ctx.user.tenantId, input.docVersionId, input.action),
    ),

  getDocumentSections: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      auditService.getDocumentSections(ctx.user.tenantId, input.docVersionId),
    ),

  /* ═══════════ Inter-document audit (cross-doc concordance) ═══════════ */

  startInterAudit: p
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      }),
    )
    .mutation(({ ctx, input }) =>
      auditService.startInterAudit(
        ctx.user.tenantId,
        input.protocolVersionId,
        input.checkedVersionId,
      ),
    ),

  getInterAuditStatus: p
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      auditService.getInterAuditStatus(
        ctx.user.tenantId,
        input.protocolVersionId,
        input.checkedVersionId,
      ),
    ),

  getInterAuditFindings: p
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
        severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]).optional(),
        take: z.number().int().min(1).max(500).optional(),
        cursor: z.string().uuid().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      auditService.getInterAuditFindings(ctx.user.tenantId, ctx.user.role, input),
    ),

  getInterAuditSummary: p
    .input(
      z.object({
        protocolVersionId: z.string().uuid(),
        checkedVersionId: z.string().uuid(),
      }),
    )
    .query(({ ctx, input }) =>
      auditService.getInterAuditSummary(
        ctx.user.tenantId,
        input.protocolVersionId,
        input.checkedVersionId,
      ),
    ),

  validateAllInterAuditFindings: p
    .input(
      z.object({
        checkedVersionId: z.string().uuid(),
        action: z.enum(["resolve", "reject"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      auditService.validateAllInterAuditFindings(
        ctx.user.tenantId,
        input.checkedVersionId,
        input.action,
      ),
    ),

  getStudyDocumentsForInterAudit: p
    .input(z.object({ studyId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      auditService.getStudyDocumentsForInterAudit(ctx.user.tenantId, input.studyId),
    ),
});
