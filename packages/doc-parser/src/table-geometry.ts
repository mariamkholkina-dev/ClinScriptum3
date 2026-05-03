/**
 * EMU geometry extractor for tables in a Word document.
 *
 * Sprint 6 wires `mapDrawingsToCells` (in @clinscriptum/shared) into the
 * SoA detection pipeline. That helper needs the EMU-bounding-box of each
 * cell so it can decide which drawings overlap which cells. Mammoth's
 * HTML output discards positional information, so we go back to
 * `word/document.xml` directly through JSZip + fast-xml-parser.
 *
 * Supported input: an OOXML document.xml string. The parser walks every
 * `<w:tbl>` (skipping nested tables — drawings inside a cell stay
 * attributed to the OUTER table, since the SoA detector only deals with
 * top-level tables) and computes:
 *   - column x-positions from `<w:tblGrid>` `<w:gridCol w:w="DXA">`
 *   - row y-positions from each `<w:tr>` `<w:trHeight w:val="DXA">`
 *     (or equal distribution when missing / `w:hRule="auto"`)
 *   - per-cell bounding box accounting for `<w:gridSpan>` (colspan) and
 *     `<w:vMerge>` (rowspan). Merged-into slots are returned as `null`.
 *
 * EMU = English Metric Units, 914400 per inch. DXA = twentieths of a
 * point, 1440 per inch → 635 EMU per DXA.
 */

import { XMLParser } from "fast-xml-parser";

const DXA_TO_EMU = 635;
const PT_TO_EMU = 12700;

/**
 * EMU bounding box of one logical cell. For merged cells, the top-left
 * slot carries the rectangle that spans all of `colspan × rowspan`;
 * remaining covered slots are `null` in the grid returned by
 * `extractTableGeometry`.
 */
export interface CellRect {
  rowIndex: number;
  colIndex: number;
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
  /** colspan from `<w:gridSpan>`, default 1. */
  colSpan?: number;
  /** rowspan from `<w:vMerge>` chain, default 1. */
  rowSpan?: number;
}

export interface TableGeometry {
  /**
   * Order of the table in the document (0-based, only counts
   * top-level `<w:tbl>` elements — nested tables don't increment).
   * Maps onto the order of SoA-detection table candidates produced
   * by mammoth → HTML → soa-detection-core, since both paths walk
   * top-level tables in document order.
   */
  tableIndex: number;
  /** [rowIndex][colIndex]. `null` slot = merged into another cell. */
  cells: (CellRect | null)[][];
}

