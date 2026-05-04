import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: {
    documentVersion: { findUnique: vi.fn() },
    soaTable: { update: vi.fn() },
  },
}));

import { prisma } from "@clinscriptum/db";
import { soaComparisonService } from "../soa-comparison.service.js";
import { DomainError } from "../errors.js";

const mockVersion = prisma.documentVersion as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
};
const mockSoaTable = prisma.soaTable as unknown as {
  update: ReturnType<typeof vi.fn>;
};

const TENANT = "tenant-aaa";
const TENANT_OTHER = "tenant-bbb";
const OLD_ID = "v-old";
const NEW_ID = "v-new";

interface FakeCell {
  rowIndex: number;
  colIndex: number;
  procedureName: string;
  visitName: string;
  rawValue: string;
  normalizedValue: string;
  manualValue: string | null;
  markerSources: unknown;
}

interface FakeFootnote {
  marker: string;
  markerOrder: number;
  text: string;
  anchors: Array<{ targetType: string; cellId: string | null; rowIndex: number | null; colIndex: number | null }>;
}

function makeVersion(
  id: string,
  tenantId: string,
  tables: Array<{
    id: string;
    headerData: unknown;
    cells: FakeCell[];
    footnotes: FakeFootnote[];
    snapshotJson?: unknown;
  }>,
) {
  return {
    id,
    documentId: "doc-1",
    document: { id: "doc-1", title: "Protocol", study: { tenantId } },
    soaTables: tables.map((t) => ({
      id: t.id,
      headerData: t.headerData,
      cells: t.cells,
      soaFootnotes: t.footnotes,
      snapshotJson: t.snapshotJson ?? null,
    })),
  };
}

