import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { detectSoaForVersion } from "@clinscriptum/shared/soa-detection";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

const TABLE_HTML = `<table>
  <tr><th>Визит</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4<sup>2</sup></th></tr>
  <tr><td>День</td><td>D1</td><td>D7</td><td>D14</td><td>D28</td></tr>
  <tr><td>Informed consent</td><td>X</td><td></td><td></td><td></td></tr>
  <tr><td>Vital signs</td><td>X</td><td>X</td><td>X<sup>1</sup></td><td>X</td></tr>
  <tr><td>ECG</td><td>X</td><td>X<sup>*</sup></td><td>X</td><td>X</td></tr>
  <tr><td>Blood test</td><td>X</td><td></td><td>X</td><td></td></tr>
  <tr><td>Drug administration</td><td></td><td>X</td><td>X</td><td>X</td></tr>
</table>`;

const FOOTNOTE_BLOCK_HTML =
  "<p>1. After signing ICF.</p>" +
  "<p>* If applicable.</p>" +
  "<p>2. Optional unscheduled visit.</p>";

const silentLogger = { info: () => {}, error: () => {} };

describe("SoA footnote detection (integration)", () => {
  let versionId: string;
  let tableId: string;

  beforeAll(async () => {
    await cleanupTestData();

    const user = await registerUser(
      "soa-fn-test@example.com",
      "password123",
      "SoA Tester",
      "SoA Org",
    );
    const caller = createCaller(verifyAccessToken(user.accessToken));
    const study = await caller.study.create({ title: "SoA Footnote Study" });
    const doc = await caller.document.create({
      studyId: study.id,
      type: "protocol",
      title: "SoA Footnote Protocol",
    });

    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        versionNumber: 1,
        versionLabel: "v1.0",
        status: "ready",
        fileUrl: "test://soa-footnote-fixture.docx",
      },
    });
    versionId = version.id;

    const section = await prisma.section.create({
      data: {
        docVersionId: versionId,
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
          sourceAnchor: { paragraphIndex: 0, textSnippet: "Schedule of Activities" },
        },
        {
          sectionId: section.id,
          type: "table",
          content: "table",
          rawHtml: TABLE_HTML,
          order: 1,
          sourceAnchor: { paragraphIndex: 1, textSnippet: "table" },
        },
        {
          sectionId: section.id,
          type: "paragraph",
          content: "footnote block",
          rawHtml: FOOTNOTE_BLOCK_HTML,
          order: 2,
          sourceAnchor: { paragraphIndex: 2, textSnippet: "footnote block" },
        },
      ],
    });

    await detectSoaForVersion(versionId, silentLogger);

    const detectedTable = await prisma.soaTable.findFirstOrThrow({
      where: { docVersionId: versionId },
    });
    tableId = detectedTable.id;
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("detects exactly one SoaTable with three footnotes ordered by definition", async () => {
    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
      include: { soaFootnotes: { orderBy: { markerOrder: "asc" } } },
    });
    expect(tables).toHaveLength(1);
    const markers = tables[0].soaFootnotes.map((f) => f.marker);
    expect(markers).toEqual(["1", "*", "2"]);
    const texts = tables[0].soaFootnotes.map((f) => f.text);
    expect(texts[0]).toContain("After signing ICF");
    expect(texts[1]).toContain("If applicable");
    expect(texts[2]).toContain("Optional unscheduled");
    for (const f of tables[0].soaFootnotes) {
      expect(f.source).toBe("detected");
    }
  });

  it("creates a column anchor for the marker on Visit 4 header", async () => {
    const colAnchors = await prisma.soaFootnoteAnchor.findMany({
      where: { soaTableId: tableId, targetType: "col" },
      include: { footnote: true },
    });
    expect(colAnchors).toHaveLength(1);
    expect(colAnchors[0].footnote.marker).toBe("2");
    expect(colAnchors[0].colIndex).toBe(3);
    expect(colAnchors[0].cellId).toBeNull();
    expect(colAnchors[0].rowIndex).toBeNull();
  });

  it("creates cell anchors with resolved cellId for inline cell markers", async () => {
    const cellAnchors = await prisma.soaFootnoteAnchor.findMany({
      where: { soaTableId: tableId, targetType: "cell" },
      include: { footnote: true, cell: true },
    });
    expect(cellAnchors.length).toBeGreaterThanOrEqual(2);

    const fn1Anchor = cellAnchors.find((a) => a.footnote.marker === "1");
    expect(fn1Anchor).toBeDefined();
    expect(fn1Anchor!.cellId).toBeTruthy();
    expect(fn1Anchor!.cell?.procedureName).toBe("Vital signs");
    expect(fn1Anchor!.cell?.colIndex).toBe(2);

    const fnStarAnchor = cellAnchors.find((a) => a.footnote.marker === "*");
    expect(fnStarAnchor).toBeDefined();
    expect(fnStarAnchor!.cellId).toBeTruthy();
    expect(fnStarAnchor!.cell?.procedureName).toBe("ECG");
    expect(fnStarAnchor!.cell?.colIndex).toBe(1);
  });

  it("strips inline markers from cell rawValue and visit name", async () => {
    const table = await prisma.soaTable.findUniqueOrThrow({
      where: { id: tableId },
      include: { cells: true },
    });

    const headerData = table.headerData as { visits: string[] };
    expect(headerData.visits[3]).toBe("Visit 4 / D28");
    expect(headerData.visits[3]).not.toContain("<sup>");

    const fn1Cell = table.cells.find(
      (c) => c.procedureName === "Vital signs" && c.colIndex === 2,
    );
    expect(fn1Cell?.rawValue).toBe("X");
    const fnStarCell = table.cells.find(
      (c) => c.procedureName === "ECG" && c.colIndex === 1,
    );
    expect(fnStarCell?.rawValue).toBe("X");
  });

  it("cascade-deletes footnotes and anchors when SoaTable is removed", async () => {
    await prisma.soaTable.delete({ where: { id: tableId } });
    const fn = await prisma.soaFootnote.count({ where: { soaTableId: tableId } });
    const anchors = await prisma.soaFootnoteAnchor.count({ where: { soaTableId: tableId } });
    expect(fn).toBe(0);
    expect(anchors).toBe(0);
  });
});
