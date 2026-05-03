/**
 * SOA (Schedule of Activities) detection — deterministic algorithm.
 * Extracted to @clinscriptum/shared so both API (in-process) and workers can use it.
 *
 * 5-phase algorithm: detect → score → decide → extract → normalize.
 * Supports merged header cells (colspan/rowspan) for multi-level visit names.
 */

import { prisma } from "@clinscriptum/db";
import {
  extractCellMarkers,
  extractFootnoteDefinitions,
  linkAnchorsToFootnotes,
  type PendingAnchor,
  type ResolvedFootnote,
  type ResolvedAnchor,
  type CellRect as DocParserCellRect,
  type TableGeometry,
} from "@clinscriptum/doc-parser";

export interface SoaLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/* ═══════════════════════ Types ═══════════════════════ */

interface HtmlCell {
  text: string;
  rawHtml: string;
  colspan: number;
  rowspan: number;
}

interface TableCandidate {
  blockId: string;
  rawHtml: string;
  title: string;
  htmlRows: HtmlCell[][];
  rows: string[][];
  rawHtmlGrid: string[][];
  nextBlockHtml: string | null;
  sectionId: string;
  order: number;
}

interface ScoringResult {
  score: number;
  titleMatched: boolean;
  xRatio: number;
  procCount: number;
  numCols: number;
  numRows: number;
}

type SoaOrientation = "visits_cols" | "visits_rows" | "unknown";

interface SoaDetectionResult {
  tableBlockId: string;
  /**
   * All ContentBlock IDs that contributed to this result. Length 1 by
   * default; grows to ≥2 when continuation merge fires
   * (`mergeContinuationTables`). The first element always equals
   * `tableBlockId` for backward compatibility.
   */
  sourceBlockIds: string[];
  sectionId: string;
  title: string;
  score: number;
  visits: string[];
  headerRows: { text: string; span: number }[][];
  procedures: string[];
  matrix: SoaCellData[][];
  rawMatrix: string[][];
  footnoteDefs: ResolvedFootnote[];
  footnoteAnchors: ResolvedAnchor[];
  orientation: SoaOrientation;
  orientationConflict: boolean;
  /**
   * EMU geometry of cells in canonical (visits-cols) layout. Set when
   * detectSoaForVersion has access to `tableGeometries` in the
   * DocumentVersion.digitalTwin and the matching table-by-index
   * resolves. Persisted as `SoaTable.cellGeometry` so the UI can later
   * render an SVG overlay without re-parsing the DOCX.
   */
  cellGeometry: (DocParserCellRect | null)[][] | null;
  /**
   * Drawings that overlay this specific SoA table — already filtered
   * down from the full `digitalTwin.drawings` by area intersection.
   * Persisted as `SoaTable.drawings`.
   */
  tableDrawings: Array<{
    type: "arrow" | "line" | "bracket" | "image" | "shape";
    position: { xEmu: number; yEmu: number; cxEmu: number; cyEmu: number };
    direction?: "horizontal" | "vertical";
    paragraphIndex?: number;
    prstGeom?: string;
  }>;
}

type MarkerSource = "text" | "arrow" | "line" | "bracket";

interface SoaCellData {
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  markers: string[];
  markerSources: MarkerSource[];
}

/* ═══════════════════════ Constants ═══════════════════════ */

const SOA_TITLE_PATTERNS: RegExp[] = [
  /\bschedule\s+of\s+(assessments|activities|events|evaluations)\b/i,
  /\bSoA\b/,
  /\bstudy\s+(procedures?|activities)\s*(schedule|table|overview)\b/i,
  /\btable\s+of\s+(study\s+)?(procedures?|assessments|activities)\b/i,
  /\btime\s+and\s+events?\s+(schedule|table)\b/i,
  /график\S*\s+(процедур|мероприятий|обследован|визит|исследован)\S*/i,
  /график\S*\s+проведен\S*\s+процедур\S*/i,
  /схем\S*\s+проведен\S*\s+процедур\S*/i,
  /регламент\S*\s+(клинического\s+)?исследован\S*/i,
  /блок[-\s]?схем\S*\s+(клинического\s+)?исследован\S*/i,
  /порядок\s+проведения\s+процедур/i,
  /схем\S*\s+процедур\S*\s+исследован\S*/i,
  /перечень\s+процедур/i,
  /календарн\S*\s+(план|график)\S*\s+исследован\S*/i,
  /план\S*\s+(визит|обследован)\S*/i,
  /расписани\S*\s+(процедур|визит|исследован)\S*/i,
];

const SOA_KEYWORDS: string[] = [
  "schedule of activities", "schedule of assessments", "schedule of events",
  "schedule of evaluations", "study procedures", "study activities",
  "time and events", "soa",
  "график процедур", "график проведения процедур", "график мероприятий",
  "график обследований", "график визитов", "график исследования",
  "расписание процедур", "расписание визитов", "расписание исследования",
  "список процедур исследования", "перечень процедур исследования",
  "регламент клинического исследования", "регламент исследования",
  "блок-схема исследования", "блок-схема клинического исследования",
  "схема проведения процедур", "план мероприятий",
  "план проведения процедур", "план обследования",
];

const HEADER_SIGNALS: { key: string; pattern: RegExp; weight: number }[] = [
  { key: "visit", pattern: /\b(визит\S*|visit\S*)\b/i, weight: 2.0 },
  { key: "procedure", pattern: /\b(процедур\S*|мероприят\S*|procedure|assessment|evaluation)\b/i, weight: 2.0 },
  { key: "day", pattern: /\b(день|day|сутки|д[её]нь)\b/i, weight: 1.5 },
  { key: "screening", pattern: /\b(скрининг\S*|screening)\b/i, weight: 1.0 },
  { key: "period", pattern: /\b(период\S*|period)\b/i, weight: 0.5 },
  { key: "week", pattern: /\b(недел\S*|week)\b/i, weight: 0.5 },
  { key: "follow_up", pattern: /\b(наблюден\S*|follow[-\s]?up)\b/i, weight: 0.5 },
];