function cell(
  procedureName: string,
  visitName: string,
  value: string,
  rowIndex = 0,
  colIndex = 0,
): FakeCell {
  return {
    rowIndex,
    colIndex,
    procedureName,
    visitName,
    rawValue: value,
    normalizedValue: value,
    manualValue: null,
    markerSources: ["text"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSoaTable.update.mockResolvedValue({});
});

describe("soaComparisonService.compareSoaTables", () => {
  it("returns added/removed procedures across versions", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(
        makeVersion(OLD_ID, TENANT, [
          {
            id: "soa-old",
            headerData: { visits: ["Screening", "Visit 1"] },
            cells: [
              cell("Informed consent", "Screening", "X", 0, 0),
              cell("Vital signs", "Visit 1", "X", 1, 1),
            ],
            footnotes: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeVersion(NEW_ID, TENANT, [
          {
            id: "soa-new",
            headerData: { visits: ["Screening", "Visit 1", "Visit 2"] },
            cells: [
              cell("Informed consent", "Screening", "X", 0, 0),
              cell("ECG", "Visit 1", "X", 1, 1),
              cell("ECG", "Visit 2", "X", 1, 2),
            ],
            footnotes: [],
          },
        ]),
      );

    const result = await soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID);
    expect(result.diff.addedProcedures).toEqual(["ECG"]);
    expect(result.diff.removedProcedures).toEqual(["Vital signs"]);
    expect(result.diff.addedVisits).toEqual(["Visit 2"]);
    expect(result.diff.removedVisits).toEqual([]);
    expect(result.diff.unchanged).toBe(false);

    // snapshot caching: both tables are persisted because neither had a cached snapshot.
    expect(mockSoaTable.update).toHaveBeenCalledTimes(2);
  });

  it("does not persist when snapshotJson is already cached", async () => {
    const cached = {
      visits: ["V"],
      procedures: ["P"],
      cells: [{ procedure: "P", visit: "V", value: "X", markerSources: ["text"] }],
      footnotes: [],
    };
    mockVersion.findUnique
      .mockResolvedValueOnce(
        makeVersion(OLD_ID, TENANT, [
          {
            id: "soa-old",
            headerData: { visits: ["V"] },
            cells: [cell("P", "V", "X")],
            footnotes: [],
            snapshotJson: cached,
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeVersion(NEW_ID, TENANT, [
          {
            id: "soa-new",
            headerData: { visits: ["V"] },
            cells: [cell("P", "V", "X")],
            footnotes: [],
            snapshotJson: cached,
          },
        ]),
      );

    const result = await soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID);
    expect(result.diff.unchanged).toBe(true);
    expect(mockSoaTable.update).not.toHaveBeenCalled();
  });

  it("treats absent SoaTable as empty snapshot (added everything)", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID, TENANT, []))
      .mockResolvedValueOnce(
        makeVersion(NEW_ID, TENANT, [
          {
            id: "soa-new",
            headerData: { visits: ["V"] },
            cells: [cell("P", "V", "X")],
            footnotes: [],
          },
        ]),
      );

    const result = await soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID);
    expect(result.diff.addedProcedures).toEqual(["P"]);
    expect(result.diff.removedProcedures).toEqual([]);
    expect(result.diff.unchanged).toBe(false);
  });

  it("rejects when oldVersionId === newVersionId", async () => {
    await expect(
      soaComparisonService.compareSoaTables(TENANT, OLD_ID, OLD_ID),
    ).rejects.toThrow(DomainError);
    expect(mockVersion.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when a version is missing", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeVersion(NEW_ID, TENANT, []));

    await expect(
      soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID),
    ).rejects.toThrow(DomainError);
  });

  it("rejects cross-tenant comparison", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(makeVersion(OLD_ID, TENANT_OTHER, []))
      .mockResolvedValueOnce(makeVersion(NEW_ID, TENANT, []));

    await expect(
      soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID),
    ).rejects.toThrow(DomainError);
  });

  it("merges multiple SoA tables on the same version into a union snapshot", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(
        makeVersion(OLD_ID, TENANT, [
          {
            id: "soa-old-A",
            headerData: { visits: ["Screening"] },
            cells: [cell("Informed consent", "Screening", "X")],
            footnotes: [],
          },
          {
            id: "soa-old-B",
            headerData: { visits: ["Follow-up"] },
            cells: [cell("Safety call", "Follow-up", "X")],
            footnotes: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeVersion(NEW_ID, TENANT, [
          {
            id: "soa-new",
            headerData: { visits: ["Screening", "Follow-up"] },
            cells: [
              cell("Informed consent", "Screening", "X", 0, 0),
              cell("Safety call", "Follow-up", "X", 1, 1),
              cell("ECG", "Screening", "X", 2, 0),
            ],
            footnotes: [],
          },
        ]),
      );

    const result = await soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID);
    expect(result.oldSnapshot.procedures.sort()).toEqual(["Informed consent", "Safety call"]);
    expect(result.diff.addedProcedures).toEqual(["ECG"]);
  });

  it("emits cell changes when an X moves to a different visit", async () => {
    mockVersion.findUnique
      .mockResolvedValueOnce(
        makeVersion(OLD_ID, TENANT, [
          {
            id: "soa-old",
            headerData: { visits: ["Visit 1", "Visit 2"] },
            cells: [
              cell("Vital signs", "Visit 1", "X", 0, 0),
              cell("Vital signs", "Visit 2", "", 0, 1),
            ],
            footnotes: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        makeVersion(NEW_ID, TENANT, [
          {
            id: "soa-new",
            headerData: { visits: ["Visit 1", "Visit 2"] },
            cells: [
              cell("Vital signs", "Visit 1", "", 0, 0),
              cell("Vital signs", "Visit 2", "X", 0, 1),
            ],
            footnotes: [],
          },
        ]),
      );

    const result = await soaComparisonService.compareSoaTables(TENANT, OLD_ID, NEW_ID);
    expect(result.diff.cellChanges).toContainEqual({
      procedure: "Vital signs",
      visit: "Visit 1",
      oldValue: "X",
      newValue: null,
    });
    expect(result.diff.cellChanges).toContainEqual({
      procedure: "Vital signs",
      visit: "Visit 2",
      oldValue: null,
      newValue: "X",
    });
  });
});
