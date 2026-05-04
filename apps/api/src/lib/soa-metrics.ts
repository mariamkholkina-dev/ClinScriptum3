/**
 * SoA detection metrics — Sprint 6 commit 8.
 *
 * Compares an actual SoA detection result (from `SoaTable` + `SoaCell`)
 * against an expected ground-truth shape stored in
 * `GoldenSampleStageStatus.expectedResults` for the `soa_detection`
 * stage. Produces precision/recall/F1 for visits, procedures, cells and
 * footnote anchors.
 *
 * Expected shape (lenient — every field is optional):
 *
 * ```jsonc
 * {
 *   "soaTables": [
 *     {
 *       "visits": ["Screening", "Visit 1", ...],
 *       "procedures": ["Informed consent", "Vital signs", ...],
 *       "cells": [
 *         { "procedure": "Vital signs", "visit": "Visit 1", "value": "X" },
 *         ...
 *       ],
 *       "footnoteAnchors": [
 *         { "procedure": "Vital signs", "visit": "Visit 1", "marker": "1" }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * Multiple SoA tables in `expectedResults.soaTables` and in `actual` are
 * compared as flattened sets — order doesn't matter; we don't try to
 * pair them up. That's intentionally simple: the metric is "did the
 * detector recover the union of cells/visits/procedures from the
 * golden truth", not "did it produce the same number of tables".
 */

export interface ExpectedSoaCell {
  procedure: string;
  visit: string;
  value: string;
}

export interface ExpectedFootnoteAnchor {
  procedure: string;
  visit: string;
  marker: string;
}

export interface ExpectedSoaTable {
  visits: string[];
  procedures: string[];
  cells?: ExpectedSoaCell[];
  footnoteAnchors?: ExpectedFootnoteAnchor[];
}

export interface ExpectedSoaResults {
  soaTables: ExpectedSoaTable[];
}

export interface ActualSoaCell {
  procedureName: string;
  visitName: string;
  rawValue: string;
  normalizedValue: string;
  manualValue: string | null;
}

export interface ActualFootnoteAnchor {
  marker: string;
  procedureName: string | null;
  visitName: string | null;
}

export interface ActualSoaTable {
  cells: ActualSoaCell[];
  footnoteAnchors: ActualFootnoteAnchor[];
}

export interface PrecisionRecallF1 {
  precision: number;
  recall: number;
  f1: number;
}

export interface SoaMetrics {
  /** Number of expected vs detected SoA tables (1 if both ≥ 1, else 0). */
  detectionAgreement: 0 | 1 | null;
  visit: PrecisionRecallF1 | null;
  procedure: PrecisionRecallF1 | null;
  cell: PrecisionRecallF1 | null;
  footnoteLink: PrecisionRecallF1 | null;
}

const NULL_METRICS: SoaMetrics = {
  detectionAgreement: null,
  visit: null,
  procedure: null,
  cell: null,
  footnoteLink: null,
};

/**
 * Best-effort parse of an unknown blob into ExpectedSoaResults. Returns
 * null when the blob is absent or doesn't match the shape — caller
 * treats null as "no ground truth available".
 */
