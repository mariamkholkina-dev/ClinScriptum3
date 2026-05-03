import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { detectSoaForVersion } from "@clinscriptum/shared/soa-detection";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

const silentLogger = { info: () => {}, error: () => {} };

// Same simple SoA used in soa-footnotes.test.ts but without footnotes —
// just enough table for the detector to recognise + a known geometry.
const TABLE_HTML = `<table>
  <tr><th>Процедура</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4</th></tr>
  <tr><td>День</td><td>D1</td><td>D7</td><td>D14</td><td>D28</td></tr>
  <tr><td>Informed consent</td><td>X</td><td></td><td></td><td></td></tr>
  <tr><td>Vital signs</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>ECG</td><td>X</td><td></td><td>X</td><td></td></tr>
  <tr><td>Blood test</td><td>X</td><td></td><td>X</td><td></td></tr>
  <tr><td>Drug administration</td><td></td><td></td><td></td><td></td></tr>
</table>`;

const ONE_INCH = 914400;

// Fake EMU layout: 6 cols × 7 rows (header + day + 5 procedure rows).
// Each col 1in wide, each row 0.25in tall, table starts at (0, 0).
function makeGeometry(): unknown {
  const cells: Array<Array<{
    rowIndex: number;
    colIndex: number;
    xEmu: number;
    yEmu: number;
    cxEmu: number;
    cyEmu: number;
  }>> = [];
  const colW = ONE_INCH;
  const rowH = ONE_INCH / 4;
  for (let r = 0; r < 7; r++) {
    const row: Array<{
      rowIndex: number;
      colIndex: number;
      xEmu: number;
      yEmu: number;
      cxEmu: number;
      cyEmu: number;
    }> = [];
    for (let c = 0; c < 6; c++) {
      row.push({
        rowIndex: r,
        colIndex: c,
        xEmu: c * colW,
        yEmu: r * rowH,
        cxEmu: colW,
        cyEmu: rowH,
      });
    }
    cells.push(row);
  }
  return [{ tableIndex: 0, cells }];
}

