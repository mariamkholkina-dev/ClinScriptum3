/**
 * SoA snapshot — Sprint 7 commit 1.
 *
 * A stable serialized form of an `SoaTable` used for cross-version diff
 * and as a context payload for generation/audit. The shape is small,
 * order-stable, and does not include UUIDs — two snapshots from
 * different DocumentVersions can be compared by value.
 *
 * Cached in `SoaTable.snapshotJson` (lazily computed on first read).
 */

export interface SnapshotCell {
  procedure: string;
  visit: string;
  /** Effective cell value: `manualValue ?? normalizedValue ?? rawValue` (trimmed). */
  value: string;
  /** Sources contributing to the mark — any of 'text', 'arrow', 'line', 'bracket'. */
  markerSources: string[];
}

export interface SnapshotFootnoteAnchor {
  /** "cell" | "row" | "col" */
  targetType: string;
  /** For cell-anchored: `${procedure}|${visit}` so anchors stay diffable across version IDs. */
  cellRef?: string;
  rowIndex?: number;
  colIndex?: number;
}

export interface SnapshotFootnote {
  marker: string;
  text: string;
  anchors: SnapshotFootnoteAnchor[];
}

export interface SoaSnapshot {
  /** Visit headers in canonical (visits-cols) order. */
  visits: string[];
  /** Procedure names in row order. */
  procedures: string[];
  /** Only non-empty cells. Stable sort by (procedure, visit). */
  cells: SnapshotCell[];
  /** Footnotes ordered by markerOrder. */
  footnotes: SnapshotFootnote[];
}

/* ─── Inputs from prisma ─────────────────────────────────── */

export interface SnapshotInputCell {
  rowIndex: number;
  colIndex: number;
  procedureName: string;
  visitName: string;
  rawValue: string;
  normalizedValue: string;
  manualValue: string | null;
  markerSources: unknown;
}

export interface SnapshotInputFootnoteAnchor {
  targetType: string;
  cellId: string | null;
  rowIndex: number | null;
  colIndex: number | null;
}

export interface SnapshotInputFootnote {
  marker: string;
  markerOrder: number;
  text: string;
  anchors: SnapshotInputFootnoteAnchor[];
}

export interface SnapshotInputTable {
  headerData: unknown;
  cells: SnapshotInputCell[];
  soaFootnotes: SnapshotInputFootnote[];
}

/* ─── Builder ────────────────────────────────────────────── */

function effectiveCellValue(c: SnapshotInputCell): string {
  const v = c.manualValue ?? c.normalizedValue ?? c.rawValue ?? "";
  return v.trim();
}

function parseHeaderVisits(headerData: unknown): string[] {
  if (!headerData || typeof headerData !== "object") return [];
  const visits = (headerData as Record<string, unknown>).visits;
  if (!Array.isArray(visits)) return [];
  return visits.filter((v): v is string => typeof v === "string");
}

function parseMarkerSources(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string");
}

export function buildSoaSnapshot(table: SnapshotInputTable): SoaSnapshot {
  const visits = parseHeaderVisits(table.headerData);

  // Procedures: preserve first-seen order across cells (already sorted by row/col upstream).
  const procedures: string[] = [];
  const seenProcedures = new Set<string>();
  for (const c of table.cells) {
    if (!seenProcedures.has(c.procedureName)) {
      seenProcedures.add(c.procedureName);
      procedures.push(c.procedureName);
    }
  }

  // Map cellId → "procedure|visit" for anchor reference.
  const cellRefByPosition = new Map<string, string>();
  for (const c of table.cells) {
    cellRefByPosition.set(`${c.rowIndex}:${c.colIndex}`, `${c.procedureName}|${c.visitName}`);
  }

  const cells: SnapshotCell[] = [];
  for (const c of table.cells) {
    const value = effectiveCellValue(c);
    if (!value) continue;
    cells.push({
      procedure: c.procedureName,
      visit: c.visitName,
      value,
      markerSources: parseMarkerSources(c.markerSources),
    });
  }
  // Stable sort for deterministic snapshot bytes.
  cells.sort((a, b) =>
    a.procedure === b.procedure ? a.visit.localeCompare(b.visit) : a.procedure.localeCompare(b.procedure),
  );

  // Footnotes: by markerOrder, with anchors translated to position-stable refs.
  const sortedFootnotes = [...table.soaFootnotes].sort(
    (a, b) => a.markerOrder - b.markerOrder,
  );
  const footnotes: SnapshotFootnote[] = sortedFootnotes.map((f) => ({
    marker: f.marker,
    text: f.text,
    anchors: f.anchors.map((a) => {
      const anchor: SnapshotFootnoteAnchor = { targetType: a.targetType };
      if (a.targetType === "cell" && a.rowIndex != null && a.colIndex != null) {
        const ref = cellRefByPosition.get(`${a.rowIndex}:${a.colIndex}`);
        if (ref) anchor.cellRef = ref;
      } else if (a.targetType === "row" && a.rowIndex != null) {
        anchor.rowIndex = a.rowIndex;
      } else if (a.targetType === "col" && a.colIndex != null) {
        anchor.colIndex = a.colIndex;
      }
      return anchor;
    }),
  }));

  return { visits, procedures, cells, footnotes };
}