const PROCEDURE_ROW_PATTERNS: RegExp[] = [
  /(информированн\S*\s+согласи\S*|informed\s+consent)/i,
  /(физикальн\S*|physical\s+exam|осмотр\S*)/i,
  /(жизненн\S*\s+важн\S*|vital\s+signs|АД|ЧСС)/i,
  /(ЭКГ|ECG|электрокардиогр\S*)/i,
  /(анализ\S*\s+крови|биохим\S*|гематолог\S*|blood\s+test|laborat)/i,
  /(рандомизаци\S*|randomiz)/i,
  /(при[её]м\S*\s+препарат|введени\S*\s+препарат|drug\s+admin|study\s+drug)/i,
];

const X_MARK_PATTERN = /^[xхXХ✓✔☑●+×\uf06e]+$/;
const X_MARK_DASH = /^[–—-]$/;
const X_MARK_PARENS = /^\([xхXХ]\)$/;

const POSITIVE_MARKER_RE = /^[xхXХ✓✔☑●+×\uf06e]+[\d*†‡§¶#,.\s]*$/;
const PARENS_MARKER_RE = /^\([xхXХ]\)[\d*]*$/;
const DASH_MARKER_RE = /^[–—-]$/;

const TIMEPOINT_TIME_RE = /\d+\s*(мин|ч|час|hour|min)/i;
const TIMEPOINT_DAY_RE = /\b(день|day|недел|week)\b/i;

const _FOOTNOTE_NUM_PATTERN = /^\d{1,2}[).*,]?$/;
const MAX_FOOTNOTE_NUM = 30;

/* ═══════════════════════ Entry point ═══════════════════════ */

export async function detectSoaForVersion(versionId: string, log: SoaLogger): Promise<void> {
  log.info("[soa] Starting SOA detection", { versionId });

  const version = await prisma.documentVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      document: true,
      sections: {
        orderBy: { order: "asc" },
        include: { contentBlocks: { orderBy: { order: "asc" } } },
      },
    },
  });

  if (version.document.type !== "protocol") {
    log.info("[soa] Skipping: non-protocol document", { docType: version.document.type });
    return;
  }

  const candidates = collectTableCandidates(version.sections);
  log.info("[soa] Found table candidates", { count: candidates.length });

  if (candidates.length === 0) return;

  // Pull drawings + table geometries from the digitalTwin if parse-document
  // ran a DOCX through parseDocx. Both fields are arrays — empty when the
  // parse used non-DOCX input (e.g. integration tests with raw HTML
  // ContentBlocks). Indexing is positional: the N-th SoA table candidate
  // corresponds to the N-th `<w:tbl>` in document order.
  const digitalTwin = (version.digitalTwin ?? {}) as {
    drawings?: Array<{
      type: "arrow" | "line" | "bracket" | "image" | "shape";
      position: { xEmu: number; yEmu: number; cxEmu: number; cyEmu: number };
      direction?: "horizontal" | "vertical";
      paragraphIndex?: number;
      prstGeom?: string;
    }>;
    tableGeometries?: TableGeometry[];
  };
  const allDrawings = digitalTwin.drawings ?? [];
  const allGeometries = digitalTwin.tableGeometries ?? [];

  const soaTables: SoaDetectionResult[] = [];

  for (let candidateIdx = 0; candidateIdx < candidates.length; candidateIdx++) {
    const candidate = candidates[candidateIdx];
    // Decide orientation BEFORE scoring — scoring assumes visits-in-columns
    // (it inspects the first row for visit signals and the first column for
    // procedure patterns). For `visits_rows` candidates we transpose first
    // so the rest of the pipeline keeps the canonical layout.
    const orientation = detectOrientation(candidate.rows);
    const workingCandidate =
      orientation === "visits_rows" ? transposeCandidate(candidate) : candidate;

    const scoring = scoreTable(workingCandidate);

    if (scoring.score < 3.5) continue;

    const isSoa = isTrueSoa(scoring);
    if (!isSoa) continue;

    log.info("[soa] SOA detected", {
      title: workingCandidate.title,
      score: scoring.score.toFixed(1),
      orientation,
      transposed: orientation === "visits_rows",
    });

    const result = buildSoaResult(workingCandidate, scoring);
    if (!result) continue;
    result.orientation = orientation;

    // Resolve geometry & drawings for this table by positional index
    // and apply mapDrawingsToCells overrides.
    const rawGeometry = allGeometries[candidateIdx]?.cells ?? null;
    if (rawGeometry) {
      const geometryCanonical =
        orientation === "visits_rows" ? transposeGeometry(rawGeometry) : rawGeometry;
      result.cellGeometry = geometryCanonical;

      // Drawings filter: ratio test discards those that don't overlap
      // the table's bounds, so we can pass everything in. Image/shape
      // are ignored inside mapDrawingsToCells.
      result.tableDrawings = allDrawings.map((d) => ({
        type: d.type,
        position: d.position,
        direction: d.direction,
        paragraphIndex: d.paragraphIndex,
        prstGeom: d.prstGeom,
      }));

      // Geometry includes header rows; result.matrix is data-rows only.
      // Slice and re-index so override rowIndex aligns with matrix
      // rowIndex. Also drop the first column (procedure-name column)
      // so override colIndex aligns with visits index.
      const headerRowCount = detectHeaderRowCount(workingCandidate.rows);
      const dataGeometry = geometryCanonical.slice(headerRowCount).map((row) =>
        row.slice(1).map((cell, c) => {
          if (!cell) return null;
          return { ...cell, colIndex: c };
        }),
      );
      // Re-index rowIndex so it matches matrix coords.
      const dataGeometryReindexed = dataGeometry.map((row, r) =>
        row.map((cell) => (cell ? { ...cell, rowIndex: r } : null)),
      );
      const flatCells = flattenGeometryToCellRects(dataGeometryReindexed);
      const overrides = mapDrawingsToCells(allDrawings, flatCells, 0.6);
      for (const ov of overrides) {
        const cellRow = result.matrix[ov.rowIndex];
        const cell = cellRow?.[ov.colIndex];
        if (!cell) continue;
        if (!cell.markerSources.includes(ov.source)) {
          cell.markerSources = [...cell.markerSources, ov.source];
        }
        // Promote to positive mark only when the cell had no textual
        // value yet — never overwrite an explicit X or dash.
        if (cell.normalizedValue === "") {
          cell.normalizedValue = "X";
          cell.confidence = 0.85;
        }
      }

      log.info("[soa] Drawings → cells override applied", {
        tableIndex: candidateIdx,
        overrides: overrides.length,
      });
    }

    soaTables.push(result);
  }

  // Mixed-orientation guard. If at least one detected SoA is `visits_cols`
  // and there's also a `visits_rows` (or vice versa), prefer the canonical
  // layout and flag the others — UI shows an alert and lets the writer
  // resolve manually.
  const orientationSet = new Set(soaTables.map((t) => t.orientation));
  if (orientationSet.size > 1 && orientationSet.has("visits_cols")) {
    log.info("[soa] Mixed orientations detected — flagging non-canonical tables", {
      total: soaTables.length,
      orientations: Array.from(orientationSet),
    });
    for (const t of soaTables) {
      if (t.orientation !== "visits_cols") t.orientationConflict = true;
    }
  }

  if (soaTables.length === 0) {
    log.info("[soa] No SOA tables detected");
    return;
  }

  // Continuation merge: identical visits + headerRows in the same
  // section, same orientation, are typically a single SoA Word split
  // across consecutive `<w:tbl>` parts with a repeated header.
  const merged = mergeContinuationTables(soaTables);
  if (merged.length < soaTables.length) {
    log.info("[soa] Merged continuation tables", {
      before: soaTables.length,
      after: merged.length,
    });
  }

  await persistSoaTables(versionId, merged);
  log.info("[soa] Saved SOA tables", { count: merged.length });
}

