import { describe, it, expect } from "vitest";
import {
  buildSoaSnapshot,
  diffSoaSnapshots,
  type SnapshotInputTable,
  type SoaSnapshot,
} from "@clinscriptum/shared";

function makeTable(overrides: Partial<SnapshotInputTable> = {}): SnapshotInputTable {
  return {
    headerData: { visits: ["Screening", "Visit 1", "Visit 2"] },
    cells: [
      {
        rowIndex: 0,
        colIndex: 0,
        procedureName: "Informed consent",
        visitName: "Screening",
        rawValue: "X",
        normalizedValue: "X",
        manualValue: null,
        markerSources: ["text"],
      },
      {
        rowIndex: 0,
        colIndex: 1,
        procedureName: "Informed consent",
        visitName: "Visit 1",
        rawValue: "",
        normalizedValue: "",
        manualValue: null,
        markerSources: ["text"],
      },
      {
        rowIndex: 1,
        colIndex: 1,
        procedureName: "Vital signs",
        visitName: "Visit 1",
        rawValue: "X",
        normalizedValue: "X",
        manualValue: null,
        markerSources: ["text", "arrow"],
      },
    ],
    soaFootnotes: [
      {
        marker: "1",
        markerOrder: 0,
        text: "Performed only at baseline",
        anchors: [
          { targetType: "cell", cellId: null, rowIndex: 0, colIndex: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildSoaSnapshot", () => {
  it("extracts visits, procedures, and only non-empty cells", () => {
    const snap = buildSoaSnapshot(makeTable());
    expect(snap.visits).toEqual(["Screening", "Visit 1", "Visit 2"]);
    expect(snap.procedures).toEqual(["Informed consent", "Vital signs"]);
    expect(snap.cells).toEqual([
      { procedure: "Informed consent", visit: "Screening", value: "X", markerSources: ["text"] },
      { procedure: "Vital signs", visit: "Visit 1", value: "X", markerSources: ["text", "arrow"] },
    ]);
  });

  it("prefers manualValue over normalizedValue and rawValue", () => {
    const snap = buildSoaSnapshot(
      makeTable({
        cells: [
          {
            rowIndex: 0,
            colIndex: 0,
            procedureName: "P",
            visitName: "V",
            rawValue: "X",
            normalizedValue: "X",
            manualValue: "—",
            markerSources: ["text"],
          },
        ],
      }),
    );
    expect(snap.cells[0].value).toBe("—");
  });

  it("preserves footnote anchors as cellRef so anchors remain comparable across versions", () => {
    const snap = buildSoaSnapshot(makeTable());
    expect(snap.footnotes).toHaveLength(1);
    expect(snap.footnotes[0].anchors[0]).toEqual({
      targetType: "cell",
      cellRef: "Informed consent|Screening",
    });
  });

  it("handles empty headerData gracefully", () => {
    const snap = buildSoaSnapshot(
      makeTable({ headerData: null, cells: [], soaFootnotes: [] }),
    );
    expect(snap.visits).toEqual([]);
    expect(snap.procedures).toEqual([]);
    expect(snap.cells).toEqual([]);
    expect(snap.footnotes).toEqual([]);
  });

  it("produces stable cell order across runs", () => {
    const snap1 = buildSoaSnapshot(makeTable());
    const snap2 = buildSoaSnapshot(makeTable());
    expect(JSON.stringify(snap1.cells)).toBe(JSON.stringify(snap2.cells));
  });
});

describe("diffSoaSnapshots", () => {
  const baseline: SoaSnapshot = {
    visits: ["Screening", "Visit 1"],
    procedures: ["Informed consent", "Vital signs"],
    cells: [
      { procedure: "Informed consent", visit: "Screening", value: "X", markerSources: ["text"] },
      { procedure: "Vital signs", visit: "Visit 1", value: "X", markerSources: ["text"] },
    ],
    footnotes: [{ marker: "1", text: "Baseline only", anchors: [] }],
  };

  it("reports no changes for identical snapshots", () => {
    const diff = diffSoaSnapshots(baseline, baseline);
    expect(diff.unchanged).toBe(true);
    expect(diff.addedProcedures).toEqual([]);
    expect(diff.removedProcedures).toEqual([]);
    expect(diff.cellChanges).toEqual([]);
  });

  it("detects added/removed procedures and visits", () => {
    const next: SoaSnapshot = {
      ...baseline,
      visits: ["Screening", "Visit 1", "Visit 2"],
      procedures: ["Informed consent", "ECG"],
    };
    const diff = diffSoaSnapshots(baseline, next);
    expect(diff.addedProcedures).toEqual(["ECG"]);
    expect(diff.removedProcedures).toEqual(["Vital signs"]);
    expect(diff.addedVisits).toEqual(["Visit 2"]);
    expect(diff.removedVisits).toEqual([]);
    expect(diff.unchanged).toBe(false);
  });

  it("detects cell value changes including added/removed marks", () => {
    const next: SoaSnapshot = {
      visits: ["Screening", "Visit 1"],
      procedures: ["Informed consent", "Vital signs"],
      cells: [
        // Removed: Informed consent / Screening
        // Edited: Vital signs / Visit 1 X → —
        { procedure: "Vital signs", visit: "Visit 1", value: "—", markerSources: ["text"] },
        // Added: Vital signs / Screening
        { procedure: "Vital signs", visit: "Screening", value: "X", markerSources: ["text"] },
      ],
      footnotes: baseline.footnotes,
    };
    const diff = diffSoaSnapshots(baseline, next);
    expect(diff.cellChanges).toContainEqual({
      procedure: "Informed consent",
      visit: "Screening",
      oldValue: "X",
      newValue: null,
    });
    expect(diff.cellChanges).toContainEqual({
      procedure: "Vital signs",
      visit: "Visit 1",
      oldValue: "X",
      newValue: "—",
    });
    expect(diff.cellChanges).toContainEqual({
      procedure: "Vital signs",
      visit: "Screening",
      oldValue: null,
      newValue: "X",
    });
  });

  it("detects footnote add/remove/edit", () => {
    const next: SoaSnapshot = {
      ...baseline,
      footnotes: [
        { marker: "1", text: "Baseline only — see SAP §3.2", anchors: [] }, // edited
        { marker: "2", text: "New note", anchors: [] }, // added
      ],
    };
    const diff = diffSoaSnapshots(baseline, next);
    const byMarker = Object.fromEntries(diff.footnoteChanges.map((c) => [c.marker, c.type]));
    expect(byMarker["1"]).toBe("edited");
    expect(byMarker["2"]).toBe("added");
  });

  it("treats null snapshots as empty", () => {
    const diff = diffSoaSnapshots(null, baseline);
    expect(diff.addedProcedures.sort()).toEqual(["Informed consent", "Vital signs"]);
    expect(diff.addedVisits.sort()).toEqual(["Screening", "Visit 1"]);
    expect(diff.cellChanges).toHaveLength(2);
    expect(diff.unchanged).toBe(false);
  });

  it("treats both-null as unchanged", () => {
    const diff = diffSoaSnapshots(null, null);
    expect(diff.unchanged).toBe(true);
  });
});
