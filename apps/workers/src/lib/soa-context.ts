/**
 * SoA generation context — Sprint 7 commits 4 and 5.
 *
 * Renders a `SoaSnapshot` into a compact, LLM-friendly text block that
 * is appended to the user prompt for ICF (commit 4) and CSR (commit 5)
 * generation. The format is plain markdown-ish bullet text, optimized
 * for token efficiency: every procedure on one line, visits comma-
 * separated, footnotes appended only when present.
 */

import { prisma } from "@clinscriptum/db";
import {
  buildSoaSnapshot,
  type SnapshotInputTable,
  type SoaSnapshot,
} from "@clinscriptum/shared";

/**
 * Build a text context block from a snapshot. Returns null when the
 * snapshot has no procedures (caller should skip the SoA section).
 */
export function formatSoaContext(snapshot: SoaSnapshot): string | null {
  if (snapshot.procedures.length === 0) return null;

  // procedure → ordered visits where the cell has any non-empty mark.
  // We preserve visits' header order (canonical visits-cols), not
  // alphabetical — visit order is meaningful (Screening → Visit 1 → ...).
  const visitOrder = new Map<string, number>();
  snapshot.visits.forEach((v, i) => visitOrder.set(v, i));

  const procToVisits = new Map<string, string[]>();
  for (const c of snapshot.cells) {
    let arr = procToVisits.get(c.procedure);
    if (!arr) {
      arr = [];
      procToVisits.set(c.procedure, arr);
    }
    if (!arr.includes(c.visit)) arr.push(c.visit);
  }
  for (const [proc, visits] of procToVisits) {
    visits.sort((a, b) => (visitOrder.get(a) ?? 0) - (visitOrder.get(b) ?? 0));
    procToVisits.set(proc, visits);
  }

  const lines: string[] = [];
  lines.push("PROCEDURES SCHEDULE (FROM SOA):");
  for (const proc of snapshot.procedures) {
    const visits = procToVisits.get(proc) ?? [];
    if (visits.length === 0) {
      lines.push(`- ${proc}: (not scheduled in any visit)`);
    } else {
      lines.push(`- ${proc}: ${visits.join(", ")}`);
    }
  }

  if (snapshot.footnotes.length > 0) {
    lines.push("");
    lines.push("FOOTNOTES:");
    for (const f of snapshot.footnotes) {
      const text = (f.text ?? "").trim();
      if (text) {
        lines.push(`[${f.marker}] ${text}`);
      }
    }
  }

  return lines.join("\n");
}

const SOA_TABLE_INCLUDE = {
  cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] },
  soaFootnotes: { orderBy: { markerOrder: "asc" }, include: { anchors: true } },
} as const;

function unionSnapshots(snapshots: SoaSnapshot[]): SoaSnapshot {
  if (snapshots.length === 0) {
    return { visits: [], procedures: [], cells: [], footnotes: [] };
  }
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

/**
 * Load all SoaTables for a DocumentVersion and build the formatted
 * context. Returns null when the document has no SoA (handler should
 * skip injection in that case).
 */
export async function loadSoaContextForVersion(
  docVersionId: string,
): Promise<{ snapshot: SoaSnapshot; text: string | null }> {
  const tables = await prisma.soaTable.findMany({
    where: { docVersionId },
    include: SOA_TABLE_INCLUDE as unknown as never,
    orderBy: { createdAt: "asc" },
  });

  if (tables.length === 0) {
    return {
      snapshot: { visits: [], procedures: [], cells: [], footnotes: [] },
      text: null,
    };
  }

  const snapshots = tables.map((t) => buildSoaSnapshot(t as unknown as SnapshotInputTable));
  const snapshot = unionSnapshots(snapshots);
  const text = formatSoaContext(snapshot);
  return { snapshot, text };
}