/**
 * Merge SoA detection results that look like Word split a single
 * logical table across multiple `<w:tbl>` parts. Strict equality on
 * `visits + headerRows + sectionId + orientation` — fuzzy matching is
 * out of scope for Sprint 6.
 *
 * Within each merge group:
 *   - cells from later parts have their `rowIndex` offset by the sum
 *     of `procedures.length` of earlier parts;
 *   - `procedures`, `matrix` rows, `rawMatrix` data rows, `drawings`,
 *     `cellGeometry` rows are concatenated in order;
 *   - `footnoteDefs` are merged by `marker` (first wins);
 *   - `footnoteAnchors` are concatenated with `rowIndex` offset for
 *     cell-typed anchors;
 *   - `sourceBlockIds` lists all contributing ContentBlock IDs.
 */
export function mergeContinuationTables(
  tables: SoaDetectionResult[],
): SoaDetectionResult[] {
  if (tables.length < 2) return tables;
  const groups = new Map<string, SoaDetectionResult[]>();
  for (const t of tables) {
    const key = JSON.stringify({
      sectionId: t.sectionId,
      orientation: t.orientation,
      visits: t.visits,
      headerRows: t.headerRows,
    });
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const out: SoaDetectionResult[] = [];
  for (const [, parts] of groups) {
    if (parts.length === 1) {
      out.push(parts[0]);
      continue;
    }
    // Merge into the first part. Process in source order — assume
    // detection ran sections in document order and each part keeps
    // its natural order.
    const head = parts[0];
    const merged: SoaDetectionResult = {
      ...head,
      sourceBlockIds: [...head.sourceBlockIds],
      procedures: [...head.procedures],
      matrix: head.matrix.map((row) => [...row]),
      rawMatrix: head.rawMatrix.map((row) => [...row]),
      footnoteDefs: [...head.footnoteDefs],
      footnoteAnchors: [...head.footnoteAnchors],
    };
    let rowOffset = head.procedures.length;
    const seenMarkers = new Set(merged.footnoteDefs.map((f) => f.marker));
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      merged.sourceBlockIds.push(...p.sourceBlockIds);
      merged.procedures.push(...p.procedures);
      // Matrix rows: append as-is — rowIndex is positional.
      for (const row of p.matrix) merged.matrix.push([...row]);
      // rawMatrix: skip header rows of subsequent parts (they repeat
      // the same visits/days from the head).
      const headerRowCount = head.headerRows.length;
      const dataRows = p.rawMatrix.slice(headerRowCount);
      for (const row of dataRows) merged.rawMatrix.push([...row]);
      // Footnote defs: skip duplicate markers.
      for (const f of p.footnoteDefs) {
        if (!seenMarkers.has(f.marker)) {
          seenMarkers.add(f.marker);
          merged.footnoteDefs.push({
            ...f,
            markerOrder: merged.footnoteDefs.length,
          });
        }
      }
      // Footnote anchors: rowIndex offset for cell-typed anchors.
      for (const a of p.footnoteAnchors) {
        const adjusted = { ...a };
        if (a.targetType === "cell" && a.rowIndex != null) {
          adjusted.rowIndex = a.rowIndex + rowOffset;
        } else if (a.targetType === "row" && a.rowIndex != null) {
          adjusted.rowIndex = a.rowIndex + rowOffset;
        }
        merged.footnoteAnchors.push(adjusted);
      }
      // Drawings: concat as-is — paragraphIndex stays original so UI
      // can still locate them in the source.
      merged.tableDrawings = [...merged.tableDrawings, ...p.tableDrawings];
      // cellGeometry: concat data rows of subsequent parts. Heads of
      // parts already contain header geometry; we keep the first
      // part's header geometry and append data rows from siblings.
      if (merged.cellGeometry && p.cellGeometry) {
        const headerRowCountInGeom = head.headerRows.length;
        const dataGeom = p.cellGeometry.slice(headerRowCountInGeom);
        merged.cellGeometry = [...merged.cellGeometry, ...dataGeom];
      } else if (p.cellGeometry && !merged.cellGeometry) {
        merged.cellGeometry = p.cellGeometry;
      }
      rowOffset += p.procedures.length;
    }
    out.push(merged);
  }
  return out;
}

