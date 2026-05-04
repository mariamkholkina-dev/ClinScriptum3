/**
 * SoA impact analyzer — Sprint 7 commit 3.
 *
 * When a new DocumentVersion is processed, compare its SoA to the
 * immediately previous version of the same document. Emit `Finding`
 * rows of type `soa_procedure_added` / `soa_procedure_removed` so the
 * medical writer sees in the audit view that the schedule changed and
 * downstream artefacts (ICF, IB, study text §5) need updating.
 *
 * Cell- and visit-level changes are intentionally NOT promoted to
 * findings here — they are visible in the SoA diff view (commit 2)
 * but rarely actionable on their own. Procedure add/remove is the one
 * that almost always implies follow-up work in other documents.
 */

import { prisma } from "@clinscriptum/db";
import {
  buildSoaSnapshot,
  diffSoaSnapshots,
  type SnapshotInputTable,
  type SoaSnapshot,
} from "@clinscriptum/shared";
import { logger } from "./logger.js";

const SOA_TABLE_INCLUDE = {
  cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] },
  soaFootnotes: { orderBy: { markerOrder: "asc" }, include: { anchors: true } },
} as const;

interface ImpactResult {
  /** True when no previous version exists; nothing to compare. */
  skipped: boolean;
  previousVersionId?: string;
  addedProcedures: string[];
  removedProcedures: string[];
  findingsCreated: number;
}

async function loadSnapshotForVersion(versionId: string): Promise<SoaSnapshot> {
  const tables = await prisma.soaTable.findMany({
    where: { docVersionId: versionId },
    include: SOA_TABLE_INCLUDE as unknown as never,
    orderBy: { createdAt: "asc" },
  });

  if (tables.length === 0) {
    return { visits: [], procedures: [], cells: [], footnotes: [] };
  }

  // Union all SoA tables into a single snapshot — same as soaComparisonService
  // in the API. Duplicate to avoid a workers→api dependency.
  const snapshots = tables.map((t) => buildSoaSnapshot(t as unknown as SnapshotInputTable));
  if (snapshots.length === 1) return snapshots[0];

  const visits: string[] = [];
  const procedures: string[] = [];
  const seenVisits = new Set<string>();
  const seenProcs = new Set<string>();
  const cells: SoaSnapshot["cells"] = [];
  const cellSeen = new Set<string>();
  const footnotes: SoaSnapshot["footnotes"] = [];
  const fnSeen = new Set<string>();

  for (const s of snapshots) {
    for (const v of s.visits) {
      if (!seenVisits.has(v)) {
        seenVisits.add(v);
        visits.push(v);
      }
    }
    for (const p of s.procedures) {
      if (!seenProcs.has(p)) {
        seenProcs.add(p);
        procedures.push(p);
      }
    }
    for (const c of s.cells) {
      const k = `${c.procedure}|${c.visit}`;
      if (!cellSeen.has(k)) {
        cellSeen.add(k);
        cells.push(c);
      }
    }
    for (const f of s.footnotes) {
      if (!fnSeen.has(f.marker)) {
        fnSeen.add(f.marker);
        footnotes.push(f);
      }
    }
  }

  return { visits, procedures, cells, footnotes };
}

async function findPreviousVersionId(currentVersionId: string): Promise<string | null> {
  const current = await prisma.documentVersion.findUnique({
    where: { id: currentVersionId },
    select: { documentId: true, versionNumber: true },
  });
  if (!current) return null;

  const previous = await prisma.documentVersion.findFirst({
    where: {
      documentId: current.documentId,
      versionNumber: { lt: current.versionNumber },
    },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  return previous?.id ?? null;
}

export async function runSoaImpactAnalysis(
  currentVersionId: string,
): Promise<ImpactResult> {
  const previousVersionId = await findPreviousVersionId(currentVersionId);
  if (!previousVersionId) {
    return {
      skipped: true,
      addedProcedures: [],
      removedProcedures: [],
      findingsCreated: 0,
    };
  }

  const [oldSnapshot, newSnapshot] = await Promise.all([
    loadSnapshotForVersion(previousVersionId),
    loadSnapshotForVersion(currentVersionId),
  ]);

  const diff = diffSoaSnapshots(oldSnapshot, newSnapshot);

  if (diff.addedProcedures.length === 0 && diff.removedProcedures.length === 0) {
    return {
      skipped: false,
      previousVersionId,
      addedProcedures: [],
      removedProcedures: [],
      findingsCreated: 0,
    };
  }

  const findingsData = [
    ...diff.addedProcedures.map((procedure) => ({
      docVersionId: currentVersionId,
      type: "soa_procedure_added" as const,
      description: `В SoA добавлена процедура «${procedure}» по сравнению с предыдущей версией.`,
      suggestion:
        "Описать процедуру в разделе 5 протокола и проверить, что она отражена в ICF и (при необходимости) в IB.",
      sourceRef: { procedure, previousVersionId } as object,
      severity: "medium" as const,
      auditCategory: "soa_impact",
      issueType: "soa_procedure_added",
      extraAttributes: { procedure, previousVersionId } as object,
    })),
    ...diff.removedProcedures.map((procedure) => ({
      docVersionId: currentVersionId,
      type: "soa_procedure_removed" as const,
      description: `Из SoA удалена процедура «${procedure}» по сравнению с предыдущей версией.`,
      suggestion:
        "Удалить упоминания процедуры в тексте протокола, ICF и IB или подтвердить, что упоминания должны остаться (например в обосновании).",
      sourceRef: { procedure, previousVersionId } as object,
      severity: "medium" as const,
      auditCategory: "soa_impact",
      issueType: "soa_procedure_removed",
      extraAttributes: { procedure, previousVersionId } as object,
    })),
  ];

  // Avoid duplicate findings on re-run of the same step: drop earlier
  // soa-impact findings for the same version before re-creating.
  await prisma.finding.deleteMany({
    where: {
      docVersionId: currentVersionId,
      auditCategory: "soa_impact",
    },
  });

  const result = await prisma.finding.createMany({ data: findingsData });

  logger.info("[soa-impact] findings created", {
    currentVersionId,
    previousVersionId,
    added: diff.addedProcedures.length,
    removed: diff.removedProcedures.length,
    findingsCreated: result.count,
  });

  return {
    skipped: false,
    previousVersionId,
    addedProcedures: diff.addedProcedures,
    removedProcedures: diff.removedProcedures,
    findingsCreated: result.count,
  };
}