interface XmlNode {
  [key: string]: unknown;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseDxa(raw: unknown): number {
  if (raw == null) return 0;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Extract column widths in EMU from `<w:tblGrid>`.
 * Returns cumulative x-positions: [x0, x1, x2, ...] of length numCols+1
 * so a column `c` spans from `xPositions[c]` to `xPositions[c+1]`.
 */
function extractColumnXPositions(tbl: XmlNode): number[] {
  const tblGrid = tbl.tblGrid as XmlNode | undefined;
  if (!tblGrid) return [0];
  const cols = asArray(tblGrid.gridCol as XmlNode | XmlNode[] | undefined);
  const xs: number[] = [0];
  let x = 0;
  for (const col of cols) {
    const widthDxa = parseDxa(col["@_w:w"] ?? col["@_w"]);
    x += widthDxa * DXA_TO_EMU;
    xs.push(x);
  }
  return xs;
}

/**
 * Extract row heights in EMU from each `<w:tr>` `<w:trHeight>`.
 * Falls back to a default row height when missing or `w:hRule="auto"`.
 * Returns cumulative y-positions: [y0, y1, ...] length = numRows+1.
 */
function extractRowYPositions(rows: XmlNode[], defaultHeightEmu: number): number[] {
  const ys: number[] = [0];
  let y = 0;
  for (const row of rows) {
    const trPr = row.trPr as XmlNode | undefined;
    const trHeight = trPr?.trHeight as XmlNode | undefined;
    const valDxa = parseDxa(trHeight?.["@_w:val"] ?? trHeight?.["@_val"]);
    const hRule =
      (trHeight?.["@_w:hRule"] ?? trHeight?.["@_hRule"] ?? "auto") as string;
    let heightEmu: number;
    if (valDxa > 0 && (hRule === "exact" || hRule === "atLeast")) {
      heightEmu = valDxa * DXA_TO_EMU;
    } else if (valDxa > 0) {
      // `auto` with a value is a hint; treat as the value.
      heightEmu = valDxa * DXA_TO_EMU;
    } else {
      heightEmu = defaultHeightEmu;
    }
    y += heightEmu;
    ys.push(y);
  }
  return ys;
}

/**
 * Walk the body looking for top-level `<w:tbl>` elements only. Nested
 * tables (a `<w:tbl>` inside a `<w:tc>`) are not returned — drawings
 * inside them are attributed to the outer table from the detector's
 * point of view.
 */
function collectTopLevelTables(body: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  // The body's direct children are <w:p> and <w:tbl> (and rarely
  // <w:sectPr>). asArray preserves order via fast-xml-parser's default
  // ordering when ignoreAttributes is false. fast-xml-parser collapses
  // duplicate-keyed children into arrays, so the document's natural
  // order across <w:tbl> is preserved within `body.tbl`.
  const tbls = asArray(body.tbl as XmlNode | XmlNode[] | undefined);
  for (const t of tbls) out.push(t);
  return out;
}

/**
 * Top-level entry: parse OOXML document.xml, return geometry for every
 * top-level `<w:tbl>` in document order.
 */
export function extractTableGeometry(xmlText: string): TableGeometry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    preserveOrder: false,
    allowBooleanAttributes: true,
    removeNSPrefix: true,
  });

  let parsed: XmlNode;
  try {
    parsed = parser.parse(xmlText) as XmlNode;
  } catch {
    return [];
  }

  const document = (parsed.document ?? parsed["w:document"]) as XmlNode | undefined;
  if (!document) return [];
  const body = (document.body ?? document["w:body"]) as XmlNode | undefined;
  if (!body) return [];

  const tables = collectTopLevelTables(body);
  if (tables.length === 0) return [];

  const result: TableGeometry[] = [];

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const tbl = tables[tableIndex];
    const xs = extractColumnXPositions(tbl);
    const numCols = Math.max(xs.length - 1, 0);
    if (numCols === 0) {
      result.push({ tableIndex, cells: [] });
      continue;
    }

    const rows = asArray(tbl.tr as XmlNode | XmlNode[] | undefined);
    if (rows.length === 0) {
      result.push({ tableIndex, cells: [] });
      continue;
    }

    // Default row height fallback: 14pt ≈ 17780 EMU per row.
    // 14pt is a typical Word default for table content.
    const DEFAULT_ROW_HEIGHT_EMU = 14 * PT_TO_EMU;
    const ys = extractRowYPositions(rows, DEFAULT_ROW_HEIGHT_EMU);

    // Build cell grid. Initialize as (numRows × numCols) of null; fill
    // top-left cells, mark merged-into slots as null (already null).
    const cells: (CellRect | null)[][] = Array.from({ length: rows.length }, () =>
      Array<CellRect | null>(numCols).fill(null),
    );

    // Track which (row, col) positions are already covered by an
    // earlier vMerge=restart cell so we can skip filling them.
    const covered: boolean[][] = Array.from({ length: rows.length }, () =>
      Array<boolean>(numCols).fill(false),
    );

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      const tcs = asArray(row.tc as XmlNode | XmlNode[] | undefined);
      let gridCol = 0;
      for (const tc of tcs) {
        // Skip already-covered grid columns due to a vMerge from above.
        while (gridCol < numCols && covered[rowIdx][gridCol]) gridCol++;
        if (gridCol >= numCols) break;

        const tcPr = tc.tcPr as XmlNode | undefined;
        const gridSpanRaw = (tcPr?.gridSpan as XmlNode | undefined)?.["@_w:val"]
          ?? (tcPr?.gridSpan as XmlNode | undefined)?.["@_val"];
        const colSpan = Math.max(parseDxa(gridSpanRaw) || 1, 1);

        const vMergeNode = tcPr?.vMerge as XmlNode | undefined;
        const vMergeVal = vMergeNode?.["@_w:val"] ?? vMergeNode?.["@_val"];
        const isVMergeContinuation =
          vMergeNode != null && vMergeVal !== "restart";

        if (isVMergeContinuation) {
          // This <w:tc> is a continuation slot of a merge that began in
          // an earlier row. The earlier cell already accounts for its
          // span — just mark this position covered and advance.
          for (let dc = 0; dc < colSpan && gridCol + dc < numCols; dc++) {
            covered[rowIdx][gridCol + dc] = true;
          }
          gridCol += colSpan;
          continue;
        }

        // Compute rowSpan: count following rows whose corresponding
        // <w:tc> at this gridCol is vMerge=continue.
        let rowSpan = 1;
        if (vMergeNode != null && vMergeVal === "restart") {
          for (let r2 = rowIdx + 1; r2 < rows.length; r2++) {
            const r2Tcs = asArray(rows[r2].tc as XmlNode | XmlNode[] | undefined);
            // Walk r2's tcs accumulating gridCol to find one at our column.
            let g = 0;
            let foundContinuation = false;
            for (const tc2 of r2Tcs) {
              const tc2Pr = tc2.tcPr as XmlNode | undefined;
              const span2Raw = (tc2Pr?.gridSpan as XmlNode | undefined)?.["@_w:val"]
                ?? (tc2Pr?.gridSpan as XmlNode | undefined)?.["@_val"];
              const span2 = Math.max(parseDxa(span2Raw) || 1, 1);
              if (g === gridCol) {
                const vm2 = tc2Pr?.vMerge as XmlNode | undefined;
                const vm2Val = vm2?.["@_w:val"] ?? vm2?.["@_val"];
                if (vm2 != null && vm2Val !== "restart") {
                  foundContinuation = true;
                }
                break;
              }
              g += span2;
            }
            if (foundContinuation) rowSpan++;
            else break;
          }
        }

        const xEmu = xs[gridCol] ?? 0;
        const yEmu = ys[rowIdx] ?? 0;
        const cxEmu = (xs[gridCol + colSpan] ?? xs[xs.length - 1]) - xEmu;
        const cyEmu = (ys[rowIdx + rowSpan] ?? ys[ys.length - 1]) - yEmu;

        cells[rowIdx][gridCol] = {
          rowIndex: rowIdx,
          colIndex: gridCol,
          xEmu,
          yEmu,
          cxEmu,
          cyEmu,
          colSpan,
          rowSpan,
        };

        // Mark the entire merged region as covered so subsequent
        // <w:tc>s (in the same row, or via continuation in next rows)
        // are not double-counted.
        for (let dr = 0; dr < rowSpan; dr++) {
          for (let dc = 0; dc < colSpan; dc++) {
            const rr = rowIdx + dr;
            const cc = gridCol + dc;
            if (rr < rows.length && cc < numCols) {
              covered[rr][cc] = true;
            }
          }
        }

        gridCol += colSpan;
      }
    }

    result.push({ tableIndex, cells });
  }

  return result;
}
