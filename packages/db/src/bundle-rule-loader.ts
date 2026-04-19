import { PrismaClient } from "@prisma/client";
import type { RuleSetType } from "@prisma/client";

const prisma = new PrismaClient();

export interface ResolvedRuleSet {
  ruleSetVersionId: string;
  ruleSetId: string;
  ruleSetName: string;
  ruleSetType: RuleSetType;
  rules: Array<{
    id: string;
    name: string;
    pattern: string;
    config: unknown;
    documentType: string | null;
    stage: string | null;
    subStage: string | null;
    promptTemplate: string | null;
    isEnabled: boolean;
    requiresFacts: boolean;
    requiresSoa: boolean;
    order: number;
  }>;
}

export async function loadBundleRules(
  bundleId: string,
): Promise<Map<RuleSetType, ResolvedRuleSet>> {
  const entries = await prisma.ruleSetBundleEntry.findMany({
    where: { bundleId },
    include: {
      ruleSetVersion: {
        include: {
          rules: { where: { isEnabled: true }, orderBy: { order: "asc" } },
          ruleSet: { select: { id: true, name: true, type: true } },
        },
      },
    },
  });

  const result = new Map<RuleSetType, ResolvedRuleSet>();
  for (const entry of entries) {
    const v = entry.ruleSetVersion;
    result.set(v.ruleSet.type, {
      ruleSetVersionId: v.id,
      ruleSetId: v.ruleSet.id,
      ruleSetName: v.ruleSet.name,
      ruleSetType: v.ruleSet.type,
      rules: v.rules.map((r) => ({
        id: r.id,
        name: r.name,
        pattern: r.pattern,
        config: r.config,
        documentType: r.documentType,
        stage: r.stage,
        subStage: r.subStage,
        promptTemplate: r.promptTemplate,
        isEnabled: r.isEnabled,
        requiresFacts: r.requiresFacts,
        requiresSoa: r.requiresSoa,
        order: r.order,
      })),
    });
  }
  return result;
}

export async function loadRulesForType(
  bundleId: string | null,
  type: RuleSetType,
): Promise<ResolvedRuleSet | null> {
  if (bundleId) {
    const entry = await prisma.ruleSetBundleEntry.findFirst({
      where: {
        bundleId,
        ruleSetVersion: { ruleSet: { type } },
      },
      include: {
        ruleSetVersion: {
          include: {
            rules: { where: { isEnabled: true }, orderBy: { order: "asc" } },
            ruleSet: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });
    if (entry) {
      const v = entry.ruleSetVersion;
      return {
        ruleSetVersionId: v.id,
        ruleSetId: v.ruleSet.id,
        ruleSetName: v.ruleSet.name,
        ruleSetType: v.ruleSet.type,
        rules: v.rules.map((r) => ({
          id: r.id,
          name: r.name,
          pattern: r.pattern,
          config: r.config,
          documentType: r.documentType,
          stage: r.stage,
          subStage: r.subStage,
          promptTemplate: r.promptTemplate,
          isEnabled: r.isEnabled,
          requiresFacts: r.requiresFacts,
          requiresSoa: r.requiresSoa,
          order: r.order,
        })),
      };
    }
  }

  const activeVersion = await prisma.ruleSetVersion.findFirst({
    where: {
      isActive: true,
      ruleSet: { type, tenantId: null },
    },
    include: {
      rules: { where: { isEnabled: true }, orderBy: { order: "asc" } },
      ruleSet: { select: { id: true, name: true, type: true } },
    },
  });

  if (!activeVersion) return null;

  return {
    ruleSetVersionId: activeVersion.id,
    ruleSetId: activeVersion.ruleSet.id,
    ruleSetName: activeVersion.ruleSet.name,
    ruleSetType: activeVersion.ruleSet.type,
    rules: activeVersion.rules.map((r) => ({
      id: r.id,
      name: r.name,
      pattern: r.pattern,
      config: r.config,
      documentType: r.documentType,
      stage: r.stage,
      subStage: r.subStage,
      promptTemplate: r.promptTemplate,
      isEnabled: r.isEnabled,
      requiresFacts: r.requiresFacts,
      requiresSoa: r.requiresSoa,
      order: r.order,
    })),
  };
}

export async function resolveActiveBundle(
  tenantId: string | null,
): Promise<string | null> {
  const bundle = await prisma.ruleSetBundle.findFirst({
    where: {
      isActive: true,
      OR: tenantId ? [{ tenantId }, { tenantId: null }] : [{ tenantId: null }],
    },
    orderBy: { tenantId: "desc" },
    select: { id: true },
  });
  return bundle?.id ?? null;
}

export function snapshotRules(
  rules: ResolvedRuleSet["rules"] | undefined,
  meta?: { ruleSetVersionId?: string; ruleSetType?: string },
): Record<string, unknown> {
  if (!rules) return { source: "defaults" };
  return {
    source: "bundle",
    ruleSetVersionId: meta?.ruleSetVersionId,
    ruleSetType: meta?.ruleSetType,
    snapshotAt: new Date().toISOString(),
    rules: rules.map((r) => ({
      name: r.name,
      pattern: r.pattern,
      config: r.config,
      documentType: r.documentType,
      promptTemplate: r.promptTemplate ? r.promptTemplate.slice(0, 200) + "..." : null,
      order: r.order,
    })),
  };
}