/* ═══════════════════════ Phase 1: Collect candidates ═══════════════════════ */

function collectTableCandidates(
  sections: {
    id: string;
    contentBlocks: { id: string; type: string; content: string; rawHtml: string | null; order: number }[];
  }[]
): TableCandidate[] {
  const candidates: TableCandidate[] = [];

  for (const section of sections) {
    let lastParagraphText = "";
    const blocks = section.contentBlocks;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type === "paragraph" || block.type === "list") {
        lastParagraphText = block.content;
        continue;
      }

      if (block.type === "table" && block.rawHtml) {
        const htmlRows = parseHtmlTableWithSpans(block.rawHtml);
        const { textGrid, rawHtmlGrid } = expandGridFromHtmlRows(htmlRows);
        if (textGrid.length < 2 || (textGrid[0]?.length ?? 0) < 2) {
          lastParagraphText = "";
          continue;
        }

        // Find the next paragraph/list block in the same section — it
        // typically holds the footnote-definition block ("Примечание:").
        let nextBlockHtml: string | null = null;
        for (let j = i + 1; j < blocks.length; j++) {
          const next = blocks[j];
          if (next.type === "paragraph" || next.type === "list") {
            nextBlockHtml = next.rawHtml ?? next.content;
            break;
          }
          if (next.type === "table") break;
        }

        candidates.push({
          blockId: block.id,
          rawHtml: block.rawHtml,
          title: detectTableTitle(lastParagraphText),
          htmlRows,
          rows: textGrid,
          rawHtmlGrid,
          nextBlockHtml,
          sectionId: section.id,
          order: block.order,
        });
      }

      lastParagraphText = "";
    }
  }

  return candidates;
}

function detectTableTitle(precedingText: string): string {
  if (!precedingText) return "";
  const trimmed = precedingText.trim();
  if (/^(таблица|table|график|рисунок)\b/i.test(trimmed)) return trimmed;
  return trimmed;
}

/* ═══════════════════════ Phase 2: Scoring ═══════════════════════ */

function scoreTable(candidate: TableCandidate): ScoringResult {
  const { rows, title } = candidate;
  const numRows = rows.length;
  const numCols = Math.max(...rows.map((r) => r.length));

  const headerRows = rows.slice(0, Math.min(4, rows.length));
  const headerText = headerRows.map((r) => r.join(" | ")).join(" ");
  const firstColText = rows.map((r) => r[0] ?? "").join(" ");

  let score = 0;

  const titleAndPreceding = `${title} ${headerText}`.toLowerCase();
  const titleMatched = checkTitleMatch(titleAndPreceding);
  if (titleMatched) score += 5.0;

  const matchedSignals = new Set<string>();
  for (const signal of HEADER_SIGNALS) {
    if (signal.pattern.test(headerText) && !matchedSignals.has(signal.key)) {
      score += signal.weight;
      matchedSignals.add(signal.key);
    }
  }

  let procCount = 0;
  for (const pattern of PROCEDURE_ROW_PATTERNS) {
    if (pattern.test(firstColText)) procCount++;
  }
  if (procCount >= 5) score += 3.0;
  else if (procCount >= 3) score += 2.0;
  else if (procCount >= 1) score += 0.5;

  const bodyRows = rows.slice(Math.min(4, rows.length));
  let xMarkers = 0;
  let totalBodyCells = 0;

  for (const row of bodyRows) {
    for (let col = 1; col < row.length; col++) {
      totalBodyCells++;
      const cell = (row[col] ?? "").trim();
      if (isXMarker(cell)) xMarkers++;
    }
  }

  const xRatio = totalBodyCells > 0 ? xMarkers / totalBodyCells : 0;
  if (xRatio > 0.10) score += 3.0;
  else if (xRatio > 0.03) score += 1.5;

  if (numCols >= 10) score += 1.5;
  else if (numCols >= 5) score += 0.5;
  if (numRows >= 15) score += 0.5;

  return { score, titleMatched, xRatio, procCount, numCols, numRows };
}

function checkTitleMatch(text: string): boolean {
  for (const pattern of SOA_TITLE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  const lower = text.toLowerCase();
  for (const keyword of SOA_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) return true;
  }
  return false;
}

function isXMarker(cell: string): boolean {
  if (!cell) return false;
  return X_MARK_PATTERN.test(cell) || X_MARK_DASH.test(cell) || X_MARK_PARENS.test(cell);
}

function isFootnoteNumber(cell: string): boolean {
  if (!cell) return false;
  if (!_FOOTNOTE_NUM_PATTERN.test(cell)) return false;
  const num = parseInt(cell.replace(/[^0-9]/g, ""), 10);
  return num >= 1 && num <= MAX_FOOTNOTE_NUM;
}

/* ═══════════════════════ Phase 3: Decision ═══════════════════════ */

function isTrueSoa(scoring: ScoringResult): boolean {
  const { score, titleMatched, xRatio, procCount, numCols } = scoring;

  if (titleMatched && score >= 6.0) return true;
  if (xRatio > 0.05 && procCount >= 3 && numCols >= 5) return true;
  if (procCount >= 5 && numCols >= 8) return true;
  if (score >= 12.0) return true;
  if (titleMatched && procCount >= 2) return true;

  return false;
}

/* ═══════════════════════ Phase 4-5: Extract & Normalize ═══════════════════════ */

