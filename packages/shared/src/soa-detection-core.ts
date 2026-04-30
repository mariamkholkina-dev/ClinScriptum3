/**
 * SOA (Schedule of Activities) detection — deterministic algorithm.
 * Extracted to @clinscriptum/shared so both API (in-process) and workers can use it.
 *
 * 5-phase algorithm: detect → score → decide → extract → normalize.
 * Supports merged header cells (colspan/rowspan) for multi-level visit names.
 */

import { prisma } from "@clinscriptum/db";

export interface SoaLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/* ═══════════════════════ Types ═══════════════════════ */

interface HtmlCell {
  text: string;
  colspan: number;
  rowspan: number;
}

interface TableCandidate {
  blockId: string;
  rawHtml: string;
  title: string;
  htmlRows: HtmlCell[][];
  rows: string[][];
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

interface SoaDetectionResult {
  tableBlockId: string;
  sectionId: string;
  title: string;
  score: number;
  visits: string[];
  headerRows: { text: string; span: number }[][];
  procedures: string[];
  matrix: SoaCellData[][];
  rawMatrix: string[][];
  footnotes: string[];
}

interface SoaCellData {
  rawValue: string;
  normalizedValue: string;
  confidence: number;
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

  const soaTables: SoaDetectionResult[] = [];

  for (const candidate of candidates) {
    const scoring = scoreTable(candidate);

    if (scoring.score < 3.5) continue;

    const isSoa = isTrueSoa(scoring);
    if (!isSoa) continue;

    log.info("[soa] SOA detected", { title: candidate.title, score: scoring.score.toFixed(1) });

    const result = buildSoaResult(candidate, scoring);
    if (result) soaTables.push(result);
  }

  if (soaTables.length === 0) {
    log.info("[soa] No SOA tables detected");
    return;
  }

  await persistSoaTables(versionId, soaTables);
  log.info("[soa] Saved SOA tables", { count: soaTables.length });
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

    for (const block of section.contentBlocks) {
      if (block.type === "paragraph" || block.type === "list") {
        lastParagraphText = block.content;
        continue;
      }

      if (block.type === "table" && block.rawHtml) {
        const htmlRows = parseHtmlTableWithSpans(block.rawHtml);
        const rows = expandGridFromHtmlRows(htmlRows);
        if (rows.length < 2 || (rows[0]?.length ?? 0) < 2) {
          lastParagraphText = "";
          continue;
        }

        candidates.push({
          blockId: block.id,
          rawHtml: block.rawHtml,
          title: detectTableTitle(lastParagraphText),
          htmlRows,
          rows,
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
  const { rows, htmlRows } = candidate;
  if (rows.length < 2) return null;

  const headerRowCount = detectHeaderRowCount(rows);
  const dataRows = rows.slice(headerRowCount);

  if (dataRows.length === 0) return null;

  const numCols = Math.max(...rows.map((r) => r.length));
  const { visits, headerLevels } = buildMultiLevelVisits(rows, htmlRows, headerRowCount, numCols);

  if (visits.length === 0) return null;

  const procedures: string[] = [];
  const matrix: SoaCellData[][] = [];
  const rawMatrix: string[][] = rows.slice(0, headerRowCount);

  for (const row of dataRows) {
    const procName = (row[0] ?? "").trim();
    if (!procName) continue;

    procedures.push(procName);
    rawMatrix.push(row);

    const cellRow: SoaCellData[] = [];
    for (let col = 1; col <= visits.length; col++) {
      const raw = (row[col] ?? "").trim();
      const normalized = normalizeMarker(raw);
      const confidence = computeCellConfidence(raw, normalized);
      cellRow.push({ rawValue: raw, normalizedValue: normalized, confidence });
    }
    matrix.push(cellRow);
  }

  if (procedures.length === 0) return null;

  return {
    tableBlockId: candidate.blockId,
    sectionId: candidate.sectionId,
    title: candidate.title || "Schedule of Activities",
    score: scoring.score,
    visits,
    headerRows: headerLevels,
    procedures,
    matrix,
    rawMatrix,
    footnotes: [],
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

  for (const rowHtml of rowMatches) {
    const cells: HtmlCell[] = [];
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cellMatches) continue;

    for (const cellHtml of cellMatches) {
      const text = stripHtmlTags(cellHtml).trim();
      const colspan = parseInt(cellHtml.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1", 10);
      const rowspan = parseInt(cellHtml.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1", 10);
      cells.push({ text, colspan, rowspan });
    }

    if (cells.length > 0) rows.push(cells);
  }

  return rows;
}

function expandGridFromHtmlRows(htmlRows: HtmlCell[][]): string[][] {
  if (htmlRows.length === 0) return [];

  let maxCols = 0;
  for (const row of htmlRows) {
    let cols = 0;
    for (const cell of row) cols += cell.colspan;
    if (cols > maxCols) maxCols = cols;
  }

  const numRows = htmlRows.length;
  const grid: (string | null)[][] = Array.from({ length: numRows }, () =>
    Array(maxCols).fill(null)
  );

  for (let r = 0; r < numRows; r++) {
    let gridCol = 0;
    for (const cell of htmlRows[r]) {
      while (gridCol < maxCols && grid[r][gridCol] !== null) {
        gridCol++;
      }
      if (gridCol >= maxCols) break;

      for (let dr = 0; dr < cell.rowspan && r + dr < numRows; dr++) {
        for (let dc = 0; dc < cell.colspan && gridCol + dc < maxCols; dc++) {
          grid[r + dr][gridCol + dc] = cell.text;
        }
      }
      gridCol += cell.colspan;
    }
  }

  return grid.map((row) => row.map((c) => c ?? ""));
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

/* ═══════════════════════ Persistence ═══════════════════════ */

async function persistSoaTables(
  versionId: string,
  soaTables: SoaDetectionResult[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
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
          title: soa.title,
          soaScore: soa.score,
          status: "detected",
          headerData: { visits: soa.visits, headerRows: soa.headerRows },
          rawMatrix: soa.rawMatrix,
          footnotes: soa.footnotes,
        },
      });

      for (let row = 0; row < soa.procedures.length; row++) {
        const visitName = (idx: number) =>
          idx < soa.visits.length ? soa.visits[idx] : `Col ${idx + 1}`;

        for (let col = 0; col < soa.visits.length; col++) {
          const cell = soa.matrix[row]?.[col];
          if (!cell) continue;

          await tx.soaCell.create({
            data: {
              soaTableId: table.id,
              rowIndex: row,
              colIndex: col,
              procedureName: soa.procedures[row],
              visitName: visitName(col),
              rawValue: cell.rawValue,
              normalizedValue: cell.normalizedValue,
              confidence: cell.confidence,
            },
          });
        }
      }
    }
  });
}