describe("SoA drawings wire-up (integration)", () => {
  let versionId: string;

  async function setupVersionWithSoa(
    digitalTwin: { drawings: unknown[]; tableGeometries: unknown },
  ): Promise<string> {
    const user = await registerUser(
      "soa-draw@example.com",
      "password123",
      "Drawings Tester",
      "Drawings Org",
    );
    const caller = createCaller(verifyAccessToken(user.accessToken));
    const study = await caller.study.create({ title: "Drawings Study" });
    const doc = await caller.document.create({
      studyId: study.id,
      type: "protocol",
      title: "Drawings Protocol",
    });
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        versionLabel: "v1.0",
        status: "ready",
        fileUrl: "test://drawings.docx",
        digitalTwin: digitalTwin as object,
      },
    });

    const section = await prisma.section.create({
      data: {
        docVersionId: version.id,
        title: "Schedule of Activities",
        level: 1,
        order: 0,
        sourceAnchor: { paragraphIndex: 0, textSnippet: "" },
      },
    });
    await prisma.contentBlock.createMany({
      data: [
        {
          sectionId: section.id,
          type: "paragraph",
          content: "Schedule of Activities",
          rawHtml: "<p>Schedule of Activities</p>",
          order: 0,
          sourceAnchor: { paragraphIndex: 0, textSnippet: "Schedule" },
        },
        {
          sectionId: section.id,
          type: "table",
          content: "table",
          rawHtml: TABLE_HTML,
          order: 1,
          sourceAnchor: { paragraphIndex: 1, textSnippet: "table" },
        },
      ],
    });
    return version.id;
  }

  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("does not crash and writes empty cellGeometry/drawings when digitalTwin is empty", async () => {
    versionId = await setupVersionWithSoa({ drawings: [], tableGeometries: [] });
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({ where: { docVersionId: versionId } });
    expect(tables).toHaveLength(1);
    expect(tables[0].cellGeometry).toBeNull();
    expect(tables[0].drawings).toEqual([]);
    await cleanupTestData();
  });

  it("persists cellGeometry from digitalTwin onto SoaTable", async () => {
    versionId = await setupVersionWithSoa({
      drawings: [],
      tableGeometries: makeGeometry(),
    });
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({ where: { docVersionId: versionId } });
    expect(tables).toHaveLength(1);
    const geom = tables[0].cellGeometry as Array<Array<{ rowIndex: number } | null>>;
    expect(Array.isArray(geom)).toBe(true);
    expect(geom).toHaveLength(7);
    expect(geom[0]).toHaveLength(6);
    expect(geom[3][2]).toMatchObject({ rowIndex: 3, colIndex: 2 });
    await cleanupTestData();
  });

  it("a horizontal arrow over Drug administration row promotes empty cells to X with markerSources arrow", async () => {
    // Procedure index 4 (Drug administration), spanning visits 0..3 (cols 1..4).
    // y for row 4 (Drug admin in canonical with header counted) = 4 * 0.25in;
    // wait — buildSoaResult drops header rows (Visit + Day = 2 header rows).
    // Drug admin appears as procedure index 4 in the matrix (Informed consent=0,
    // Vital signs=1, ECG=2, Blood test=3, Drug administration=4) — but in
    // geometry terms it's the 6th row (index 6) of the original table:
    //   row 0: Procedure header
    //   row 1: Day subheader
    //   row 2: Informed consent
    //   row 3: Vital signs
    //   row 4: ECG
    //   row 5: Blood test
    //   row 6: Drug administration
    // The arrow needs to overlap at least 60% of cells (1..4) of row 6.
    const colW = ONE_INCH;
    const rowH = ONE_INCH / 4;
    const drawing = {
      type: "arrow",
      position: {
        // Start at col 1 (x=1in), span cols 1..4 (4in wide).
        xEmu: 1 * colW,
        yEmu: 6 * rowH,
        cxEmu: 4 * colW,
        // Cover the full row height vertically.
        cyEmu: rowH,
      },
      direction: "horizontal",
      paragraphIndex: 0,
      prstGeom: "rightArrow",
    };

    versionId = await setupVersionWithSoa({
      drawings: [drawing],
      tableGeometries: makeGeometry(),
    });
    await detectSoaForVersion(versionId, silentLogger);

    const cells = await prisma.soaCell.findMany({
      where: { soaTable: { docVersionId: versionId } },
      orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }],
    });

    // matrix-row 4 = Drug administration (procedure index in detector
    // matrix), originally empty in TABLE_HTML.
    const drugRow = cells.filter((c) => c.procedureName === "Drug administration");
    expect(drugRow).toHaveLength(4);

    // All four visits should now have markerSources containing 'arrow'
    // and normalizedValue='X' with confidence=0.85.
    for (const c of drugRow) {
      const sources = c.markerSources as string[];
      expect(sources).toContain("arrow");
      expect(c.normalizedValue).toBe("X");
      expect(c.confidence).toBeCloseTo(0.85, 2);
    }
    await cleanupTestData();
  });

  it("does not overwrite explicit X cells (additive markerSources only)", async () => {
    // Same arrow over Vital signs row (matrix row 1, geometry row 3),
    // which already has all X. Expect markerSources to gain 'arrow' but
    // normalizedValue stays 'X' and confidence not lowered.
    const colW = ONE_INCH;
    const rowH = ONE_INCH / 4;
    const drawing = {
      type: "arrow",
      position: {
        xEmu: 1 * colW,
        yEmu: 3 * rowH,
        cxEmu: 4 * colW,
        cyEmu: rowH,
      },
      direction: "horizontal",
      paragraphIndex: 0,
      prstGeom: "rightArrow",
    };

    versionId = await setupVersionWithSoa({
      drawings: [drawing],
      tableGeometries: makeGeometry(),
    });
    await detectSoaForVersion(versionId, silentLogger);

    const vitalsCells = await prisma.soaCell.findMany({
      where: {
        soaTable: { docVersionId: versionId },
        procedureName: "Vital signs",
      },
      orderBy: { colIndex: "asc" },
    });

    expect(vitalsCells).toHaveLength(4);
    for (const c of vitalsCells) {
      const sources = c.markerSources as string[];
      expect(sources).toContain("arrow");
      expect(sources).toContain("text");
      expect(c.normalizedValue).toBe("X");
      // Confidence not downgraded — original value was textual X.
      expect(c.confidence).toBeGreaterThanOrEqual(0.9);
    }
    await cleanupTestData();
  });

  it("native Word footnote refs in cellGeometry create wfn-N anchors with bodies from wordFootnotes", async () => {
    // Inject footnoteRefs into the geometry of one cell and provide a
    // matching body via wordFootnotes. The detector must produce a
    // SoaFootnote with marker `wfn-1` and body, and a SoaFootnoteAnchor
    // pointing at the (rowIndex, colIndex) cell.
    const geom = makeGeometry() as Array<{
      tableIndex: number;
      cells: Array<Array<{ rowIndex: number; colIndex: number; xEmu: number; yEmu: number; cxEmu: number; cyEmu: number; footnoteRefs?: string[] } | null>>;
    }>;
    // Geometry row 3 = Vital signs (after header rows 0..1). Add fn ref
    // to col 1 (Visit 1).
    geom[0].cells[3][1]!.footnoteRefs = ["1"];

    versionId = await setupVersionWithSoa({
      drawings: [],
      tableGeometries: geom,
      // @ts-expect-error wordFootnotes is a valid digitalTwin extension picked up by detectSoaForVersion
      wordFootnotes: { "1": "Performed before drug administration." },
    });
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
      include: { soaFootnotes: true, footnoteAnchors: true },
    });
    expect(tables).toHaveLength(1);
    const fn = tables[0].soaFootnotes.find((f) => f.marker === "wfn-1");
    expect(fn).toBeDefined();
    expect(fn!.text).toBe("Performed before drug administration.");

    const anchor = tables[0].footnoteAnchors.find(
      (a) => a.footnoteId === fn!.id,
    );
    expect(anchor).toBeDefined();
    expect(anchor!.targetType).toBe("cell");
    // For cell-typed anchors persistSoaTables stores the resolved
    // cellId; row/colIndex stay null. Look up the cell to verify the
    // anchor lands on Vital signs / Visit 1.
    expect(anchor!.cellId).not.toBeNull();
    const cell = await prisma.soaCell.findUnique({
      where: { id: anchor!.cellId! },
    });
    expect(cell).not.toBeNull();
    expect(cell!.procedureName).toBe("Vital signs");
    // Multi-level header builder joins the visit name with the day row.
    expect(cell!.visitName).toContain("Visit 1");
    await cleanupTestData();
  });

  it("ignores image drawings", async () => {
    const drawing = {
      type: "image",
      position: { xEmu: 0, yEmu: 0, cxEmu: 6 * ONE_INCH, cyEmu: 7 * (ONE_INCH / 4) },
      paragraphIndex: 0,
    };
    versionId = await setupVersionWithSoa({
      drawings: [drawing],
      tableGeometries: makeGeometry(),
    });
    await detectSoaForVersion(versionId, silentLogger);

    const cells = await prisma.soaCell.findMany({
      where: { soaTable: { docVersionId: versionId } },
    });
    // No cell should gain 'arrow'/'line'/'bracket' — image is ignored.
    for (const c of cells) {
      const sources = c.markerSources as string[];
      expect(sources.every((s) => s === "text")).toBe(true);
    }
    await cleanupTestData();
  });
});