function buildSoaResult(
  candidate: TableCandidate,
  scoring: ScoringResult
): SoaDetectionResult | null {
  const { rows, htmlRows, rawHtmlGrid } = candidate;
  if (rows.length < 2) return null;

  const headerRowCount = detectHeaderRowCount(rows);
  const dataRows = rows.slice(headerRowCount);

  if (dataRows.length === 0) return null;

  const numCols = Math.max(...rows.map((r) => r.length));
  const { visits: rawVisits, headerLevels } = buildMultiLevelVisits(
    rows,
    htmlRows,
    headerRowCount,
    numCols,
  );

  if (rawVisits.length === 0) return null;

  const pendingAnchors: PendingAnchor[] = [];

  // Phase: extract markers from header cells (excluding the first column,
  // which is the procedure-name header). Each marker becomes an anchor on
  // the matching column.
  const visits: string[] = rawVisits.map((rawText, colIdx) => {
    const headerRawHtmlColumns: string[] = [];
    for (let r = 0; r < headerRowCount && r < rawHtmlGrid.length; r++) {
      const slot = rawHtmlGrid[r]?.[colIdx + 1] ?? "";
      if (slot) headerRawHtmlColumns.push(slot);
    }
    const cleanParts: string[] = [];
    for (const part of headerRawHtmlColumns) {
      const { cleanText, markers } = extractCellMarkers(part);
      if (cleanText) cleanParts.push(cleanText);
      for (const m of markers) {
        pendingAnchors.push({
          marker: m,
          targetType: "col",
          colIndex: colIdx,
        });
      }
    }
    if (cleanParts.length > 0) {
      // Preserve original visit name format (parts joined with " / ") if
      // the multi-level builder used that pattern.
      return Array.from(new Set(cleanParts)).join(" / ");
    }
    return rawText;
  });

  const procedures: string[] = [];
  const matrix: SoaCellData[][] = [];
  const rawMatrix: string[][] = rows.slice(0, headerRowCount);

  for (let dataRowIdx = 0; dataRowIdx < dataRows.length; dataRowIdx++) {
    const row = dataRows[dataRowIdx];
    const sourceRowIdx = headerRowCount + dataRowIdx;
    const procRawHtml = rawHtmlGrid[sourceRowIdx]?.[0] ?? "";
    const { cleanText: procName, markers: procMarkers } =
      extractCellMarkers(procRawHtml);

    const procedureName = procName || (row[0] ?? "").trim();
    if (!procedureName) continue;

    const procedureIndex = procedures.length;
    procedures.push(procedureName);
    rawMatrix.push(row);

    for (const m of procMarkers) {
      pendingAnchors.push({
        marker: m,
        targetType: "row",
        rowIndex: procedureIndex,
      });
    }

    const cellRow: SoaCellData[] = [];
    for (let col = 1; col <= visits.length; col++) {
      const cellRawHtml = rawHtmlGrid[sourceRowIdx]?.[col] ?? "";
      const { cleanText: cleanCell, markers: cellMarkers } =
        extractCellMarkers(cellRawHtml);
      const raw = (cleanCell || (row[col] ?? "")).trim();
      const normalized = normalizeMarker(raw);
      const confidence = computeCellConfidence(raw, normalized);

      for (const m of cellMarkers) {
        pendingAnchors.push({
          marker: m,
          targetType: "cell",
          rowIndex: procedureIndex,
          colIndex: col - 1,
        });
      }

      cellRow.push({
        rawValue: raw,
        normalizedValue: normalized,
        confidence,
        markers: cellMarkers,
        markerSources: ["text"],
      });
    }
    matrix.push(cellRow);
  }

  if (procedures.length === 0) return null;

  const definitions = extractFootnoteDefinitions(candidate.nextBlockHtml);
  const { footnotes: footnoteDefs, anchors: footnoteAnchors } =
    linkAnchorsToFootnotes(pendingAnchors, definitions);

  return {
    tableBlockId: candidate.blockId,
    sourceBlockIds: [candidate.blockId],
    sectionId: candidate.sectionId,
    title: candidate.title || "Schedule of Activities",
    score: scoring.score,
    visits,
    headerRows: headerLevels,
    procedures,
    matrix,
    rawMatrix,
    footnoteDefs,
    footnoteAnchors,
    // Defaults — overwritten by detectSoaForVersion if needed.
    orientation: "visits_cols",
    orientationConflict: false,
    cellGeometry: null,
    tableDrawings: [],
  };
}

function detectHeaderRowCount(rows: string[][]): number {
  const limit = Math.min(6, rows.length);

  for (let i = 1; i < limit; i++) {
    const row = rows[i];
    const dataCells = row.slice(1);
    const xCount = dataCells.filter((c) => isXMarker(c.trim())).length;
    const footnoteCount = dataCells.filter((c) => isFootnoteNumber(c.trim())).length;

    if (dataCells.length > 0 && (xCount + footnoteCount) / dataCells.length > 0.3) {
      return i;
    }

    const firstCol = (row[0] ?? "").trim();
    if (firstCol && PROCEDURE_ROW_PATTERNS.some((p) => p.test(firstCol))) {
      return i;
    }
  }

  return findBestHeaderEnd(rows);
}

