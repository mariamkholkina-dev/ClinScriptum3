import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: { findUnique: vi.fn(), findFirst: vi.fn() },
    soaTable: { findMany: vi.fn() },
    finding: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

import { prisma } from "@clinscriptum/db";
import { runSoaImpactAnalysis } from "../soa-impact-analyzer.js";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
};
const mockSoaTable = prisma.soaTable as unknown as { findMany: ReturnType<typeof vi.fn> };
const mockFinding = prisma.finding as unknown as {
  deleteMany: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
};

const CURRENT = "v-current";
const PREV = "v-prev";

function tableWithCells(cells: Array<{ procedure: string; visit: string; value: string }>, visits: string[]) {
  return {
    headerData: { visits },
    cells: cells.map((c, idx) => ({
      rowIndex: idx,
      colIndex: visits.indexOf(c.visit),
      procedureName: c.procedure,
      visitName: c.visit,
      rawValue: c.value,
      normalizedValue: c.value,
      manualValue: null,
      markerSources: ["text"],
    })),
    soaFootnotes: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFinding.deleteMany.mockResolvedValue({ count: 0 });
  mockFinding.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

describe("runSoaImpactAnalysis", () => {
  it("skips when there is no previous DocumentVersion", async () => {
    mockVersion.findUnique.mockResolvedValueOnce({ documentId: "doc-1", versionNumber: 1 });
    mockVersion.findFirst.mockResolvedValueOnce(null);

    const result = await runSoaImpactAnalysis(CURRENT);

    expect(result.skipped).toBe(true);
    expect(result.findingsCreated).toBe(0);
    expect(mockFinding.createMany).not.toHaveBeenCalled();
  });

  it("creates soa_procedure_added/removed findings against previous version", async () => {
    mockVersion.findUnique.mockResolvedValueOnce({ documentId: "doc-1", versionNumber: 2 });
    mockVersion.findFirst.mockResolvedValueOnce({ id: PREV });

    mockSoaTable.findMany
      .mockResolvedValueOnce([
        tableWithCells(
          [
            { procedure: "Informed consent", visit: "Screening", value: "X" },
            { procedure: "Vital signs", visit: "Visit 1", value: "X" },
          ],
          ["Screening", "Visit 1"],
        ),
      ])
      .mockResolvedValueOnce([
        tableWithCells(
          [
            { procedure: "Informed consent", visit: "Screening", value: "X" },
            { procedure: "ECG", visit: "Visit 1", value: "X" },
          ],
          ["Screening", "Visit 1"],
        ),
      ]);

    const result = await runSoaImpactAnalysis(CURRENT);

    expect(result.skipped).toBe(false);
    expect(result.previousVersionId).toBe(PREV);
    expect(result.addedProcedures).toEqual(["ECG"]);
    expect(result.removedProcedures).toEqual(["Vital signs"]);
    expect(result.findingsCreated).toBe(2);

    const created = mockFinding.createMany.mock.calls[0][0].data as Array<{
      type: string;
      docVersionId: string;
      auditCategory: string;
      issueType: string;
      description: string;
    }>;
    expect(created).toHaveLength(2);
    const types = created.map((f) => f.type).sort();
    expect(types).toEqual(["soa_procedure_added", "soa_procedure_removed"]);
    expect(created.every((f) => f.docVersionId === CURRENT)).toBe(true);
    expect(created.every((f) => f.auditCategory === "soa_impact")).toBe(true);
    expect(created.find((f) => f.type === "soa_procedure_added")!.description).toContain("ECG");
    expect(created.find((f) => f.type === "soa_procedure_removed")!.description).toContain("Vital signs");
  });

  it("removes existing soa_impact findings before creating new ones", async () => {
    mockVersion.findUnique.mockResolvedValueOnce({ documentId: "doc-1", versionNumber: 2 });
    mockVersion.findFirst.mockResolvedValueOnce({ id: PREV });

    mockSoaTable.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        tableWithCells([{ procedure: "ECG", visit: "Screening", value: "X" }], ["Screening"]),
      ]);

    await runSoaImpactAnalysis(CURRENT);

    expect(mockFinding.deleteMany).toHaveBeenCalledWith({
      where: { docVersionId: CURRENT, auditCategory: "soa_impact" },
    });
  });

  it("returns zero findings (and does not delete) when only cell/visit changes occur", async () => {
    mockVersion.findUnique.mockResolvedValueOnce({ documentId: "doc-1", versionNumber: 2 });
    mockVersion.findFirst.mockResolvedValueOnce({ id: PREV });

    mockSoaTable.findMany
      .mockResolvedValueOnce([
        tableWithCells(
          [{ procedure: "Vital signs", visit: "Visit 1", value: "X" }],
          ["Visit 1"],
        ),
      ])
      .mockResolvedValueOnce([
        tableWithCells(
          [{ procedure: "Vital signs", visit: "Visit 2", value: "X" }],
          ["Visit 2"],
        ),
      ]);

    const result = await runSoaImpactAnalysis(CURRENT);

    // Procedures unchanged (still just Vital signs); only visit moved.
    expect(result.addedProcedures).toEqual([]);
    expect(result.removedProcedures).toEqual([]);
    expect(result.findingsCreated).toBe(0);
    expect(mockFinding.createMany).not.toHaveBeenCalled();
  });

  it("handles a current version with no SoA tables (everything from previous becomes 'removed')", async () => {
    mockVersion.findUnique.mockResolvedValueOnce({ documentId: "doc-1", versionNumber: 2 });
    mockVersion.findFirst.mockResolvedValueOnce({ id: PREV });

    mockSoaTable.findMany
      .mockResolvedValueOnce([
        tableWithCells(
          [
            { procedure: "ECG", visit: "Screening", value: "X" },
            { procedure: "Vital signs", visit: "Visit 1", value: "X" },
          ],
          ["Screening", "Visit 1"],
        ),
      ])
      .mockResolvedValueOnce([]);

    const result = await runSoaImpactAnalysis(CURRENT);
    expect(result.removedProcedures.sort()).toEqual(["ECG", "Vital signs"]);
    expect(result.addedProcedures).toEqual([]);
    expect(result.findingsCreated).toBe(2);
  });
});
