import { prisma } from "@clinscriptum/db";
import { DomainError } from "./errors.js";
import { logger } from "../lib/logger.js";

class BundleService {
  async listBundles(tenantId: string) {
    return prisma.ruleSetBundle.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      include: {
        entries: {
          include: {
            ruleSetVersion: {
              include: {
                ruleSet: { select: { id: true, name: true, type: true } },
                _count: { select: { rules: true } },
              },
            },
          },
        },
        _count: { select: { processingRuns: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async getBundle(bundleId: string) {
    const bundle = await prisma.ruleSetBundle.findUnique({
      where: { id: bundleId },
      include: {
        entries: {
          include: {
            ruleSetVersion: {
              include: {
                ruleSet: { select: { id: true, name: true, type: true } },
                rules: { where: { isEnabled: true }, orderBy: { order: "asc" } },
              },
            },
          },
        },
      },
    });
    if (!bundle) throw new DomainError("NOT_FOUND", "Bundle not found");
    return bundle;
  }

  async getActiveBundle(tenantId: string) {
    return prisma.ruleSetBundle.findFirst({
      where: { isActive: true, OR: [{ tenantId }, { tenantId: null }] },
      include: {
        entries: {
          include: {
            ruleSetVersion: {
              include: {
                ruleSet: { select: { id: true, name: true, type: true } },
              },
            },
          },
        },
      },
      orderBy: { tenantId: "desc" },
    });
  }

  async createBundle(tenantId: string | null, name: string, description?: string) {
    const bundle = await prisma.ruleSetBundle.create({
      data: { tenantId, name, description },
    });
    logger.info("Bundle created", { bundleId: bundle.id, name });
    return bundle;
  }

  async addEntry(bundleId: string, ruleSetVersionId: string) {
    const bundle = await prisma.ruleSetBundle.findUnique({
      where: { id: bundleId },
      include: {
        entries: {
          include: {
            ruleSetVersion: {
              include: { ruleSet: { select: { type: true } } },
            },
          },
        },
      },
    });
    if (!bundle) throw new DomainError("NOT_FOUND", "Bundle not found");

    const newVersion = await prisma.ruleSetVersion.findUnique({
      where: { id: ruleSetVersionId },
      include: { ruleSet: { select: { type: true } } },
    });
    if (!newVersion) throw new DomainError("NOT_FOUND", "RuleSetVersion not found");

    const duplicate = bundle.entries.find(
      (e) => e.ruleSetVersion.ruleSet.type === newVersion.ruleSet.type,
    );
    if (duplicate) {
      throw new DomainError(
        "CONFLICT",
        `Bundle already has an entry for type "${newVersion.ruleSet.type}". Remove it first.`,
      );
    }

    return prisma.ruleSetBundleEntry.create({
      data: { bundleId, ruleSetVersionId },
    });
  }

  async removeEntry(bundleId: string, entryId: string) {
    const entry = await prisma.ruleSetBundleEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.bundleId !== bundleId) {
      throw new DomainError("NOT_FOUND", "Entry not found in this bundle");
    }
    await prisma.ruleSetBundleEntry.delete({ where: { id: entryId } });
  }

  async activateBundle(bundleId: string, tenantId: string | null) {
    const bundle = await prisma.ruleSetBundle.findUnique({ where: { id: bundleId } });
    if (!bundle) throw new DomainError("NOT_FOUND", "Bundle not found");

    await prisma.$transaction([
      prisma.ruleSetBundle.updateMany({
        where: {
          isActive: true,
          OR: tenantId ? [{ tenantId }] : [{ tenantId: null }],
        },
        data: { isActive: false },
      }),
      prisma.ruleSetBundle.update({
        where: { id: bundleId },
        data: { isActive: true },
      }),
    ]);

    logger.info("Bundle activated", { bundleId, tenantId });
    return prisma.ruleSetBundle.findUnique({ where: { id: bundleId } });
  }

  async deactivateBundle(bundleId: string) {
    await prisma.ruleSetBundle.update({
      where: { id: bundleId },
      data: { isActive: false },
    });
  }

  async cloneBundle(bundleId: string, newName: string) {
    const source = await prisma.ruleSetBundle.findUnique({
      where: { id: bundleId },
      include: { entries: true },
    });
    if (!source) throw new DomainError("NOT_FOUND", "Bundle not found");

    const clone = await prisma.$transaction(async (tx) => {
      const b = await tx.ruleSetBundle.create({
        data: {
          tenantId: source.tenantId,
          name: newName,
          description: `Cloned from "${source.name}"`,
        },
      });
      if (source.entries.length > 0) {
        await tx.ruleSetBundleEntry.createMany({
          data: source.entries.map((e) => ({
            bundleId: b.id,
            ruleSetVersionId: e.ruleSetVersionId,
          })),
        });
      }
      return b;
    });

    logger.info("Bundle cloned", { sourceId: bundleId, cloneId: clone.id });
    return clone;
  }

  async deleteBundle(bundleId: string) {
    const refCount = await prisma.processingRun.count({
      where: { ruleSetBundleId: bundleId },
    });
    if (refCount > 0) {
      throw new DomainError(
        "CONFLICT",
        `Bundle is referenced by ${refCount} processing run(s) and cannot be deleted`,
      );
    }
    await prisma.ruleSetBundle.delete({ where: { id: bundleId } });
    logger.info("Bundle deleted", { bundleId });
  }
}

export const bundleService = new BundleService();
