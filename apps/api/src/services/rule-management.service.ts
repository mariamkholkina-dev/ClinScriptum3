import { prisma } from "@clinscriptum/db";
import type { RuleSetType, DocumentType, RuleSubStage } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

/* ═══════════════ Types ═══════════════ */

export interface RuleInput {
  name: string;
  pattern: string;
  config: any;
  documentType?: DocumentType;
  stage?: string;
  subStage?: RuleSubStage;
  promptTemplate?: string;
  isEnabled?: boolean;
  requiresFacts?: boolean;
  requiresSoa?: boolean;
  order?: number;
}

export interface ExportedVersion {
  version: number;
  rules: RuleInput[];
  exportedAt: string;
  ruleSetId: string;
  ruleSetName?: string;
}

/* ═══════════════ Service ═══════════════ */

class RuleManagementService {
  async listRuleSets(tenantId: string, type?: RuleSetType) {
    const where: { tenantId?: string | null; type?: RuleSetType } = {};
    where.tenantId = tenantId;
    if (type) where.type = type;

    return prisma.ruleSet.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }], ...(type ? { type } : {}) },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
          include: { _count: { select: { rules: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getRuleSet(id: string) {
    const ruleSet = await prisma.ruleSet.findUnique({
      where: { id },
      include: {
        versions: {
          where: { isActive: true },
          take: 1,
          include: { rules: { orderBy: { order: "asc" } } },
        },
      },
    });

    if (!ruleSet) {
      throw new DomainError("NOT_FOUND", "Rule set not found");
    }

    return ruleSet;
  }

  async getActiveVersion(ruleSetId: string) {
    const version = await prisma.ruleSetVersion.findFirst({
      where: { ruleSetId, isActive: true },
      include: { rules: { orderBy: { order: "asc" } } },
    });

    if (!version) {
      throw new DomainError("NOT_FOUND", "No active version found for this rule set");
    }

    return version;
  }

  async createRuleSet(data: { tenantId?: string; name: string; type: RuleSetType }) {
    const ruleSet = await prisma.ruleSet.create({
      data: {
        tenantId: data.tenantId ?? null,
        name: data.name,
        type: data.type,
      },
    });

    logger.info("Rule set created", { ruleSetId: ruleSet.id, type: data.type });
    return ruleSet;
  }

  async createVersion(ruleSetId: string, rules: RuleInput[]) {
    const ruleSet = await prisma.ruleSet.findUnique({ where: { id: ruleSetId } });
    if (!ruleSet) {
      throw new DomainError("NOT_FOUND", "Rule set not found");
    }

    const latestVersion = await prisma.ruleSetVersion.findFirst({
      where: { ruleSetId },
      orderBy: { version: "desc" },
    });

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.ruleSetVersion.create({
        data: {
          ruleSetId,
          version: nextVersion,
          isActive: false,
        },
      });

      if (rules.length > 0) {
        await tx.rule.createMany({
          data: rules.map((r, idx) => ({
            ruleSetVersionId: v.id,
            name: r.name,
            pattern: r.pattern,
            config: r.config ?? {},
            documentType: r.documentType ?? null,
            stage: r.stage ?? null,
            subStage: r.subStage ?? null,
            promptTemplate: r.promptTemplate ?? null,
            isEnabled: r.isEnabled ?? true,
            requiresFacts: r.requiresFacts ?? false,
            requiresSoa: r.requiresSoa ?? false,
            order: r.order ?? idx,
          })),
        });
      }

      return tx.ruleSetVersion.findUnique({
        where: { id: v.id },
        include: { rules: { orderBy: { order: "asc" } } },
      });
    });

    logger.info("Rule set version created", { ruleSetId, version: nextVersion });
    return version!;
  }

  async activateVersion(versionId: string) {
    const version = await prisma.ruleSetVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw new DomainError("NOT_FOUND", "Version not found");
    }

    await prisma.$transaction([
      prisma.ruleSetVersion.updateMany({
        where: { ruleSetId: version.ruleSetId, isActive: true },
        data: { isActive: false },
      }),
      prisma.ruleSetVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      }),
    ]);

    logger.info("Rule set version activated", { versionId, ruleSetId: version.ruleSetId });

    return prisma.ruleSetVersion.findUnique({
      where: { id: versionId },
      include: { rules: { orderBy: { order: "asc" } } },
    });
  }

  async rollbackVersion(ruleSetId: string) {
    const activeVersion = await prisma.ruleSetVersion.findFirst({
      where: { ruleSetId, isActive: true },
    });

    if (!activeVersion) {
      throw new DomainError("NOT_FOUND", "No active version to rollback from");
    }

    const previousVersion = await prisma.ruleSetVersion.findFirst({
      where: {
        ruleSetId,
        version: { lt: activeVersion.version },
      },
      orderBy: { version: "desc" },
    });

    if (!previousVersion) {
      throw new DomainError("BAD_REQUEST", "No previous version available for rollback");
    }

    await prisma.$transaction([
      prisma.ruleSetVersion.update({
        where: { id: activeVersion.id },
        data: { isActive: false },
      }),
      prisma.ruleSetVersion.update({
        where: { id: previousVersion.id },
        data: { isActive: true },
      }),
    ]);

    logger.info("Rule set version rolled back", {
      ruleSetId,
      fromVersion: activeVersion.version,
      toVersion: previousVersion.version,
    });

    return prisma.ruleSetVersion.findUnique({
      where: { id: previousVersion.id },
      include: { rules: { orderBy: { order: "asc" } } },
    });
  }

  async updateRule(ruleId: string, data: Partial<RuleInput>) {
    const rule = await prisma.rule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new DomainError("NOT_FOUND", "Rule not found");
    }

    return prisma.rule.update({
      where: { id: ruleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.pattern !== undefined && { pattern: data.pattern }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.documentType !== undefined && { documentType: data.documentType }),
        ...(data.stage !== undefined && { stage: data.stage }),
        ...(data.subStage !== undefined && { subStage: data.subStage }),
        ...(data.promptTemplate !== undefined && { promptTemplate: data.promptTemplate }),
        ...(data.isEnabled !== undefined && { isEnabled: data.isEnabled }),
        ...(data.requiresFacts !== undefined && { requiresFacts: data.requiresFacts }),
        ...(data.requiresSoa !== undefined && { requiresSoa: data.requiresSoa }),
        ...(data.order !== undefined && { order: data.order }),
      },
    });
  }

  async deleteRule(ruleId: string) {
    const rule = await prisma.rule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new DomainError("NOT_FOUND", "Rule not found");
    }

    await prisma.rule.delete({ where: { id: ruleId } });
    logger.info("Rule deleted", { ruleId });
  }

  async getVersionHistory(ruleSetId: string) {
    const ruleSet = await prisma.ruleSet.findUnique({ where: { id: ruleSetId } });
    if (!ruleSet) {
      throw new DomainError("NOT_FOUND", "Rule set not found");
    }

    return prisma.ruleSetVersion.findMany({
      where: { ruleSetId },
      include: { _count: { select: { rules: true } } },
      orderBy: { version: "desc" },
    });
  }

  async diffVersions(versionId1: string, versionId2: string) {
    const [v1, v2] = await Promise.all([
      prisma.ruleSetVersion.findUnique({
        where: { id: versionId1 },
        include: { rules: { orderBy: { order: "asc" } } },
      }),
      prisma.ruleSetVersion.findUnique({
        where: { id: versionId2 },
        include: { rules: { orderBy: { order: "asc" } } },
      }),
    ]);

    if (!v1) throw new DomainError("NOT_FOUND", "Version 1 not found");
    if (!v2) throw new DomainError("NOT_FOUND", "Version 2 not found");

    const v1RulesByName = new Map(v1.rules.map((r) => [r.name, r]));
    const v2RulesByName = new Map(v2.rules.map((r) => [r.name, r]));

    const added: typeof v2.rules = [];
    const removed: typeof v1.rules = [];
    const modified: Array<{ name: string; before: (typeof v1.rules)[0]; after: (typeof v2.rules)[0] }> = [];

    for (const [name, rule] of v2RulesByName) {
      const oldRule = v1RulesByName.get(name);
      if (!oldRule) {
        added.push(rule);
      } else if (
        oldRule.pattern !== rule.pattern ||
        JSON.stringify(oldRule.config) !== JSON.stringify(rule.config) ||
        oldRule.documentType !== rule.documentType ||
        oldRule.stage !== rule.stage ||
        oldRule.subStage !== rule.subStage ||
        oldRule.promptTemplate !== rule.promptTemplate ||
        oldRule.isEnabled !== rule.isEnabled ||
        oldRule.requiresFacts !== rule.requiresFacts ||
        oldRule.requiresSoa !== rule.requiresSoa ||
        oldRule.order !== rule.order
      ) {
        modified.push({ name, before: oldRule, after: rule });
      }
    }

    for (const [name, rule] of v1RulesByName) {
      if (!v2RulesByName.has(name)) {
        removed.push(rule);
      }
    }

    return {
      version1: { id: v1.id, version: v1.version },
      version2: { id: v2.id, version: v2.version },
      added,
      removed,
      modified,
      summary: {
        addedCount: added.length,
        removedCount: removed.length,
        modifiedCount: modified.length,
      },
    };
  }

  async exportVersion(versionId: string) {
    const version = await prisma.ruleSetVersion.findUnique({
      where: { id: versionId },
      include: {
        rules: { orderBy: { order: "asc" } },
        ruleSet: { select: { id: true, name: true } },
      },
    });

    if (!version) {
      throw new DomainError("NOT_FOUND", "Version not found");
    }

    const exported: ExportedVersion = {
      version: version.version,
      ruleSetId: version.ruleSet.id,
      ruleSetName: version.ruleSet.name,
      exportedAt: new Date().toISOString(),
      rules: version.rules.map((r) => ({
        name: r.name,
        pattern: r.pattern,
        config: r.config,
        documentType: r.documentType ?? undefined,
        stage: r.stage ?? undefined,
        subStage: r.subStage ?? undefined,
        promptTemplate: r.promptTemplate ?? undefined,
        isEnabled: r.isEnabled,
        requiresFacts: r.requiresFacts,
        requiresSoa: r.requiresSoa,
        order: r.order,
      })),
    };

    return exported;
  }

  async importVersion(ruleSetId: string, data: ExportedVersion) {
    const ruleSet = await prisma.ruleSet.findUnique({ where: { id: ruleSetId } });
    if (!ruleSet) {
      throw new DomainError("NOT_FOUND", "Rule set not found");
    }

    const version = await this.createVersion(ruleSetId, data.rules);

    logger.info("Rule set version imported", {
      ruleSetId,
      importedVersion: data.version,
      newVersion: version.version,
      rulesCount: data.rules.length,
    });

    return version;
  }
}

export const ruleManagementService = new RuleManagementService();