function findBestHeaderEnd(rows: string[][]): number {
  const limit = Math.min(5, rows.length);
  let bestEnd = 1;
  let bestScore = -1;

  for (let end = 1; end <= limit; end++) {
    let score = 0;
    for (let i = 0; i < end; i++) {
      for (const cell of rows[i]) {
        score += scoreTimepointCell(cell);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEnd = end;
    }
  }

  return bestEnd;
}

function buildMultiLevelVisits(
  expandedRows: string[][],
  htmlRows: HtmlCell[][],
  headerRowCount: number,
  numCols: number
): { visits: string[]; headerLevels: { text: string; span: number }[][] } {
  const headerGrid: { text: string; colspan: number }[][] = [];

  for (let r = 0; r < headerRowCount && r < htmlRows.length; r++) {
    const level: { text: string; colspan: number }[] = [];
    for (const cell of htmlRows[r]) {
      level.push({ text: cell.text.trim(), colspan: cell.colspan });
    }
    headerGrid.push(level);
  }

  const expandedHeader: string[][] = [];
  for (let r = 0; r < headerRowCount && r < expandedRows.length; r++) {
    expandedHeader.push(expandedRows[r]);
  }

  const visits: string[] = [];
  for (let col = 1; col < numCols; col++) {
    const parts: string[] = [];
    for (let r = 0; r < expandedHeader.length; r++) {
      const cellText = (expandedHeader[r]?.[col] ?? "").trim();
      if (cellText && !parts.includes(cellText)) {
        parts.push(cellText);
      }
    }
    const visitName = parts.length > 1 ? parts.join(" / ") : (parts[0] ?? `Col ${col}`);
    visits.push(visitName);
  }

  const headerLevels: { text: string; span: number }[][] = [];
  for (let r = 0; r < headerGrid.length; r++) {
    const level: { text: string; span: number }[] = [];
    let colsConsumed = 0;
    for (const cell of headerGrid[r]) {
      if (colsConsumed === 0) {
        colsConsumed += cell.colspan;
        continue;
      }
      level.push({ text: cell.text, span: cell.colspan });
      colsConsumed += cell.colspan;
    }
    if (level.length > 0) headerLevels.push(level);
  }

  return { visits, headerLevels };
}

function scoreTimepointCell(cellText: string): number {
  let s = 0;
  if (TIMEPOINT_TIME_RE.test(cellText)) s += 2;
  if (TIMEPOINT_DAY_RE.test(cellText)) s += 1;
  return s;
}

function normalizeMarker(raw: string): string {
  if (!raw) return "";
  if (POSITIVE_MARKER_RE.test(raw)) return "X";
  if (PARENS_MARKER_RE.test(raw)) return "X";
  if (DASH_MARKER_RE.test(raw)) return "\u2013";
  return raw;
}

function computeCellConfidence(raw: string, normalized: string): number {
  if (!raw) return 1.0;
  if (normalized === "X" || normalized === "\u2013") return 1.0;
  if (isFootnoteNumber(raw)) return 0.9;
  if (raw === normalized) return 0.7;
  return 0.5;
}

/* ═══════════════════════ HTML Parsing ═══════════════════════ */

function parseHtmlTableWithSpans(html: string): HtmlCell[][] {
  const rows: HtmlCell[][] = [];

  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rowMatches) return rows;

  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  for (const rowHtml of rowMatches) {
    const cells: HtmlCell[] = [];
    cellRe.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const cellOpenTag = cellMatch[0].slice(0, cellMatch[0].indexOf(">") + 1);
      const innerHtml = cellMatch[1];
      const text = stripHtmlTags(innerHtml);
      const colspan = parseInt(
        cellOpenTag.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1",
        10,
      );
      const rowspan = parseInt(
        cellOpenTag.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1",
        10,
      );
      cells.push({ text, rawHtml: innerHtml, colspan, rowspan });
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

interface ExpandedGrid {
  textGrid: string[][];
  rawHtmlGrid: string[][];
}

function expandGridFromHtmlRows(htmlRows: HtmlCell[][]): ExpandedGrid {
  if (htmlRows.length === 0) return { textGrid: [], rawHtmlGrid: [] };

  let maxCols = 0;
  for (const row of htmlRows) {
    let cols = 0;
    for (const cell of row) cols += cell.colspan;
    if (cols > maxCols) maxCols = cols;
  }

  const numRows = htmlRows.length;
  const textGrid: (string | null)[][] = Array.from({ length: numRows }, () =>
    Array(maxCols).fill(null),
  );
  // rawHtmlGrid is populated only for the top-left slot of each merged cell;
  // remaining colspan/rowspan slots stay empty so footnote markers in the
  // source cell are not duplicated when extracted later.
  const rawHtmlGrid: string[][] = Array.from({ length: numRows }, () =>
    Array(maxCols).fill(""),
  );

  for (let r = 0; r < numRows; r++) {
    let gridCol = 0;
    for (const cell of htmlRows[r]) {
      while (gridCol < maxCols && textGrid[r][gridCol] !== null) {
        gridCol++;
      }
      if (gridCol >= maxCols) break;

      rawHtmlGrid[r][gridCol] = cell.rawHtml;

      for (let dr = 0; dr < cell.rowspan && r + dr < numRows; dr++) {
        for (let dc = 0; dc < cell.colspan && gridCol + dc < maxCols; dc++) {
          textGrid[r + dr][gridCol + dc] = cell.text;
        }
      }
      gridCol += cell.colspan;
    }
  }

  return {
    textGrid: textGrid.map((row) => row.map((c) => c ?? "")),
    rawHtmlGrid,
  };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ═══════════════════════ Orientation ═══════════════════════ */

interface OrientationSignals {
  visitsInRow: number;
  visitsInCol: number;
  proceduresInRow: number;
  proceduresInCol: number;
}

function countVisitSignals(text: string): number {
  let n = 0;
  for (const signal of HEADER_SIGNALS) {
    if (signal.pattern.test(text)) n += 1;
  }
  return n;
}

function countProcedureSignals(text: string): number {
  let n = 0;
  for (const pattern of PROCEDURE_ROW_PATTERNS) {
    if (pattern.test(text)) n += 1;
  }
  return n;
}

function gatherOrientationSignals(rows: string[][]): OrientationSignals {
  if (rows.length === 0 || rows[0].length === 0) {
    return { visitsInRow: 0, visitsInCol: 0, proceduresInRow: 0, proceduresInCol: 0 };
  }
  const firstRow = rows[0].slice(1);
  const firstCol = rows.slice(1).map((r) => r[0] ?? "");

  const firstRowText = firstRow.join(" ");
  const firstColText = firstCol.join(" ");

  return {
    visitsInRow: countVisitSignals(firstRowText),
    visitsInCol: countVisitSignals(firstColText),
    proceduresInRow: countProcedureSignals(firstRowText),
    proceduresInCol: countProcedureSignals(firstColText),
  };
}

/**
 * Heuristic for which axis carries the visits and which carries the procedures.
 *
 * `visits_cols` — the canonical layout used by virtually all clinical
 * protocols (header row = visits, first column = procedures). Returned when
 * visit signals dominate the first row AND procedure signals dominate the
 * first column.
 *
 * `visits_rows` — the transposed layout. Returned when the same dominance
 * holds with axes swapped.
 *
 * `unknown` — the gap between row and column signals is below the 30%
 * confidence threshold; the table is too symmetric to call.
 */
export function detectOrientation(rows: string[][]): SoaOrientation {
  const s = gatherOrientationSignals(rows);

  const colsScore = s.visitsInRow + s.proceduresInCol;
  const rowsScore = s.visitsInCol + s.proceduresInRow;
  const total = colsScore + rowsScore;

  if (total === 0) return "unknown";

  // Margin must be at least 30% of total signals to commit to an orientation.
  const margin = Math.abs(colsScore - rowsScore) / total;
  if (margin < 0.3) return "unknown";

  return colsScore > rowsScore ? "visits_cols" : "visits_rows";
}

/**
 * Returns a new candidate with rows / rawHtmlGrid / htmlRows transposed.
 * Used when `detectOrientation` returns `visits_rows` so the rest of the
 * pipeline keeps assuming the canonical visits-in-columns shape.
 *
 * Colspan / rowspan from the source `htmlRows` are flattened — once we
 * transpose at the text-grid level, the merged-cell metadata is no longer
 * meaningful. In practice transposed SoA tables are simple grids and do not
 * use merged cells.
 */
export function transposeCandidate(candidate: TableCandidate): TableCandidate {
  const numRows = candidate.rows.length;
  if (numRows === 0) return candidate;
  const numCols = Math.max(...candidate.rows.map((r) => r.length));

  const newRows: string[][] = Array.from({ length: numCols }, () =>
    Array<string>(numRows).fill(""),
  );
  const newRawHtmlGrid: string[][] = Array.from({ length: numCols }, () =>
    Array<string>(numRows).fill(""),
  );
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      newRows[c][r] = candidate.rows[r][c] ?? "";
      newRawHtmlGrid[c][r] = candidate.rawHtmlGrid[r]?.[c] ?? "";
    }
  }

  // Rebuild a flat HtmlCell[][] from the transposed text/html grids without
  // any colspan/rowspan — see function comment.
  const newHtmlRows: HtmlCell[][] = newRows.map((row, ri) =>
    row.map((text, ci) => ({
      text,
      rawHtml: newRawHtmlGrid[ri][ci] ?? "",
      colspan: 1,
      rowspan: 1,
    })),
  );

  return {
    ...candidate,
    rows: newRows,
    rawHtmlGrid: newRawHtmlGrid,
    htmlRows: newHtmlRows,
  };
}

/* ═══════════════════════ Drawings → cells mapping ═══════════════════════ */

export interface CellRect {
  rowIndex: number;
  colIndex: number;
  /** Inclusive EMU bounds. */
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}

export interface DrawingForMapping {
  type: "arrow" | "line" | "bracket" | "image" | "shape";
  position: { xEmu: number; yEmu: number; cxEmu: number; cyEmu: number };
  direction?: "horizontal" | "vertical";
}

export interface CellMarkerOverride {
  rowIndex: number;
  colIndex: number;
  source: MarkerSource;
}

/**
 * Pure helper for mapping drawing bounding boxes to cells of a SoA table.
 *
 * The detection pipeline doesn't yet know cell EMU coordinates — that
 * requires parsing `<w:tblGrid>` plus per-row heights, which is outside
 * the scope of Sprint 3. This function is the contract used by Sprint 3.5
 * (or whoever wires the coordinates): given a list of drawings and a
 * list of cell rectangles, return the cells each drawing covers and the
 * source kind it contributes ('arrow' | 'line' | 'bracket').
 *
 * Overlap rule: a cell counts as covered when at least 60% of its area
 * intersects the drawing's bounding box. Threshold tuned conservatively
 * — it lets a horizontal arrow that starts halfway through cell A and
 * ends halfway through cell D mark all four cells without sweeping in
 * neighbours that are merely grazed.
 *
 * Image drawings are ignored — they're not markers.
 */
/**
 * Transpose a geometry grid: swap rows ↔ cols so the data lines up with
 * a canonical visits-cols layout when the source table had visits in
 * rows. Width and height also swap. Merged cells are flattened to
 * single-slot for simplicity — transposed SoA tables in real protocols
 * don't use merges (same constraint as `transposeCandidate`).
 */
export function transposeGeometry(
  geometry: (DocParserCellRect | null)[][],
): (DocParserCellRect | null)[][] {
  const numRows = geometry.length;
  if (numRows === 0) return [];
  const numCols = Math.max(...geometry.map((r) => r.length));
  const out: (DocParserCellRect | null)[][] = Array.from({ length: numCols }, () =>
    Array<DocParserCellRect | null>(numRows).fill(null),
  );
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const src = geometry[r][c];
      if (!src) continue;
      out[c][r] = {
        rowIndex: c,
        colIndex: r,
        xEmu: src.yEmu,
        yEmu: src.xEmu,
        cxEmu: src.cyEmu,
        cyEmu: src.cxEmu,
        colSpan: 1,
        rowSpan: 1,
      };
    }
  }
  return out;
}