/* ─── Diff ───────────────────────────────────────────────── */

export interface SoaCellChange {
  procedure: string;
  visit: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface SoaFootnoteChange {
  marker: string;
  type: "added" | "removed" | "edited";
  oldText?: string;
  newText?: string;
}

export interface SoaDiff {
  addedProcedures: string[];
  removedProcedures: string[];
  addedVisits: string[];
  removedVisits: string[];
  cellChanges: SoaCellChange[];
  footnoteChanges: SoaFootnoteChange[];
  /** True when no field has any change. */
  unchanged: boolean;
}

function diffStringSets(oldList: string[], newList: string[]) {
  const oldSet = new Set(oldList);
  const newSet = new Set(newList);
  const added = newList.filter((v) => !oldSet.has(v));
  const removed = oldList.filter((v) => !newSet.has(v));
  return { added, removed };
}

function cellKey(c: { procedure: string; visit: string }): string {
  return `${c.procedure}|${c.visit}`;
}

export function diffSoaSnapshots(
  oldSnap: SoaSnapshot | null,
  newSnap: SoaSnapshot | null,
): SoaDiff {
  const oldS: SoaSnapshot = oldSnap ?? { visits: [], procedures: [], cells: [], footnotes: [] };
  const newS: SoaSnapshot = newSnap ?? { visits: [], procedures: [], cells: [], footnotes: [] };

  const procDiff = diffStringSets(oldS.procedures, newS.procedures);
  const visitDiff = diffStringSets(oldS.visits, newS.visits);

  // Cell diff: union of keys across both snapshots.
  const oldCellMap = new Map(oldS.cells.map((c) => [cellKey(c), c.value]));
  const newCellMap = new Map(newS.cells.map((c) => [cellKey(c), c.value]));
  const cellChanges: SoaCellChange[] = [];
  const allKeys = new Set<string>([...oldCellMap.keys(), ...newCellMap.keys()]);
  for (const key of allKeys) {
    const oldVal = oldCellMap.get(key) ?? null;
    const newVal = newCellMap.get(key) ?? null;
    if (oldVal === newVal) continue;
    const [procedure, visit] = key.split("|");
    cellChanges.push({ procedure, visit, oldValue: oldVal, newValue: newVal });
  }
  cellChanges.sort((a, b) =>
    a.procedure === b.procedure ? a.visit.localeCompare(b.visit) : a.procedure.localeCompare(b.procedure),
  );

  // Footnote diff: by marker.
  const oldFnMap = new Map(oldS.footnotes.map((f) => [f.marker, f]));
  const newFnMap = new Map(newS.footnotes.map((f) => [f.marker, f]));
  const footnoteChanges: SoaFootnoteChange[] = [];
  for (const [marker, f] of newFnMap) {
    if (!oldFnMap.has(marker)) {
      footnoteChanges.push({ marker, type: "added", newText: f.text });
    }
  }
  for (const [marker, f] of oldFnMap) {
    if (!newFnMap.has(marker)) {
      footnoteChanges.push({ marker, type: "removed", oldText: f.text });
    } else {
      const newF = newFnMap.get(marker)!;
      if (newF.text !== f.text) {
        footnoteChanges.push({
          marker,
          type: "edited",
          oldText: f.text,
          newText: newF.text,
        });
      }
    }
  }
  footnoteChanges.sort((a, b) => a.marker.localeCompare(b.marker));

  const unchanged =
    procDiff.added.length === 0 &&
    procDiff.removed.length === 0 &&
    visitDiff.added.length === 0 &&
    visitDiff.removed.length === 0 &&
    cellChanges.length === 0 &&
    footnoteChanges.length === 0;

  return {
    addedProcedures: procDiff.added,
    removedProcedures: procDiff.removed,
    addedVisits: visitDiff.added,
    removedVisits: visitDiff.removed,
    cellChanges,
    footnoteChanges,
    unchanged,
  };
}
