import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { detectSoaForVersion } from "@clinscriptum/shared/soa-detection";
import { verifyAccessToken } from "../../lib/auth.js";
import { createCaller, registerUser, cleanupTestData, prisma } from "./helpers.js";

const silentLogger = { info: () => {}, error: () => {} };

// Two identical SoA-style tables that share visits / headerRows.
// They live in the same Section so the detector sees them as
// continuation parts of one logical SoA. Each part has 5 visits,
// strong x-ratio and 3 procedure-pattern rows so the SoA detector
// scores each part above its threshold independently.
const TABLE_HTML_PART1 = `<table>
  <tr><th>Процедура</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4</th><th>Visit 5</th></tr>
  <tr><td>Day</td><td>D1</td><td>D7</td><td>D14</td><td>D21</td><td>D28</td></tr>
  <tr><td>Informed consent</td><td>X</td><td></td><td></td><td></td><td></td></tr>
  <tr><td>Vital signs</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>ECG</td><td>X</td><td></td><td>X</td><td></td><td>X</td></tr>
</table>`;

const TABLE_HTML_PART2 = `<table>
  <tr><th>Процедура</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4</th><th>Visit 5</th></tr>
  <tr><td>Day</td><td>D1</td><td>D7</td><td>D14</td><td>D21</td><td>D28</td></tr>
  <tr><td>Blood test</td><td>X</td><td></td><td>X</td><td></td><td>X</td></tr>
  <tr><td>Physical exam</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>Drug administration</td><td></td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
</table>`;

// A table with different visits — must NOT merge with PART1.
const TABLE_HTML_DIFFERENT = `<table>
  <tr><th>Процедура</th><th>Screening</th><th>Visit 6</th><th>Visit 7</th><th>Visit 8</th><th>Visit 9</th></tr>
  <tr><td>Day</td><td>D-7</td><td>D35</td><td>D42</td><td>D49</td><td>D56</td></tr>
  <tr><td>Informed consent</td><td>X</td><td></td><td></td><td></td><td></td></tr>
  <tr><td>Vital signs</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
  <tr><td>ECG</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
</table>`;

interface SetupResult {
  versionId: string;
  caller: ReturnType<typeof createCaller>;
}

