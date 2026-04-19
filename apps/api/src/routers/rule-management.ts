import { z } from "zod";
import { router, qualityProcedure } from "../trpc/trpc.js";
import { withDomainErrors } from "../trpc/error-mapper.js";
import { ruleManagementService } from "../services/rule-management.service.js";

const p = qualityProcedure.use(withDomainErrors);

const ruleSetTypeEnum = z.enum([
  "section_classification",
  "section_classification_qa",
  "fact_extraction",
  "fact_extraction_qa",
  "soa_detection",
  "soa_detection_qa",
  "intra_audit",
  "intra_audit_qa",
  "inter_audit",
  "inter_audit_qa",
  "fact_audit_intra",
  "fact_audit_intra_qa",
  "fact_audit_inter",
  "fact_audit_inter_qa",
  "generation",
  "generation_qa",
  "impact_analysis",
  "impact_analysis_qa",
  "change_classification",
  "change_classification_qa",
  "correction_recommend",
  "soa_identification",
  "audit",
]);

const documentTypeEnum = z.enum(["protocol", "icf", "ib", "csr"]);
const ruleSubStageEnum = z.enum(["analysis", "qa"]);

const ruleInputSchema = z.object({
  name: z.string(),
  pattern: z.string(),
  config: z.record(z.unknown()).default({}),
  documentType: documentTypeEnum.optional(),
  stage: z.string().optional(),
  subStage: ruleSubStageEnum.optional(),
  promptTemplate: z.string().optional(),
  isEnabled: z.boolean().optional(),
  requiresFacts: z.boolean().optional(),
  requiresSoa: z.boolean().optional(),
  order: z.number().int().optional(),
});

const exportedVersionSchema = z.object({
  version: z.number().int(),
  rules: z.array(ruleInputSchema),
  exportedAt: z.string(),
  ruleSetId: z.string().uuid(),
  ruleSetName: z.string().optional(),
});

export const ruleManagementRouter = router({
  /* ═══════════════ Rule Sets ═══════════════ */

  listRuleSets: p
    .input(z.object({ type: ruleSetTypeEnum.optional() }))
    .query(({ ctx, input }) =>
      ruleManagementService.listRuleSets(ctx.user.tenantId, input.type),
    ),

  getRuleSet: p
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) =>
      ruleManagementService.getRuleSet(input.id),
    ),

  createRuleSet: p
    .input(z.object({ name: z.string(), type: ruleSetTypeEnum }))
    .mutation(({ ctx, input }) =>
      ruleManagementService.createRuleSet({
        tenantId: ctx.user.tenantId,
        name: input.name,
        type: input.type,
      }),
    ),

  /* ═══════════════ Versions ═══════════════ */

  getActiveVersion: p
    .input(z.object({ ruleSetId: z.string().uuid() }))
    .query(({ input }) =>
      ruleManagementService.getActiveVersion(input.ruleSetId),
    ),

  createVersion: p
    .input(
      z.object({
        ruleSetId: z.string().uuid(),
        rules: z.array(ruleInputSchema),
        description: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      ruleManagementService.createVersion(input.ruleSetId, input.rules, input.description),
    ),

  updateVersionDescription: p
    .input(
      z.object({
        versionId: z.string().uuid(),
        description: z.string(),
      }),
    )
    .mutation(({ input }) =>
      ruleManagementService.updateVersionDescription(input.versionId, input.description),
    ),

  activateVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .mutation(({ input }) =>
      ruleManagementService.activateVersion(input.versionId),
    ),

  rollbackVersion: p
    .input(z.object({ ruleSetId: z.string().uuid() }))
    .mutation(({ input }) =>
      ruleManagementService.rollbackVersion(input.ruleSetId),
    ),

  getVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .query(({ input }) =>
      ruleManagementService.getVersion(input.versionId),
    ),

  getVersionHistory: p
    .input(z.object({ ruleSetId: z.string().uuid() }))
    .query(({ input }) =>
      ruleManagementService.getVersionHistory(input.ruleSetId),
    ),

  diffVersions: p
    .input(
      z.object({
        versionId1: z.string().uuid(),
        versionId2: z.string().uuid(),
      }),
    )
    .query(({ input }) =>
      ruleManagementService.diffVersions(input.versionId1, input.versionId2),
    ),

  exportVersion: p
    .input(z.object({ versionId: z.string().uuid() }))
    .query(({ input }) =>
      ruleManagementService.exportVersion(input.versionId),
    ),

  importVersion: p
    .input(
      z.object({
        ruleSetId: z.string().uuid(),
        data: exportedVersionSchema,
      }),
    )
    .mutation(({ input }) =>
      ruleManagementService.importVersion(input.ruleSetId, input.data),
    ),

  /* ═══════════════ Individual Rules ═══════════════ */

  addRule: p
    .input(
      z.object({
        versionId: z.string().uuid(),
        data: ruleInputSchema,
      }),
    )
    .mutation(({ input }) =>
      ruleManagementService.addRule(input.versionId, input.data),
    ),

  updateRule: p
    .input(
      z.object({
        ruleId: z.string().uuid(),
        data: ruleInputSchema.partial(),
      }),
    )
    .mutation(({ input }) =>
      ruleManagementService.updateRule(input.ruleId, input.data),
    ),

  deleteRule: p
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(({ input }) =>
      ruleManagementService.deleteRule(input.ruleId),
    ),
});
