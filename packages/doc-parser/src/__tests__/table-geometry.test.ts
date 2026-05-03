import { describe, it, expect } from "vitest";
import { extractTableGeometry } from "../table-geometry.js";

const WRAPPER_PREFIX = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>`;
const WRAPPER_SUFFIX = `</w:body></w:document>`;

function wrap(body: string): string {
  return `${WRAPPER_PREFIX}${body}${WRAPPER_SUFFIX}`;
}

const DXA_TO_EMU = 635;

describe("extractTableGeometry", () => {
  it("returns empty array for malformed input", () => {
    expect(extractTableGeometry("<not-xml")).toEqual([]);
    expect(extractTableGeometry("")).toEqual([]);
  });

  it("returns empty array when document has no tables", () => {
    const xml = wrap(`<w:p><w:r><w:t>Just text</w:t></w:r></w:p>`);
    expect(extractTableGeometry(xml)).toEqual([]);
  });

  it("extracts a 5-column tblGrid with varying widths", () => {
    // Widths in DXA: 2000, 1500, 1500, 2500, 2500 (total 10000 DXA = 6_350_000 EMU).
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="1500"/>
          <w:gridCol w:w="1500"/>
          <w:gridCol w:w="2500"/>
          <w:gridCol w:w="2500"/>
        </w:tblGrid>
        <w:tr>
          <w:trPr><w:trHeight w:val="500" w:hRule="exact"/></w:trPr>
          <w:tc/><w:tc/><w:tc/><w:tc/><w:tc/>
        </w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result).toHaveLength(1);
    expect(result[0].cells).toHaveLength(1);
    const row = result[0].cells[0];
    expect(row).toHaveLength(5);

    // Cumulative DXA → EMU.
    expect(row[0]?.xEmu).toBe(0);
    expect(row[0]?.cxEmu).toBe(2000 * DXA_TO_EMU);
    expect(row[1]?.xEmu).toBe(2000 * DXA_TO_EMU);
    expect(row[1]?.cxEmu).toBe(1500 * DXA_TO_EMU);
    expect(row[4]?.xEmu).toBe((2000 + 1500 + 1500 + 2500) * DXA_TO_EMU);
    expect(row[4]?.cxEmu).toBe(2500 * DXA_TO_EMU);
    expect(row[0]?.cyEmu).toBe(500 * DXA_TO_EMU);
  });

  it("falls back to default row height when trHeight is missing", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="3000"/>
          <w:gridCol w:w="3000"/>
        </w:tblGrid>
        <w:tr><w:tc/><w:tc/></w:tr>
        <w:tr><w:tc/><w:tc/></w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result).toHaveLength(1);
    expect(result[0].cells).toHaveLength(2);
    const r0c0 = result[0].cells[0][0];
    const r1c0 = result[0].cells[1][0];
    // Both rows have the same default height.
    expect(r0c0?.cyEmu).toBe(r1c0?.cyEmu);
    expect(r0c0?.cyEmu).toBeGreaterThan(0);
    // Row 1's y starts where row 0 ends.
    expect(r1c0?.yEmu).toBe(r0c0!.cyEmu);
  });

  it("handles mixed exact and auto rows", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="2000"/>
        </w:tblGrid>
        <w:tr>
          <w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>
          <w:tc/>
        </w:tr>
        <w:tr><w:tc/></w:tr>
        <w:tr>
          <w:trPr><w:trHeight w:val="600" w:hRule="atLeast"/></w:trPr>
          <w:tc/>
        </w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result[0].cells).toHaveLength(3);
    expect(result[0].cells[0][0]?.cyEmu).toBe(400 * DXA_TO_EMU);
    // Row 2 (auto) — default height, just check non-zero.
    expect(result[0].cells[1][0]?.cyEmu).toBeGreaterThan(0);
    expect(result[0].cells[2][0]?.cyEmu).toBe(600 * DXA_TO_EMU);
  });

  it("keeps top-level tables in document order, ignores nested tables", () => {
    // Outer table contains nested tbl inside its only cell. The outer
    // counts as tableIndex=0; the nested one should NOT appear at all.
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tbl>
              <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
              <w:tr><w:tc/></w:tr>
            </w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>
        <w:tr><w:tc/></w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result).toHaveLength(2);
    expect(result[0].tableIndex).toBe(0);
    expect(result[0].cells[0][0]?.cxEmu).toBe(5000 * DXA_TO_EMU);
    expect(result[1].tableIndex).toBe(1);
    expect(result[1].cells[0][0]?.cxEmu).toBe(3000 * DXA_TO_EMU);
  });

  it("handles gridSpan (colspan) — top-left cell spans, others in row are nulls or shifted", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="2000"/>
        </w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tcPr><w:gridSpan w:val="2"/></w:tcPr>
          </w:tc>
          <w:tc/>
        </w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    const row = result[0].cells[0];
    expect(row).toHaveLength(3);
    expect(row[0]?.colSpan).toBe(2);
    expect(row[0]?.cxEmu).toBe(4000 * DXA_TO_EMU);
    expect(row[1]).toBeNull();
    expect(row[2]).toBeDefined();
    expect(row[2]?.colIndex).toBe(2);
    expect(row[2]?.cxEmu).toBe(2000 * DXA_TO_EMU);
  });

  it("handles vMerge (rowspan) — restart cell carries the height, continuation rows have null", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="2000"/>
        </w:tblGrid>
        <w:tr>
          <w:trPr><w:trHeight w:val="300" w:hRule="exact"/></w:trPr>
          <w:tc>
            <w:tcPr><w:vMerge w:val="restart"/></w:tcPr>
          </w:tc>
          <w:tc/>
        </w:tr>
        <w:tr>
          <w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>
          <w:tc>
            <w:tcPr><w:vMerge/></w:tcPr>
          </w:tc>
          <w:tc/>
        </w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result[0].cells).toHaveLength(2);
    // Top-left has rowSpan=2 and cyEmu = 300+400 DXA.
    const tl = result[0].cells[0][0];
    expect(tl?.rowSpan).toBe(2);
    expect(tl?.cyEmu).toBe((300 + 400) * DXA_TO_EMU);
    // Row 1 col 0 is the merge continuation slot — should be null.
    expect(result[0].cells[1][0]).toBeNull();
    // Row 1 col 1 — its own cell, distinct.
    expect(result[0].cells[1][1]).toBeDefined();
  });

  it("returns sequential cells with correct y-stacking for multi-row tables", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>
        <w:tr>
          <w:trPr><w:trHeight w:val="200" w:hRule="exact"/></w:trPr>
          <w:tc/>
        </w:tr>
        <w:tr>
          <w:trPr><w:trHeight w:val="300" w:hRule="exact"/></w:trPr>
          <w:tc/>
        </w:tr>
        <w:tr>
          <w:trPr><w:trHeight w:val="400" w:hRule="exact"/></w:trPr>
          <w:tc/>
        </w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    const cells = result[0].cells;
    expect(cells[0][0]?.yEmu).toBe(0);
    expect(cells[1][0]?.yEmu).toBe(200 * DXA_TO_EMU);
    expect(cells[2][0]?.yEmu).toBe((200 + 300) * DXA_TO_EMU);
    expect(cells[2][0]?.cyEmu).toBe(400 * DXA_TO_EMU);
  });

  it("handles empty tblGrid (no columns) gracefully", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid/>
        <w:tr><w:tc/></w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    expect(result).toHaveLength(1);
    expect(result[0].cells).toEqual([]);
  });

  it("preserves rowIndex/colIndex matching the cell grid coordinates", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="1000"/>
          <w:gridCol w:w="1000"/>
          <w:gridCol w:w="1000"/>
        </w:tblGrid>
        <w:tr><w:tc/><w:tc/><w:tc/></w:tr>
        <w:tr><w:tc/><w:tc/><w:tc/></w:tr>
      </w:tbl>`);
    const result = extractTableGeometry(xml);
    const cells = result[0].cells;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = cells[r][c];
        expect(cell).toBeDefined();
        expect(cell!.rowIndex).toBe(r);
        expect(cell!.colIndex).toBe(c);
      }
    }
  });

  it("collects footnoteRefs from <w:footnoteReference w:id> inside cells", () => {
    const xml = wrap(`
      <w:tbl>
        <w:tblGrid>
          <w:gridCol w:w="2000"/>
          <w:gridCol w:w="2000"/>
        </w:tblGrid>
        <w:tr>
          <w:tc>
            <w:p><w:r><w:t>X</w:t><w:footnoteReference w:id="1"/></w:r></w:p>
          </w:tc>
          <w:tc>
            <w:p><w:r><w:t>Y</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
        <w:tr>
          <w:tc>
            <w:p>
              <w:r><w:t>Z</w:t><w:footnoteReference w:id="2"/></w:r>
              <w:r><w:footnoteReference w:id="3"/></w:r>
            </w:p>
          </w:tc>
          <w:tc><w:p><w:r><w:t>W</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);
    const result = extractTableGeometry(xml);
    expect(result).toHaveLength(1);
    const cells = result[0].cells;
    expect(cells[0][0]?.footnoteRefs).toEqual(["1"]);
    expect(cells[0][1]?.footnoteRefs).toBeUndefined();
    expect(cells[1][0]?.footnoteRefs).toEqual(["2", "3"]);
    expect(cells[1][1]?.footnoteRefs).toBeUndefined();
  });
});
