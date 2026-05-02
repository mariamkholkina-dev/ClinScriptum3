import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { detectSoaForVersion } from "@clinscriptum/shared/soa-detection";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

const silentLogger = { info: () => {}, error: () => {} };

// Canonical visits-in-columns SoA. First row = visit names, first column =
// procedure names. The detector should keep orientation = visits_cols.
const COLS_TABLE_HTML = `<table>
  <tr><th>Процедура</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4</th></tr>
  <tr><td>День</td><td>D1</td><td>D7</td><td>D14</td><td>D28</td></tr>
  <tr><td>Informed consent</td><td>X</td><td></td><td></td><td></td></tr>
  <tr><td>Vital signs</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>ECG</td><td>X</td><td></td><td>X</td><td>X</td></tr>
  <tr><td>Blood test</td><td>X</td><td></td><td>X</td><td></td></tr>
  <tr><td>Drug administration</td><td></td><td>X</td><td>X</td><td>X</td></tr>
</table>`;

// Same data transposed: first row = procedures, first column = visits.
// detectOrientation should return 'visits_rows' and the detector should
// transpose to canonical form before scoring.
const ROWS_TABLE_HTML = `<table>
  <tr><th>Визит</th><th>Informed consent</th><th>Vital signs</th><th>ECG</th><th>Blood test</th><th>Drug administration</th></tr>
  <tr><td>Visit 1</td><td>X</td><td>X</td><td>X</td><td>X</td><td></td></tr>
  <tr><td>Visit 2</td><td></td><td>X</td><td></td><td></td><td>X</td></tr>
  <tr><td>Visit 3</td><td></td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>Visit 4</td><td></td><td>X</td><td>X</td><td></td><td>X</td></tr>
</table>`;

interface TableSetup {
  versionId: string;
  studyId: string;
}

async function setupVersionWithTable(
  caller: ReturnType<typeof createCaller>,
  studyTitle: string,
  tableHtml: string,
): Promise<TableSetup> {
  const study = await caller.study.create({ title: studyTitle });
  const doc = await caller.document.create({
    studyId: study.id,
    type: "protocol",
    title: `${studyTitle} Protocol`,
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      versionLabel: "v1.0",
      status: "ready",
      fileUrl: `test://${studyTitle}.docx`,
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
        rawHtml: tableHtml,
        order: 1,
        sourceAnchor: { paragraphIndex: 1, textSnippet: "table" },
      },
    ],
  });
  return { versionId: version.id, studyId: study.id };
}

describe("SoA orientation detection (integration)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe("canonical layout (visits in columns)", () => {
    let versionId: string;

    beforeAll(async () => {
      const user = await registerUser(
        "soa-orient-cols@example.com",
        "password123",
        "Cols Tester",
        "SoA Orient Cols",
      );
      const caller = createCaller(verifyAccessToken(user.accessToken));
      const setup = await setupVersionWithTable(caller, "Cols Study", COLS_TABLE_HTML);
      versionId = setup.versionId;
      await detectSoaForVersion(versionId, silentLogger);
    });

    it("detects orientation = visits_cols and orientationConflict = false", async () => {
      const tables = await prisma.soaTable.findMany({ where: { docVersionId: versionId } });
      expect(tables).toHaveLength(1);
      expect(tables[0].orientation).toBe("visits_cols");
      expect(tables[0].orientationConflict).toBe(false);
    });

    it("preserves visits in headerData.visits", async () => {
      const tables = await prisma.soaTable.findMany({ where: { docVersionId: versionId } });
      const headerData = tables[0].headerData as { visits: string[] };
      expect(headerData.visits.length).toBeGreaterThanOrEqual(4);
      expect(headerData.visits[0]).toContain("Visit 1");
    });
  });

  describe("transposed layout (visits in rows)", () => {
    let versionId: string;

    beforeAll(async () => {
      const user = await registerUser(
        "soa-orient-rows@example.com",
        "password123",
        "Rows Tester",
        "SoA Orient Rows",
      );
      const caller = createCaller(verifyAccessToken(user.accessToken));
      const setup = await setupVersionWithTable(caller, "Rows Study", ROWS_TABLE_HTML);
      versionId = setup.versionId;
      await detectSoaForVersion(versionId, silentLogger);
    });

    it("detects orientation = visits_rows and stores it on the SoaTable row", async () => {
      const tables = await prisma.soaTable.findMany({ where: { docVersionId: versionId } });
      expect(tables).toHaveLength(1);
      expect(tables[0].orientation).toBe("visits_rows");
      expect(tables[0].orientationConflict).toBe(false);
    });

    it("transposes to canonical form so visits land in headerData.visits", async () => {
      const tables = await prisma.soaTable.findMany({
        where: { docVersionId: versionId },
        include: { cells: true },
      });
      const headerData = tables[0].headerData as { visits: string[] };
      // After transpose, the original first column (Visit 1..4) becomes the
      // visit list.
      expect(headerData.visits.some((v) => v.includes("Visit 1"))).toBe(true);
      expect(headerData.visits.some((v) => v.includes("Visit 4"))).toBe(true);

      // Procedure names land on the cell rows.
      const procedureNames = new Set(tables[0].cells.map((c) => c.procedureName));
      expect(procedureNames.has("Informed consent")).toBe(true);
      expect(procedureNames.has("Vital signs")).toBe(true);
    });
  });

  describe("mixed orientations across multiple SoA tables", () => {
    let versionId: string;

    beforeAll(async () => {
      const user = await registerUser(
        "soa-orient-mixed@example.com",
        "password123",
        "Mixed Tester",
        "SoA Orient Mixed",
      );
      const caller = createCaller(verifyAccessToken(user.accessToken));
      const study = await caller.study.create({ title: "Mixed Study" });
      const doc = await caller.document.create({
        studyId: study.id,
        type: "protocol",
        title: "Mixed Protocol",
      });
      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 1,
          versionLabel: "v1.0",
          status: "ready",
          fileUrl: "test://mixed.docx",
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
            content: "Cohort A schedule",
            rawHtml: "<p>Schedule of Activities — Cohort A</p>",
            order: 0,
            sourceAnchor: { paragraphIndex: 0, textSnippet: "" },
          },
          {
            sectionId: section.id,
            type: "table",
            content: "cols table",
            rawHtml: COLS_TABLE_HTML,
            order: 1,
            sourceAnchor: { paragraphIndex: 1, textSnippet: "" },
          },
          {
            sectionId: section.id,
            type: "paragraph",
            content: "Cohort B schedule",
            rawHtml: "<p>Schedule of Activities — Cohort B</p>",
            order: 2,
            sourceAnchor: { paragraphIndex: 2, textSnippet: "" },
          },
          {
            sectionId: section.id,
            type: "table",
            content: "rows table",
            rawHtml: ROWS_TABLE_HTML,
            order: 3,
            sourceAnchor: { paragraphIndex: 3, textSnippet: "" },
          },
        ],
      });

      await detectSoaForVersion(versionId, silentLogger);
    });

    it("flags non-canonical tables with orientationConflict = true and keeps cols clean", async () => {
      const tables = await prisma.soaTable.findMany({
        where: { docVersionId: versionId },
        orderBy: { createdAt: "asc" },
      });
      expect(tables.length).toBe(2);

      const cols = tables.find((t) => t.orientation === "visits_cols");
      const rows = tables.find((t) => t.orientation === "visits_rows");
      expect(cols).toBeDefined();
      expect(rows).toBeDefined();

      expect(cols!.orientationConflict).toBe(false);
      expect(rows!.orientationConflict).toBe(true);
    });
  });
});