/**
 * Flatten geometry grid into the array shape `mapDrawingsToCells`
 * expects. Drops nulls (merged-into slots — they're already covered by
 * their top-left CellRect, no need to test them again).
 */
export function flattenGeometryToCellRects(
  geometry: (DocParserCellRect | null)[][],
): CellRect[] {
  const out: CellRect[] = [];
  for (const row of geometry) {
    for (const cell of row) {
      if (cell) out.push(cell);
    }
  }
  return out;
}

export function mapDrawingsToCells(
  drawings: DrawingForMapping[],
  cells: CellRect[],
  overlapThreshold = 0.6,
): CellMarkerOverride[] {
  const out: CellMarkerOverride[] = [];

  for (const drawing of drawings) {
    if (drawing.type === "image" || drawing.type === "shape") continue;

    const dx0 = drawing.position.xEmu;
    const dy0 = drawing.position.yEmu;
    const dx1 = dx0 + drawing.position.cxEmu;
    const dy1 = dy0 + drawing.position.cyEmu;

    for (const cell of cells) {
      const cx0 = cell.xEmu;
      const cy0 = cell.yEmu;
      const cx1 = cx0 + cell.cxEmu;
      const cy1 = cy0 + cell.cyEmu;

      const ix0 = Math.max(dx0, cx0);
      const iy0 = Math.max(dy0, cy0);
      const ix1 = Math.min(dx1, cx1);
      const iy1 = Math.min(dy1, cy1);

      if (ix1 <= ix0 || iy1 <= iy0) continue;
      const intersection = (ix1 - ix0) * (iy1 - iy0);
      const cellArea = cell.cxEmu * cell.cyEmu;
      if (cellArea <= 0) continue;
      if (intersection / cellArea < overlapThreshold) continue;

      out.push({
        rowIndex: cell.rowIndex,
        colIndex: cell.colIndex,
        source: drawing.type,
      });
    }
  }

  return out;
}

