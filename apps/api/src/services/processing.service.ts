import { prisma, resolveActiveBundle } from "@clinscriptum/db";
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

    const bundleId = input.bundleId
      ?? await resolveActiveBundle(tenantId);

    const run = await prisma.processingRun.create({
      data: {
        studyId: version.document.studyId,
        docVersionId: input.docVersionId,
        type: input.type as any,
        ruleSetVersionId: input.ruleSetVersionId ?? null,
        ruleSetBundleId: bundleId,
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

  async listAllRuns(tenantId: string, opts: { limit: number; cursor?: string; type?: string; status?: string }) {
    const where: Record<string, unknown> = { study: { tenantId } };
    if (opts.type) where.type = opts.type;
    if (opts.status) where.status = opts.status;
    if (opts.cursor) where.createdAt = { lt: (await prisma.processingRun.findUnique({ where: { id: opts.cursor }, select: { createdAt: true } }))?.createdAt };

    const runs = await prisma.processingRun.findMany({
      where,
      include: {
        steps: { orderBy: { startedAt: "asc" } },
        ruleSetBundle: { select: { id: true, name: true } },
        docVersion: {
          select: {
            id: true,
            versionNumber: true,
            document: { select: { id: true, title: true, type: true } },
          },
        },
        study: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: opts.limit + 1,
    });

    const hasMore = runs.length > opts.limit;
    if (hasMore) runs.pop();

    return {
      runs,
      nextCursor: hasMore ? runs[runs.length - 1]!.id : null,
    };
  },

  async listFacts(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const facts = await prisma.fact.findMany({
      where: { docVersionId },
      orderBy: { factKey: "asc" },
    });

    return facts.map((f) => ({
      ...f,
      sources: Array.isArray(f.sources)
        ? (f.sources as Record<string, unknown>[]).map((s) => ({
            sectionTitle: s.sectionTitle ?? "",
            text: s.text ?? s.textSnippet ?? "",
            isSynopsis: s.isSynopsis ?? false,
          }))
        : [],
      variants: Array.isArray(f.variants) ? f.variants : [],
    }));
  },

  async getFactExtractionSummary(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const latestRun = await prisma.processingRun.findFirst({
      where: { docVersionId, type: "fact_extraction" },
      orderBy: { createdAt: "desc" },
      include: { steps: { orderBy: { startedAt: "asc" } } },
    });

    let parseErrors = 0;
    let skippedSections = 0;
    let llmRetries = 0;
    let totalTokens = 0;
    let stepFailures = 0;

    if (latestRun) {
      for (const step of latestRun.steps) {
        if (step.status === "failed") stepFailures++;
        const result = step.result as Record<string, unknown> | null;
        if (!result) continue;
        const data = (result.data ?? result) as Record<string, unknown>;
        if (typeof data.parseErrors === "number") parseErrors += data.parseErrors;
        if (typeof data.skippedSections === "number") skippedSections += data.skippedSections;
        if (typeof data.retries === "number") llmRetries += data.retries;
        if (typeof data.totalTokens === "number") totalTokens += data.totalTokens;
      }
    }

    const facts = await prisma.fact.findMany({
      where: { docVersionId },
      select: { confidence: true, hasContradiction: true, status: true },
    });

    const totalFacts = facts.length;
    const lowConfidence = facts.filter((f) => f.confidence < 0.5).length;
    const midConfidence = facts.filter((f) => f.confidence >= 0.5 && f.confidence < 0.8).length;
    const highConfidence = facts.filter((f) => f.confidence >= 0.8).length;
    const validated = facts.filter((f) => f.status === "validated").length;
    const contradictions = facts.filter((f) => f.hasContradiction).length;

    return {
      run: latestRun
        ? {
            id: latestRun.id,
            status: latestRun.status,
            createdAt: latestRun.createdAt,
            attemptNumber: latestRun.attemptNumber,
            stepCount: latestRun.steps.length,
          }
        : null,
      facts: { total: totalFacts, lowConfidence, midConfidence, highConfidence, validated, contradictions },
      failures: { parseErrors, skippedSections, llmRetries, totalTokens, stepFailures },
    };
  },

  async listFactsGrouped(tenantId: string, docVersionId: string) {
    const version = await prisma.documentVersion.findUnique({
      where: { id: docVersionId },
      include: { document: { include: { study: true } } },
    });
    requireTenantResource(version, tenantId, (v) => v.document.study.tenantId);

    const facts = await prisma.fact.findMany({
      where: { docVersionId },
      orderBy: { factKey: "asc" },
    });

    const registry = loadFactRegistry();
    const registryMap = new Map(registry.map((r) => [r.factKey, r]));

    const grouped = new Map<string, typeof facts>();
    for (const f of facts) {
      const arr = grouped.get(f.factKey) ?? [];
      arr.push(f);
      grouped.set(f.factKey, arr);
    }

    const result: Array<{
      factKey: string;
      factCategory: string;
      description: string;
      valueType: string;
      deterministicValue: string | null;
      deterministicConfidence: number;
      llmValue: string | null;
      llmConfidence: number;
      qaValue: string | null;
      qaConfidence: number;
      finalValue: string | null;
      finalConfidence: number;
      manualValue: string | null;
      status: string;
      hasContradiction: boolean;
      isFromRegistry: boolean;
      factIds: string[];
      factClass: string;
      variants: unknown[];
      sources: Array<{ sectionTitle: string; text: string; isSynopsis: boolean }>;
    }> = [];

    const seenKeys = new Set<string>();

    for (const [factKey, rows] of grouped) {
      seenKeys.add(factKey);
      const primary = rows[0];
      const regEntry = registryMap.get(factKey);

      const allVariants: unknown[] = [];
      const allSources: Array<{ sectionTitle: string; text: string; isSynopsis: boolean }> = [];
      for (const r of rows) {
        if (Array.isArray(r.variants)) allVariants.push(...(r.variants as unknown[]));
        if (Array.isArray(r.sources)) {
          for (const s of r.sources as Record<string, unknown>[]) {
            allSources.push({
              sectionTitle: (s.sectionTitle ?? "") as string,
              text: (s.text ?? s.textSnippet ?? "") as string,
              isSynopsis: (s.isSynopsis ?? false) as boolean,
            });
          }
        }
      }

      const bestDeterministic = rows.reduce<{ val: string | null; conf: number }>((best, r) => {
        if (r.deterministicValue && r.deterministicConfidence > best.conf) return { val: r.deterministicValue, conf: r.deterministicConfidence };
        return best;
      }, { val: primary.deterministicValue, conf: primary.deterministicConfidence });

      const bestLlm = rows.reduce<{ val: string | null; conf: number }>((best, r) => {
        if (r.llmValue && r.llmConfidence > best.conf) return { val: r.llmValue, conf: r.llmConfidence };
        return best;
      }, { val: primary.llmValue, conf: primary.llmConfidence });

      const bestQa = rows.reduce<{ val: string | null; conf: number }>((best, r) => {
        if (r.qaValue && r.qaConfidence > best.conf) return { val: r.qaValue, conf: r.qaConfidence };
        return best;
      }, { val: primary.qaValue, conf: primary.qaConfidence });

      const manualVal = rows.find((r) => r.manualValue)?.manualValue ?? null;
      const finalValue = manualVal ?? bestQa.val ?? bestLlm.val ?? bestDeterministic.val ?? primary.value;
      const finalConf = manualVal ? 1.0
        : bestQa.val ? bestQa.conf
        : bestLlm.val ? bestLlm.conf
        : bestDeterministic.val ? bestDeterministic.conf
        : primary.confidence;

      result.push({
        factKey,
        factCategory: primary.factCategory,
        description: regEntry?.description ?? primary.description ?? "",
        valueType: regEntry?.valueType ?? "string",
        deterministicValue: bestDeterministic.val,
        deterministicConfidence: bestDeterministic.conf,
        llmValue: bestLlm.val,
        llmConfidence: bestLlm.conf,
        qaValue: bestQa.val,
        qaConfidence: bestQa.conf,
        finalValue,
        finalConfidence: finalConf,
        manualValue: manualVal,
        status: primary.status,
        hasContradiction: rows.some((r) => r.hasContradiction),
        isFromRegistry: !!regEntry,
        factIds: rows.map((r) => r.id),
        factClass: primary.factClass,
        variants: allVariants,
        sources: allSources,
      });
    }

    for (const reg of registry) {
      if (seenKeys.has(reg.factKey)) continue;
      result.push({
        factKey: reg.factKey,
        factCategory: reg.category,
        description: reg.description,
        valueType: reg.valueType,
        deterministicValue: null,
        deterministicConfidence: 0,
        llmValue: null,
        llmConfidence: 0,
        qaValue: null,
        qaConfidence: 0,
        finalValue: null,
        finalConfidence: 0,
        manualValue: null,
        status: "not_found",
        hasContradiction: false,
        isFromRegistry: true,
        factIds: [],
        factClass: "general",
        variants: [],
        sources: [],
      });
    }

    return result;
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

  async bulkUpdateFactStatus(tenantId: string, factIds: string[], status: string) {
    if (factIds.length === 0) return { count: 0 };

    const result = await prisma.fact.updateMany({
      where: {
        id: { in: factIds },
        docVersion: { document: { study: { tenantId } } },
      },
      data: { status: status as any },
    });
    return { count: result.count };
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

  async listSoaTablesOverview(tenantId: string) {
    const tables = await prisma.soaTable.findMany({
      where: { docVersion: { document: { study: { tenantId } } } },
      include: {
        docVersion: {
          select: {
            id: true,
            versionNumber: true,
            versionLabel: true,
            document: {
              select: {
                id: true,
                title: true,
                type: true,
                study: { select: { id: true, title: true } },
              },
            },
          },
        },
        _count: { select: { cells: true, soaFootnotes: true, footnoteAnchors: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return tables.map((t) => {
      const headerData = t.headerData as { visits?: string[] } | null;
      const drawings = Array.isArray(t.drawings) ? (t.drawings as unknown[]) : [];
      return {
        id: t.id,
        title: t.title,
        soaScore: t.soaScore,
        status: t.status,
        orientation: t.orientation,
        orientationConflict: t.orientationConflict,
        verificationLevel: t.verificationLevel,
        llmConfidence: t.llmConfidence,
        cellCount: t._count.cells,
        footnoteCount: t._count.soaFootnotes,
        anchorCount: t._count.footnoteAnchors,
        drawingCount: drawings.length,
        visitCount: headerData?.visits?.length ?? 0,
        document: {
          id: t.docVersion.document.id,
          title: t.docVersion.document.title,
          type: t.docVersion.document.type,
          versionId: t.docVersion.id,
          versionNumber: t.docVersion.versionNumber,
          versionLabel: t.docVersion.versionLabel,
          study: t.docVersion.document.study,
        },
        createdAt: t.createdAt,
      };
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
      include: {
        cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] },
        soaFootnotes: {
          orderBy: { markerOrder: "asc" },
          include: { anchors: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const sourceBlockIds = tables
      .map((t) => t.sourceBlockId)
      .filter((id): id is string => id != null);

    const sourceBlocks = sourceBlockIds.length > 0
      ? await prisma.contentBlock.findMany({
          where: { id: { in: sourceBlockIds } },
          select: { id: true, rawHtml: true },
        })
      : [];

    const blockMap = new Map(sourceBlocks.map((b) => [b.id, b.rawHtml]));

    return tables.map((table) => ({
      ...table,
      sourceHtml: table.sourceBlockId ? blockMap.get(table.sourceBlockId) ?? null : null,
    }));
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

  async setSoaTableStatus(
    tenantId: string,
    soaTableId: string,
    status: "detected" | "validated" | "not_soa",
  ) {
    const table = await prisma.soaTable.findUnique({
      where: { id: soaTableId },
      include: { docVersion: { include: { document: { include: { study: true } } } } },
    });
    requireTenantResource(table, tenantId, (t) => t.docVersion.document.study.tenantId);

    return prisma.soaTable.update({
      where: { id: soaTableId },
      data: { status },
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
