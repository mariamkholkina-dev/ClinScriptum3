import { prisma } from "@clinscriptum/db";
import { loadFactRegistry, FACT_CATEGORY_LABELS } from "../data/fact-registry.js";
import { DomainError } from "./errors.js";
import { requireTenantResource } from "./tenant-guard.js";

export const processingService = {
  async startRun(
    tenantId: string,
    input: {
      docVersionId: string;
      type: string;
      ruleSetVersionId?: string;
      bundleId?: string;
    },
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: input.docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const run = await prisma.processingRun.create({
      data: {
        studyId: version.document.studyId,
        docVersionId: input.docVersionId,
        type: input.type as any,
        ruleSetVersionId: input.ruleSetVersionId ?? null,
        ruleSetBundleId: input.bundleId ?? null,
      },
    });
    return { runId: run.id, status: run.status };
  },

  async getRun(tenantId: string, runId: string) {
    const run = await prisma.processingRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: { startedAt: "asc" } }, study: true },
    });
    requireTenantResource(run, tenantId, (r) => r.study.tenantId);
    return run;
  },

  async listRuns(tenantId: string, docVersionId: string) {
    return prisma.processingRun.findMany({
      where: { docVersionId, study: { tenantId } },
      include: { steps: true },
      orderBy: { createdAt: "desc" },
    });
  },

  async listFacts(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    return prisma.fact.findMany({
      where: { docVersionId },
      orderBy: { factKey: "asc" },
    });
  },

  async listFindings(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    return prisma.finding.findMany({
      where: { docVersionId },
      orderBy: { createdAt: "desc" },
    });
  },

  async updateFindingStatus(
    tenantId: string,
    findingId: string,
    status: string,
  ) {
    const finding = await prisma.finding.findUnique({
      where: { id: findingId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(finding, tenantId, (f) => f.docVersion.document.study.tenantId);

    return prisma.finding.update({
      where: { id: findingId },
      data: { status: status as any },
    });
  },

  async listFactsByStudy(tenantId: string, studyId: string) {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
    });
    requireTenantResource(study, tenantId);

    return prisma.fact.findMany({
      where: { docVersion: { document: { studyId } } },
      include: {
        docVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { factKey: "asc" },
    });
  },

  async listFindingsByStudy(tenantId: string, studyId: string) {
    const study = await prisma.study.findFirst({
      where: { id: studyId, tenantId },
    });
    requireTenantResource(study, tenantId);

    return prisma.finding.findMany({
      where: { docVersion: { document: { studyId } } },
      include: {
        docVersion: {
          select: {
            id: true,
            versionLabel: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  },

  getFactRegistry() {
    const registry = loadFactRegistry();
    return { entries: registry, categoryLabels: FACT_CATEGORY_LABELS };
  },

  async updateFactStatus(tenantId: string, factId: string, status: string) {
    const fact = await prisma.fact.findUnique({
      where: { id: factId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(fact, tenantId, (f) => f.docVersion.document.study.tenantId);

    return prisma.fact.update({
      where: { id: factId },
      data: { status: status as any },
    });
  },

  async updateFactValue(tenantId: string, factId: string, manualValue: string) {
    const fact = await prisma.fact.findUnique({
      where: { id: factId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(fact, tenantId, (f) => f.docVersion.document.study.tenantId);

    return prisma.fact.update({
      where: { id: factId },
      data: {
        manualValue,
        status: fact.status === "not_found" ? "extracted" : fact.status,
      },
    });
  },

  async validateAllFacts(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    await prisma.fact.updateMany({
      where: {
        docVersionId,
        status: { notIn: ["not_found", "rejected"] },
      },
      data: { status: "validated" },
    });
    return { success: true };
  },

  async createManualFact(
    tenantId: string,
    input: {
      docVersionId: string;
      factKey: string;
      factCategory: string;
      description: string;
      value: string;
    },
  ) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: input.docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    return prisma.fact.create({
      data: {
        docVersionId: input.docVersionId,
        factKey: input.factKey,
        factCategory: input.factCategory,
        description: input.description,
        value: input.value,
        manualValue: input.value,
        confidence: 1.0,
        factClass: input.factCategory === "bioequivalence" ? "phase_specific" : "general",
        sources: [],
        hasContradiction: false,
        status: "extracted",
      },
    });
  },

  async getSoaData(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId },
      include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      tables.map(async (table) => {
        let sourceHtml: string | null = null;
        if (table.sourceBlockId) {
          const block = await prisma.contentBlock.findUnique({
            where: { id: table.sourceBlockId },
            select: { rawHtml: true },
          });
          sourceHtml = block?.rawHtml ?? null;
        }
        return { ...table, sourceHtml };
      }),
    );
  },

  async updateSoaCell(tenantId: string, cellId: string, manualValue: string) {
    const cell = await prisma.soaCell.findUnique({
      where: { id: cellId },
      include: {
        soaTable: {
          include: { docVersion: { include: { document: { include: { study: true } } } } },
        },
      },
    });
    requireTenantResource(cell, tenantId, (c) => c.soaTable.docVersion.document.study.tenantId);

    return prisma.soaCell.update({
      where: { id: cellId },
      data: { manualValue },
    });
  },

  async validateSoa(tenantId: string, soaTableId: string) {
    const table = await prisma.soaTable.findUnique({
      where: { id: soaTableId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    return prisma.soaTable.update({
      where: { id: soaTableId },
      data: { status: "validated" },
    });
  },

  async addSoaVisit(
    tenantId: string,
    soaTableId: string,
    visitName: string,
    _dayLabel?: string,
  ) {
    const table = await prisma.soaTable.findUnique({
      where: { id: soaTableId },
      include: {
        docVersion: { include: { document: { include: { study: true } } } },
        cells: true,
      },
    });
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    const headerData = table.headerData as { visits: string[] };
    const newColIndex = headerData.visits.length;
    headerData.visits.push(visitName);

    const maxRow =
      table.cells.length > 0 ? Math.max(...table.cells.map((c) => c.rowIndex)) : -1;

    await prisma.$transaction(async (tx) => {
      await tx.soaTable.update({
        where: { id: soaTableId },
        data: { headerData },
      });

      for (let row = 0; row <= maxRow; row++) {
        const existingCell = table.cells.find((c) => c.rowIndex === row);
        if (!existingCell) continue;
        await tx.soaCell.create({
          data: {
            soaTableId,
            rowIndex: row,
            colIndex: newColIndex,
            procedureName: existingCell.procedureName,
            visitName,
            rawValue: "",
            normalizedValue: "",
            confidence: 1.0,
          },
        });
      }
    });

    return { success: true };
  },

  async addSoaProcedure(tenantId: string, soaTableId: string, procedureName: string) {
    const table = await prisma.soaTable.findUnique({
      where: { id: soaTableId },
      include: {
        docVersion: { include: { document: { include: { study: true } } } },
        cells: true,
      },
    });
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    const headerData = table.headerData as { visits: string[] };
    const newRowIndex =
      table.cells.length > 0 ? Math.max(...table.cells.map((c) => c.rowIndex)) + 1 : 0;

    await prisma.$transaction(async (tx) => {
      for (let col = 0; col < headerData.visits.length; col++) {
        await tx.soaCell.create({
          data: {
            soaTableId,
            rowIndex: newRowIndex,
            colIndex: col,
            procedureName,
            visitName: headerData.visits[col],
            rawValue: "",
            normalizedValue: "",
            confidence: 1.0,
          },
        });
      }
    });

    return { success: true };
  },

  async updateSectionStructureStatus(
    tenantId: string,
    sectionId: string,
    status: "validated" | "not_validated" | "requires_rework",
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    return prisma.section.update({
      where: { id: sectionId },
      data: { structureStatus: status },
    });
  },

  async updateSectionClassificationStatus(
    tenantId: string,
    sectionId: string,
    status: "validated" | "not_validated" | "requires_rework",
  ) {
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(section, tenantId, (s) => s.docVersion.document.study.tenantId);

    return prisma.section.update({
      where: { id: sectionId },
      data: { classificationStatus: status },
    });
  },

  async bulkUpdateSectionStructureStatus(
    tenantId: string,
    sectionIds: string[],
    status: "validated" | "not_validated" | "requires_rework",
    structureComment?: string,
  ) {
    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds } },
      select: {
        id: true,
        docVersion: { select: { document: { select: { study: { select: { tenantId: true } } } } } },
      },
    });
    const allowed = sections
      .filter((s) => s.docVersion.document.study.tenantId === tenantId)
      .map((s) => s.id);

    if (allowed.length === 0) {
      return { updated: 0 };
    }

    const data: Record<string, unknown> = { structureStatus: status };
    if (structureComment !== undefined) {
      data.structureComment = structureComment;
    }

    const result = await prisma.section.updateMany({
      where: { id: { in: allowed } },
      data,
    });
    return { updated: result.count };
  },

  async bulkUpdateSectionClassificationStatus(
    tenantId: string,
    sectionIds: string[],
    status: "validated" | "not_validated" | "requires_rework",
    classificationComment?: string,
  ) {
    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds } },
      select: {
        id: true,
        docVersion: { select: { document: { select: { study: { select: { tenantId: true } } } } } },
      },
    });
    const allowed = sections
      .filter((s) => s.docVersion.document.study.tenantId === tenantId)
      .map((s) => s.id);

    if (allowed.length === 0) {
      return { updated: 0 };
    }

    const data: Record<string, unknown> = { classificationStatus: status };
    if (classificationComment !== undefined) {
      data.classificationComment = classificationComment;
    }

    const result = await prisma.section.updateMany({
      where: { id: { in: allowed } },
      data,
    });
    return { updated: result.count };
  },
};