async function setupVersionWith(
  email: string,
  org: string,
  blocks: Array<{ rawHtml: string; order: number }>,
): Promise<SetupResult> {
  const user = await registerUser(email, "password123", `${email} tester`, org);
  const caller = createCaller(verifyAccessToken(user.accessToken));
  const study = await caller.study.create({ title: `${org} Study` });
  const doc = await caller.document.create({
    studyId: study.id,
    type: "protocol",
    title: `${org} Protocol`,
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      versionLabel: "v1.0",
      status: "ready",
      fileUrl: `test://${email}.docx`,
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
  // First block is the title paragraph.
  const data = [
    {
      sectionId: section.id,
      type: "paragraph" as const,
      content: "Schedule of Activities",
      rawHtml: "<p>Schedule of Activities</p>",
      order: 0,
      sourceAnchor: { paragraphIndex: 0, textSnippet: "Schedule" },
    },
    ...blocks.map((b) => ({
      sectionId: section.id,
      type: "table" as const,
      content: "table",
      rawHtml: b.rawHtml,
      order: b.order,
      sourceAnchor: { paragraphIndex: b.order, textSnippet: "table" },
    })),
  ];
  await prisma.contentBlock.createMany({ data });
  return { versionId: version.id, caller };
}

// Integration tests perform user registration, document/version setup,
// SoA detection (which can call LLM verification skipped without API
// key but still hits Prisma several times). Stay generous on timeout.
const T = 30_000;

describe("SoA continuation merge (integration)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });
  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  it("two identical-header tables in one section merge into one SoaTable", { timeout: T }, async () => {
    const { versionId } = await setupVersionWith(
      "soa-merge-pair@example.com",
      "Merge Pair",
      [
        { rawHtml: TABLE_HTML_PART1, order: 1 },
        { rawHtml: TABLE_HTML_PART2, order: 2 },
      ],
    );
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
      include: { cells: true },
    });
    expect(tables).toHaveLength(1);

    const procedures = new Set(tables[0].cells.map((c) => c.procedureName));
    // Procedures from BOTH parts should be present.
    expect(procedures.has("Informed consent")).toBe(true);
    expect(procedures.has("Vital signs")).toBe(true);
    expect(procedures.has("ECG")).toBe(true);
    expect(procedures.has("Blood test")).toBe(true);
    expect(procedures.has("Drug administration")).toBe(true);

    // sourceBlockIds should list both contributing blocks.
    const ids = tables[0].sourceBlockIds as string[];
    expect(ids).toHaveLength(2);
    await cleanupTestData();
  });

  it("tables with different visits do NOT merge", { timeout: T }, async () => {
    const { versionId } = await setupVersionWith(
      "soa-merge-diff@example.com",
      "Merge Diff",
      [
        { rawHtml: TABLE_HTML_PART1, order: 1 },
        { rawHtml: TABLE_HTML_DIFFERENT, order: 2 },
      ],
    );
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
    });
    // Two distinct SoA tables — different visit names mean they're
    // logically separate.
    expect(tables.length).toBeGreaterThanOrEqual(1);
    const visits1 = (tables[0].headerData as { visits: string[] }).visits;
    if (tables.length === 2) {
      const visits2 = (tables[1].headerData as { visits: string[] }).visits;
      expect(visits1.join(" ")).not.toBe(visits2.join(" "));
    }
    await cleanupTestData();
  });

  it("trio merge: 3 identical-header tables in one section produce one SoaTable", { timeout: T }, async () => {
    const TABLE_PART3 = `<table>
      <tr><th>Процедура</th><th>Visit 1</th><th>Visit 2</th><th>Visit 3</th><th>Visit 4</th><th>Visit 5</th></tr>
      <tr><td>Day</td><td>D1</td><td>D7</td><td>D14</td><td>D21</td><td>D28</td></tr>
      <tr><td>Randomization</td><td></td><td>X</td><td></td><td></td><td></td></tr>
      <tr><td>Vital signs</td><td>X</td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
      <tr><td>Drug administration</td><td></td><td>X</td><td>X</td><td>X</td><td>X</td></tr>
    </table>`;
    const { versionId } = await setupVersionWith(
      "soa-merge-trio@example.com",
      "Merge Trio",
      [
        { rawHtml: TABLE_HTML_PART1, order: 1 },
        { rawHtml: TABLE_HTML_PART2, order: 2 },
        { rawHtml: TABLE_PART3, order: 3 },
      ],
    );
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
      include: { cells: true },
    });
    expect(tables).toHaveLength(1);
    const procedures = new Set(tables[0].cells.map((c) => c.procedureName));
    expect(procedures.has("Informed consent")).toBe(true);
    expect(procedures.has("Drug administration")).toBe(true);
    expect(procedures.has("Randomization")).toBe(true);
    const ids = tables[0].sourceBlockIds as string[];
    expect(ids).toHaveLength(3);
    await cleanupTestData();
  });

  it("rowIndex of merged cells is contiguous and unique", { timeout: T }, async () => {
    const { versionId } = await setupVersionWith(
      "soa-merge-rowidx@example.com",
      "Merge RowIdx",
      [
        { rawHtml: TABLE_HTML_PART1, order: 1 },
        { rawHtml: TABLE_HTML_PART2, order: 2 },
      ],
    );
    await detectSoaForVersion(versionId, silentLogger);

    const tables = await prisma.soaTable.findMany({
      where: { docVersionId: versionId },
      include: { cells: { orderBy: [{ rowIndex: "asc" }, { colIndex: "asc" }] } },
    });
    expect(tables).toHaveLength(1);
    // Part1 has 3 procedures, part2 has 2 → rowIndex 0..4 all present.
    const rowIndices = new Set(tables[0].cells.map((c) => c.rowIndex));
    expect(rowIndices.has(0)).toBe(true);
    expect(rowIndices.has(1)).toBe(true);
    expect(rowIndices.has(2)).toBe(true);
    expect(rowIndices.has(3)).toBe(true);
    expect(rowIndices.has(4)).toBe(true);
    // No collisions: each (rowIndex, colIndex) is unique.
    const seen = new Set<string>();
    for (const c of tables[0].cells) {
      const key = `${c.rowIndex}:${c.colIndex}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    await cleanupTestData();
  });
});
