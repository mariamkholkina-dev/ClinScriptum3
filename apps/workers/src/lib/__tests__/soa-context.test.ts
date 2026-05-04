import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clinscriptum/db", () => ({
  prisma: { soaTable: { findMany: vi.fn() } },
}));

import { prisma } from "@clinscriptum/db";
import { formatSoaContext, loadSoaContextForVersion } from "../soa-context.js";
import type { SoaSnapshot } from "@clinscriptum/shared";

const mockSoaTable = prisma.soaTable as unknown as {
  findMany: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatSoaContext", () => {
  it("returns null when snapshot has no procedures", () => {
    const snap: SoaSnapshot = { visits: [], procedures: [], cells: [], footnotes: [] };
    expect(formatSoaContext(snap)).toBeNull();
  });

  it("formats procedures grouped by visits in canonical visit order", () => {
    const snap: SoaSnapshot = {
      visits: ["Screening", "Visit 1", "Visit 2"],
      procedures: ["Informed consent", "Vital signs"],
      cells: [
        // Out-of-order to make sure visit-order beats cell-order:
        { procedure: "Vital signs", visit: "Visit 2", value: "X", markerSources: ["text"] },
        { procedure: "Vital signs", visit: "Visit 1", value: "X", markerSources: ["text"] },
        { procedure: "Informed consent", visit: "Screening", value: "X", markerSources: ["text"] },
      ],
      footnotes: [],
    };
    const text = formatSoaContext(snap);
    expect(text).toContain("PROCEDURES SCHEDULE (FROM SOA):");
    expect(text).toContain("- Informed consent: Screening");
    // Visits must come in canonical order even though cells were unsorted.
    expect(text).toContain("- Vital signs: Visit 1, Visit 2");
  });

  it("appends FOOTNOTES section when footnotes are present", () => {
    const snap: SoaSnapshot = {
      visits: ["Screening"],
      procedures: ["Blood draw"],
      cells: [{ procedure: "Blood draw", visit: "Screening", value: "X", markerSources: ["text"] }],
      footnotes: [
        { marker: "1", text: "Required only on fasted visits", anchors: [] },
        { marker: "2", text: "", anchors: [] }, // empty text — should be filtered out
      ],
    };
    const text = formatSoaContext(snap)!;
    expect(text).toContain("FOOTNOTES:");
    expect(text).toContain("[1] Required only on fasted visits");
    expect(text).not.toContain("[2]");
  });

  it("handles a procedure with no scheduled visits (declared in `procedures` but no cells)", () => {
    const snap: SoaSnapshot = {
      visits: ["Visit 1"],
      procedures: ["Optional procedure"],
      cells: [],
      footnotes: [],
    };
    const text = formatSoaContext(snap)!;
    expect(text).toContain("- Optional procedure: (not scheduled in any visit)");
  });
});

describe("loadSoaContextForVersion", () => {
  const VERSION_ID = "v-1";

  it("returns null text when version has no SoA tables", async () => {
    mockSoaTable.findMany.mockResolvedValueOnce([]);
    const result = await loadSoaContextForVersion(VERSION_ID);
    expect(result.text).toBeNull();
    expect(result.snapshot.procedures).toEqual([]);
  });

  it("merges multiple SoA tables on one version into a union snapshot", async () => {
    mockSoaTable.findMany.mockResolvedValueOnce([
      {
        headerData: { visits: ["Screening"] },
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
        ],
        soaFootnotes: [],
      },
      {
        headerData: { visits: ["Follow-up"] },
        cells: [
          {
            rowIndex: 0,
            colIndex: 0,
            procedureName: "Safety call",
            visitName: "Follow-up",
            rawValue: "X",
            normalizedValue: "X",
            manualValue: null,
            markerSources: ["text"],
          },
        ],
        soaFootnotes: [],
      },
    ]);

    const result = await loadSoaContextForVersion(VERSION_ID);
    expect(result.snapshot.procedures.sort()).toEqual(["Informed consent", "Safety call"]);
    expect(result.text).toContain("Informed consent: Screening");
    expect(result.text).toContain("Safety call: Follow-up");
  });

  it("queries soaTable.findMany filtered by docVersionId, ordered by createdAt asc", async () => {
    mockSoaTable.findMany.mockResolvedValueOnce([]);
    await loadSoaContextForVersion(VERSION_ID);
    expect(mockSoaTable.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { docVersionId: VERSION_ID },
        orderBy: { createdAt: "asc" },
      }),
    );
  });
});