export function parseExpectedSoa(raw: unknown): ExpectedSoaResults | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const tables = obj.soaTables;
  if (!Array.isArray(tables)) return null;
  const out: ExpectedSoaTable[] = [];
  for (const t of tables) {
    if (!t || typeof t !== "object") continue;
    const tt = t as Record<string, unknown>;
    const visits = Array.isArray(tt.visits) ? tt.visits.filter((v): v is string => typeof v === "string") : [];
    const procedures = Array.isArray(tt.procedures)
      ? tt.procedures.filter((v): v is string => typeof v === "string")
      : [];
    const cells = Array.isArray(tt.cells)
      ? tt.cells
          .map((c) => {
            if (!c || typeof c !== "object") return null;
            const cc = c as Record<string, unknown>;
            if (typeof cc.procedure !== "string" || typeof cc.visit !== "string") return null;
            return {
              procedure: cc.procedure,
              visit: cc.visit,
              value: typeof cc.value === "string" ? cc.value : "",
            } as ExpectedSoaCell;
          })
          .filter((c): c is ExpectedSoaCell => c != null)
      : undefined;
    const footnoteAnchors = Array.isArray(tt.footnoteAnchors)
      ? tt.footnoteAnchors
          .map((a) => {
            if (!a || typeof a !== "object") return null;
            const aa = a as Record<string, unknown>;
            if (typeof aa.procedure !== "string" || typeof aa.visit !== "string" || typeof aa.marker !== "string") {
              return null;
            }
            return { procedure: aa.procedure, visit: aa.visit, marker: aa.marker } as ExpectedFootnoteAnchor;
          })
          .filter((a): a is ExpectedFootnoteAnchor => a != null)
      : undefined;
    out.push({ visits, procedures, cells, footnoteAnchors });
  }
  if (out.length === 0) return null;
  return { soaTables: out };
}

function setPrecisionRecallF1(expected: Set<string>, actual: Set<string>): PrecisionRecallF1 {
  if (expected.size === 0 && actual.size === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  let tp = 0;
  for (const a of actual) if (expected.has(a)) tp++;
  const precision = actual.size > 0 ? tp / actual.size : 0;
  const recall = expected.size > 0 ? tp / expected.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

function normalizeCellValue(raw: string): string {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (trimmed === "x" || trimmed === "✓" || trimmed === "✔" || trimmed === "+") return "x";
  if (trimmed === "–" || trimmed === "—" || trimmed === "-") return "-";
  return trimmed;
}

export function computeSoaMetrics(
  expected: ExpectedSoaResults | null,
  actual: ActualSoaTable[],
): SoaMetrics {
  if (!expected) return NULL_METRICS;

  // Detection agreement: did we find any SoA when at least one was expected?
  const detectionAgreement: 0 | 1 =
    expected.soaTables.length > 0 && actual.length > 0
      ? 1
      : expected.soaTables.length === 0 && actual.length === 0
        ? 1
        : 0;

  // Aggregate visits/procedures/cells across all tables on each side.
  const expectedVisits = new Set<string>();
  const expectedProcedures = new Set<string>();
  const expectedCells = new Set<string>();
  const expectedAnchors = new Set<string>();
  for (const t of expected.soaTables) {
    for (const v of t.visits) expectedVisits.add(v);
    for (const p of t.procedures) expectedProcedures.add(p);
    for (const c of t.cells ?? []) {
      const norm = normalizeCellValue(c.value);
      if (norm) expectedCells.add(`${c.procedure}|${c.visit}|${norm}`);
    }
    for (const a of t.footnoteAnchors ?? []) {
      expectedAnchors.add(`${a.procedure}|${a.visit}|${a.marker}`);
    }
  }

  const actualVisits = new Set<string>();
  const actualProcedures = new Set<string>();
  const actualCells = new Set<string>();
  const actualAnchors = new Set<string>();
  for (const t of actual) {
    for (const c of t.cells) {
      actualVisits.add(c.visitName);
      actualProcedures.add(c.procedureName);
      const norm = normalizeCellValue(c.manualValue ?? c.normalizedValue);
      if (norm) actualCells.add(`${c.procedureName}|${c.visitName}|${norm}`);
    }
    for (const a of t.footnoteAnchors) {
      if (a.procedureName != null && a.visitName != null) {
        actualAnchors.add(`${a.procedureName}|${a.visitName}|${a.marker}`);
      }
    }
  }

  return {
    detectionAgreement,
    visit: setPrecisionRecallF1(expectedVisits, actualVisits),
    procedure: setPrecisionRecallF1(expectedProcedures, actualProcedures),
    cell: setPrecisionRecallF1(expectedCells, actualCells),
    footnoteLink:
      expectedAnchors.size > 0 || actualAnchors.size > 0
        ? setPrecisionRecallF1(expectedAnchors, actualAnchors)
        : null,
  };
}
