import { z } from "zod";
import { router, protectedProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { processingService } from "../services/processing.service.js";

const p = protectedProcedure.use(withDomainErrors);

export const processingRouter = router({
  startRun: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        type: z.enum([
          "section_classification",
          "fact_extraction",
          "soa_detection",
          "intra_doc_audit",
          "inter_doc_audit",
          "icf_generation",
          "csr_generation",
          "version_comparison",
        ]),
        ruleSetVersionId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) => processingService.startRun(ctx.user.tenantId, input)),

  getRun: p
    .input(z.object({ runId: z.string().uuid() }))
    .query(({ ctx, input }) => processingService.getRun(ctx.user.tenantId, input.runId)),

  listRuns: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.listRuns(ctx.user.tenantId, input.docVersionId),
    ),

  listFacts: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.listFacts(ctx.user.tenantId, input.docVersionId),
    ),

  listFindings: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.listFindings(ctx.user.tenantId, input.docVersionId),
    ),

  updateFindingStatus: p
    .input(
      z.object({
        findingId: z.string().uuid(),
        status: z.enum(["pending", "confirmed", "rejected", "resolved", "false_positive"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      processingService.updateFindingStatus(ctx.user.tenantId, input.findingId, input.status),
    ),

  listFactsByStudy: p
    .input(z.object({ studyId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.listFactsByStudy(ctx.user.tenantId, input.studyId),
    ),

  listFindingsByStudy: p
    .input(z.object({ studyId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.listFindingsByStudy(ctx.user.tenantId, input.studyId),
    ),

  getFactRegistry: p.query(() => processingService.getFactRegistry()),

  updateFactStatus: p
    .input(
      z.object({
        factId: z.string().uuid(),
        status: z.enum(["extracted", "verified", "validated", "deferred", "not_found", "rejected"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      processingService.updateFactStatus(ctx.user.tenantId, input.factId, input.status),
    ),

  updateFactValue: p
    .input(z.object({ factId: z.string().uuid(), manualValue: z.string() }))
    .mutation(({ ctx, input }) =>
      processingService.updateFactValue(ctx.user.tenantId, input.factId, input.manualValue),
    ),

  validateAllFacts: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      processingService.validateAllFacts(ctx.user.tenantId, input.docVersionId),
    ),

  createManualFact: p
    .input(
      z.object({
        docVersionId: z.string().uuid(),
        factKey: z.string(),
        factCategory: z.string(),
        description: z.string(),
        value: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => processingService.createManualFact(ctx.user.tenantId, input)),

  getSoaData: p
    .input(z.object({ docVersionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      processingService.getSoaData(ctx.user.tenantId, input.docVersionId),
    ),

  updateSoaCell: p
    .input(z.object({ cellId: z.string().uuid(), manualValue: z.string() }))
    .mutation(({ ctx, input }) =>
      processingService.updateSoaCell(ctx.user.tenantId, input.cellId, input.manualValue),
    ),

  validateSoa: p
    .input(z.object({ soaTableId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      processingService.validateSoa(ctx.user.tenantId, input.soaTableId),
    ),

  addSoaVisit: p
    .input(
      z.object({
        soaTableId: z.string().uuid(),
        visitName: z.string().min(1),
        dayLabel: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      processingService.addSoaVisit(
        ctx.user.tenantId,
        input.soaTableId,
        input.visitName,
        input.dayLabel,
      ),
    ),

  addSoaProcedure: p
    .input(z.object({ soaTableId: z.string().uuid(), procedureName: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      processingService.addSoaProcedure(ctx.user.tenantId, input.soaTableId, input.procedureName),
    ),

  updateSectionStatus: p
    .input(
      z.object({
        sectionId: z.string().uuid(),
        status: z.enum(["validated", "not_validated", "requires_rework"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      processingService.updateSectionStatus(ctx.user.tenantId, input.sectionId, input.status),
    ),
});