/* ═══════════════════════ Persistence ═══════════════════════ */

async function persistSoaTables(
  versionId: string,
  soaTables: SoaDetectionResult[]
): Promise<void> {
  // На больших матрицах (200+ cells) per-cell create в loop упирался в default
  // Prisma transaction timeout (5s) и падал с "Transaction not found" — см.
  // project_known_bugs.md (2026-05-02). Фикс: bulk-вставка через createMany
  // (1 SQL вместо N) + увеличенный transaction timeout как defense-in-depth.
  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.soaTable.findMany({
        where: { docVersionId: versionId },
        select: { id: true },
      });
      for (const t of existing) {
        await tx.soaCell.deleteMany({ where: { soaTableId: t.id } });
      }
      await tx.soaTable.deleteMany({ where: { docVersionId: versionId } });

      for (const soa of soaTables) {
        const table = await tx.soaTable.create({
          data: {
            docVersionId: versionId,
            sourceBlockId: soa.tableBlockId,
            sourceBlockIds: soa.sourceBlockIds,
            title: soa.title,
            soaScore: soa.score,
            status: "detected",
            orientation: soa.orientation,
            orientationConflict: soa.orientationConflict,
            headerData: { visits: soa.visits, headerRows: soa.headerRows },
            rawMatrix: soa.rawMatrix,
            drawings: soa.tableDrawings as object,
            cellGeometry: soa.cellGeometry === null
              ? undefined
              : (soa.cellGeometry as unknown as object),
          },
        });

        const visitName = (idx: number) =>
          idx < soa.visits.length ? soa.visits[idx] : `Col ${idx + 1}`;

        const cellsData: Array<{
          soaTableId: string;
          rowIndex: number;
          colIndex: number;
          procedureName: string;
          visitName: string;
          rawValue: string;
          normalizedValue: string;
          confidence: number;
          markerSources: MarkerSource[];
        }> = [];

        for (let row = 0; row < soa.procedures.length; row++) {
          for (let col = 0; col < soa.visits.length; col++) {
            const cell = soa.matrix[row]?.[col];
            if (!cell) continue;
            cellsData.push({
              soaTableId: table.id,
              rowIndex: row,
              colIndex: col,
              procedureName: soa.procedures[row],
              visitName: visitName(col),
              rawValue: cell.rawValue,
              normalizedValue: cell.normalizedValue ?? "",
              confidence: cell.confidence,
              markerSources: cell.markerSources ?? ["text"],
            });
          }
        }

        if (cellsData.length > 0) {
          await tx.soaCell.createMany({ data: cellsData });
        }

        if (soa.footnoteDefs.length === 0) continue;

        await tx.soaFootnote.createMany({
          data: soa.footnoteDefs.map((f) => ({
            soaTableId: table.id,
            marker: f.marker,
            markerOrder: f.markerOrder,
            text: f.text,
            source: "detected" as const,
          })),
        });

        if (soa.footnoteAnchors.length === 0) continue;

        // Resolve cellId / footnoteId for the anchors via lookup maps —
        // both relations were just inserted above.
        const cellRows = await tx.soaCell.findMany({
          where: { soaTableId: table.id },
          select: { id: true, rowIndex: true, colIndex: true },
        });
        const cellIdMap = new Map<string, string>();
        for (const c of cellRows) {
          cellIdMap.set(`${c.rowIndex}:${c.colIndex}`, c.id);
        }

        const footnoteRows = await tx.soaFootnote.findMany({
          where: { soaTableId: table.id },
          select: { id: true, marker: true },
        });
        const footnoteIdMap = new Map<string, string>();
        for (const f of footnoteRows) footnoteIdMap.set(f.marker, f.id);

        const anchorData: Array<{
          footnoteId: string;
          soaTableId: string;
          targetType: "cell" | "row" | "col";
          cellId: string | null;
          rowIndex: number | null;
          colIndex: number | null;
          confidence: number;
          source: "detected";
        }> = [];

        for (const a of soa.footnoteAnchors) {
          const footnoteId = footnoteIdMap.get(a.footnoteMarker);
          if (!footnoteId) continue;
          let cellId: string | null = null;
          if (a.targetType === "cell") {
            if (a.rowIndex == null || a.colIndex == null) continue;
            cellId = cellIdMap.get(`${a.rowIndex}:${a.colIndex}`) ?? null;
            if (!cellId) continue;
          }
          anchorData.push({
            footnoteId,
            soaTableId: table.id,
            targetType: a.targetType,
            cellId,
            rowIndex: a.targetType === "row" ? (a.rowIndex ?? null) : null,
            colIndex: a.targetType === "col" ? (a.colIndex ?? null) : null,
            confidence: a.confidence,
            source: "detected",
          });
        }

        if (anchorData.length > 0) {
          await tx.soaFootnoteAnchor.createMany({
            data: anchorData,
            skipDuplicates: true,
          });
        }
      }
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
