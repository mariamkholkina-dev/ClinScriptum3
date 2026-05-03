"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  Minus,
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronRight,
  Edit3,
  Save,
  Plus,
  Trash2,
  Link2,
} from "lucide-react";

/* ═══════════════ Types ═══════════════ */

interface SoaCell {
  id: string;
  soaTableId: string;
  rowIndex: number;
  colIndex: number;
  procedureName: string;
  visitName: string;
  rawValue: string;
  normalizedValue: string;
  manualValue: string | null;
  confidence: number;
  markerSources: ("text" | "arrow" | "line" | "bracket")[];
  cellHighlight?: string | null;
}

interface SoaFootnoteAnchor {
  id: string;
  footnoteId: string;
  soaTableId: string;
  targetType: "cell" | "row" | "col";
  cellId: string | null;
  rowIndex: number | null;
  colIndex: number | null;
  confidence: number;
  source: "detected" | "manual";
}

interface SoaFootnote {
  id: string;
  soaTableId: string;
  marker: string;
  markerOrder: number;
  text: string;
  source: "detected" | "manual";
  anchors: SoaFootnoteAnchor[];
}

interface DrawingPositionUI {
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}

interface DrawingUI {
  type: "arrow" | "line" | "bracket" | "image" | "shape";
  position: DrawingPositionUI;
  direction?: "horizontal" | "vertical";
  paragraphIndex?: number;
  prstGeom?: string;
}

type VerificationLevel = "deterministic" | "llm_check" | "llm_qa";

interface SoaTable {
  id: string;
  title: string;
  soaScore: number;
  status: string;
  orientation: "visits_cols" | "visits_rows" | "unknown";
  orientationConflict: boolean;
  /** Highest pipeline level this SoA was verified at (Sprint 4). */
  verificationLevel?: VerificationLevel;
  /** LLM-reported confidence in [0,1] from the LLM Check step. Null when not run. */
  llmConfidence?: number | null;
  headerData: { visits: string[]; headerRows?: { text: string; span: number }[][] };
  rawMatrix: string[][];
  /** @deprecated string[] kept for backward-compat; new UI reads `soaFootnotes` */
  footnotes: string[];
  cells: SoaCell[];
  soaFootnotes: SoaFootnote[];
  sourceHtml: string | null;
  drawings: DrawingUI[];
}

interface SelectedCell {
  tableId: string;
  rowIndex: number;
  colIndex: number;
  cellId: string;
}

/* ═══════════════ Helpers ═══════════════ */

function cellValue(cell: SoaCell): string {
  return cell.manualValue ?? cell.normalizedValue;
}

function isPositive(val: string): boolean {
  return val === "X" || val === "x" || val === "✓" || val === "✔";
}

function isDash(val: string): boolean {
  return val === "–" || val === "—" || val === "-" || val === "−";
}

function stripHtml(html: string): string {
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

interface ParsedHtmlCell {
  text: string;
  html: string;
  colspan: number;
  rowspan: number;
  isHeader: boolean;
}

function parseSourceHtml(html: string): ParsedHtmlCell[][] {
  const rows: ParsedHtmlCell[][] = [];
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
  if (!rowMatches) return rows;

  for (const rowHtml of rowMatches) {
    const cells: ParsedHtmlCell[] = [];
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
    if (!cellMatches) continue;

    for (const cellHtml of cellMatches) {
      const text = stripHtml(cellHtml);
      const colspan = parseInt(cellHtml.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1", 10);
      const rowspan = parseInt(cellHtml.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? "1", 10);
      const isHeader = /^<th/i.test(cellHtml.trim());
      cells.push({ text, html: cellHtml, colspan, rowspan, isHeader });
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function buildSourceGrid(parsedRows: ParsedHtmlCell[][]): (ParsedHtmlCell | null)[][] {
  if (parsedRows.length === 0) return [];
  let maxCols = 0;
  for (const row of parsedRows) {
    let cols = 0;
    for (const cell of row) cols += cell.colspan;
    if (cols > maxCols) maxCols = cols;
  }
  const numRows = parsedRows.length;
  const grid: (ParsedHtmlCell | null)[][] = Array.from({ length: numRows }, () =>
    Array(maxCols).fill(null),
  );
  for (let r = 0; r < numRows; r++) {
    let gridCol = 0;
    for (const cell of parsedRows[r]) {
      while (gridCol < maxCols && grid[r][gridCol] !== null) gridCol++;
      if (gridCol >= maxCols) break;
      for (let dr = 0; dr < cell.rowspan && r + dr < numRows; dr++) {
        for (let dc = 0; dc < cell.colspan && gridCol + dc < maxCols; dc++) {
          grid[r + dr][gridCol + dc] = cell;
        }
      }
      gridCol += cell.colspan;
    }
  }
  return grid;
}

/* ═══════════════ Parsed Table ═══════════════ */

function ParsedSoaTable({
  table,
  selectedCell,
  onCellSelect,
  onCellValueChange,
}: {
  table: SoaTable;
  selectedCell: SelectedCell | null;
  onCellSelect: (cell: SelectedCell | null) => void;
  onCellValueChange: (cellId: string, value: string) => void;
}) {
  const visits = table.headerData.visits;
  const headerRows = table.headerData.headerRows ?? [];
  const procMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of table.cells) {
      if (!map.has(c.rowIndex)) map.set(c.rowIndex, c.procedureName);
    }
    return map;
  }, [table.cells]);

  const rowIndices = useMemo(
    () => Array.from(procMap.keys()).sort((a, b) => a - b),
    [procMap],
  );

  const cellMap = useMemo(() => {
    const m = new Map<string, SoaCell>();
    for (const c of table.cells) m.set(`${c.rowIndex}:${c.colIndex}`, c);
    return m;
  }, [table.cells]);

  // Map cellId → array of markers (sorted by markerOrder) for cells that have
  // cell-typed anchors. Used to render the marker superscript on each cell
  // now that legacy footnoteRefs is gone.
  const cellIdToMarkers = useMemo(() => {
    const m = new Map<string, string[]>();
    const orderedFootnotes = [...(table.soaFootnotes ?? [])].sort(
      (a, b) => a.markerOrder - b.markerOrder,
    );
    for (const f of orderedFootnotes) {
      for (const a of f.anchors) {
        if (a.targetType !== "cell" || !a.cellId) continue;
        const arr = m.get(a.cellId) ?? [];
        arr.push(f.marker);
        m.set(a.cellId, arr);
      }
    }
    return m;
  }, [table.soaFootnotes]);

  const cycleValue = useCallback(
    (cell: SoaCell) => {
      const val = cellValue(cell);
      let next: string;
      if (isPositive(val)) next = "–";
      else if (isDash(val)) next = "";
      else next = "X";
      onCellValueChange(cell.id, next);
    },
    [onCellValueChange],
  );

  return (
    <div className="overflow-auto rounded-md border border-gray-200">
      <table className="w-full text-xs border-collapse">
        <thead>
          {headerRows.map((level, li) => (
            <tr key={li} className="bg-gray-100">
              {li === 0 && (
                <th
                  className="sticky left-0 z-10 bg-gray-100 border border-gray-200 px-2 py-1.5 text-left font-medium text-gray-600 min-w-[180px]"
                  rowSpan={headerRows.length || 1}
                >
                  Процедура
                </th>
              )}
              {level.map((h, hi) => (
                <th
                  key={hi}
                  colSpan={h.span}
                  className="border border-gray-200 px-2 py-1.5 text-center font-medium text-gray-600 whitespace-nowrap"
                >
                  {h.text}
                </th>
              ))}
            </tr>
          ))}
          {headerRows.length === 0 && (
            <tr className="bg-gray-100">
              <th className="sticky left-0 z-10 bg-gray-100 border border-gray-200 px-2 py-1.5 text-left font-medium text-gray-600 min-w-[180px]">
                Процедура
              </th>
              {visits.map((v, vi) => (
                <th
                  key={vi}
                  className="border border-gray-200 px-2 py-1.5 text-center font-medium text-gray-600 whitespace-nowrap"
                >
                  {v}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rowIndices.map((rowIdx) => {
            const proc = procMap.get(rowIdx) ?? "";
            return (
              <tr key={rowIdx} className="hover:bg-gray-50">
                <td className="sticky left-0 z-10 bg-white border border-gray-200 px-2 py-1 font-medium text-gray-800 whitespace-nowrap">
                  {proc}
                </td>
                {visits.map((_, colIdx) => {
                  const cell = cellMap.get(`${rowIdx}:${colIdx}`);
                  if (!cell) {
                    return <td key={colIdx} className="border border-gray-200 px-2 py-1 text-center text-gray-300">&mdash;</td>;
                  }
                  const val = cellValue(cell);
                  const isSelected =
                    selectedCell?.tableId === table.id &&
                    selectedCell.rowIndex === rowIdx &&
                    selectedCell.colIndex === colIdx;
                  const lowConf = cell.confidence < 0.8;
                  const markerSup = (cellIdToMarkers.get(cell.id) ?? []).join(",");

                  let bgClass = "";
                  if (isSelected) bgClass = "bg-brand-100 ring-2 ring-brand-500 ring-inset";
                  else if (lowConf) bgClass = "bg-amber-50";
                  else if (isPositive(val)) bgClass = "bg-green-50";
                  else if (isDash(val)) bgClass = "bg-gray-50";

                  // Source-document highlight (e.g. "#FFFF00" yellow from
                  // <w:shd>) takes visual priority over zone-color classes.
                  // Tooltip explains the highlight to reviewers.
                  const highlightStyle = cell.cellHighlight
                    ? { backgroundColor: cell.cellHighlight }
                    : undefined;
                  const highlightTitle = cell.cellHighlight
                    ? "Выделено в исходном документе"
                    : undefined;

                  return (
                    <td
                      key={colIdx}
                      className={`border border-gray-200 px-1 py-1 text-center cursor-pointer relative select-none ${bgClass}`}
                      style={highlightStyle}
                      title={highlightTitle}
                      onClick={() =>
                        isSelected
                          ? onCellSelect(null)
                          : onCellSelect({ tableId: table.id, rowIndex: rowIdx, colIndex: colIdx, cellId: cell.id })
                      }
                      onDoubleClick={() => cycleValue(cell)}
                    >
                      <span className={`font-bold text-sm ${isPositive(val) ? "text-green-700" : isDash(val) ? "text-gray-400" : "text-gray-700"}`}>
                        {isPositive(val) ? "✓" : isDash(val) ? "–" : val || ""}
                      </span>
                      {lowConf && (
                        <span className="absolute top-0 right-0.5 text-amber-500" title="Низкая уверенность — требует проверки">
                          <AlertTriangle size={9} />
                        </span>
                      )}
                      {markerSup && (
                        <sup className="absolute bottom-0 right-0.5 text-[8px] text-blue-600 font-bold">
                          {markerSup}
                        </sup>
                      )}
                      {cell.markerSources?.some((s) => s !== "text") && (
                        <span
                          className="absolute top-0 left-0.5 text-[9px]"
                          title={`Получено из ${cell.markerSources
                            .filter((s) => s !== "text")
                            .join(", ")}`}
                        >
                          {cell.markerSources.includes("arrow") ? "→" : "│"}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════ Source HTML Table ═══════════════ */

function SourceHtmlTable({
  sourceHtml,
  rawMatrix,
  selectedCell,
  headerRowCount,
}: {
  sourceHtml: string | null;
  rawMatrix: string[][];
  selectedCell: SelectedCell | null;
  headerRowCount: number;
}) {
  const parsedRows = useMemo(() => {
    if (sourceHtml) return parseSourceHtml(sourceHtml);
    return [];
  }, [sourceHtml]);

  const sourceGrid = useMemo(() => buildSourceGrid(parsedRows), [parsedRows]);

  if (!sourceHtml && rawMatrix.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400 italic">
        Исходная таблица недоступна.
      </p>
    );
  }

  if (parsedRows.length === 0 && rawMatrix.length > 0) {
    const sourceRowIdx = selectedCell ? selectedCell.rowIndex + headerRowCount : -1;
    const sourceColIdx = selectedCell ? selectedCell.colIndex + 1 : -1;

    return (
      <div className="overflow-auto rounded-md border border-gray-200">
        <table className="w-full text-xs border-collapse">
          <tbody>
            {rawMatrix.map((row, ri) => (
              <tr key={ri} className={ri < headerRowCount ? "bg-gray-100 font-medium" : ""}>
                {row.map((cell, ci) => {
                  const isHighlighted = ri === sourceRowIdx && ci === sourceColIdx;
                  return (
                    <td
                      key={ci}
                      className={`border border-gray-200 px-2 py-1 whitespace-nowrap ${
                        isHighlighted ? "bg-brand-200 ring-2 ring-brand-500 ring-inset font-bold" : ""
                      }`}
                    >
                      {cell || " "}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const rendered = new Set<string>();

  return (
    <div className="overflow-auto rounded-md border border-gray-200">
      <table className="w-full text-xs border-collapse">
        <tbody>
          {parsedRows.map((row, ri) => {
            let gridCol = 0;
            return (
              <tr key={ri} className={ri < headerRowCount ? "bg-gray-100 font-medium" : ""}>
                {row.map((cell, ci) => {
                  while (gridCol < sourceGrid[ri]?.length && sourceGrid[ri][gridCol] !== cell) {
                    gridCol++;
                  }
                  const cellKey = `${ri}:${gridCol}`;
                  if (rendered.has(cellKey)) {
                    gridCol += cell.colspan;
                    return null;
                  }
                  rendered.add(cellKey);

                  const sourceRow = ri - headerRowCount;
                  const sourceCol = gridCol - 1;
                  const isHighlighted =
                    selectedCell != null &&
                    sourceRow === selectedCell.rowIndex &&
                    sourceCol === selectedCell.colIndex;

                  gridCol += cell.colspan;

                  return (
                    <td
                      key={ci}
                      colSpan={cell.colspan}
                      rowSpan={cell.rowspan}
                      className={`border border-gray-200 px-2 py-1 whitespace-nowrap ${
                        cell.isHeader ? "font-medium text-gray-700" : "text-gray-600"
                      } ${isHighlighted ? "bg-brand-200 ring-2 ring-brand-500 ring-inset font-bold" : ""}`}
                    >
                      {cell.text || " "}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════ Footnotes Panel (normalized) ═══════════════ */

interface FootnoteMutations {
  create: ReturnType<typeof trpc.soaFootnote.create.useMutation>;
  update: ReturnType<typeof trpc.soaFootnote.update.useMutation>;
  delete: ReturnType<typeof trpc.soaFootnote.delete.useMutation>;
  linkAnchor: ReturnType<typeof trpc.soaFootnote.linkAnchor.useMutation>;
  unlinkAnchor: ReturnType<typeof trpc.soaFootnote.unlinkAnchor.useMutation>;
}

function anchorBadges(footnote: SoaFootnote): { cells: number; rows: number; cols: number } {
  let cells = 0;
  let rows = 0;
  let cols = 0;
  for (const a of footnote.anchors) {
    if (a.targetType === "cell") cells++;
    else if (a.targetType === "row") rows++;
    else if (a.targetType === "col") cols++;
  }
  return { cells, rows, cols };
}

function FootnoteRow({
  footnote,
  table,
  selectedCell,
  isHighlighted,
  mutations,
}: {
  footnote: SoaFootnote;
  table: SoaTable;
  selectedCell: SelectedCell | null;
  isHighlighted: boolean;
  mutations: FootnoteMutations;
}) {
  const [editing, setEditing] = useState(false);
  const [marker, setMarker] = useState(footnote.marker);
  const [text, setText] = useState(footnote.text);

  useEffect(() => {
    setMarker(footnote.marker);
    setText(footnote.text);
  }, [footnote.marker, footnote.text]);

  const cellAnchorForSelected = useMemo(() => {
    if (!selectedCell || selectedCell.tableId !== table.id) return null;
    return (
      footnote.anchors.find(
        (a) => a.targetType === "cell" && a.cellId === selectedCell.cellId,
      ) ?? null
    );
  }, [footnote.anchors, selectedCell, table.id]);

  const isLinkedToSelected = cellAnchorForSelected != null;

  const handleSave = useCallback(() => {
    const nextMarker = marker.trim();
    const nextText = text;
    const patch: { marker?: string; text?: string } = {};
    if (nextMarker && nextMarker !== footnote.marker) patch.marker = nextMarker;
    if (nextText !== footnote.text) patch.text = nextText;
    if (Object.keys(patch).length > 0) {
      mutations.update.mutate({ footnoteId: footnote.id, ...patch });
    }
    setEditing(false);
  }, [marker, text, footnote.id, footnote.marker, footnote.text, mutations.update]);

  const toggleCellLink = useCallback(() => {
    if (!selectedCell || selectedCell.tableId !== table.id) return;
    if (cellAnchorForSelected) {
      mutations.unlinkAnchor.mutate({ anchorId: cellAnchorForSelected.id });
    } else {
      mutations.linkAnchor.mutate({
        footnoteId: footnote.id,
        target: { type: "cell", cellId: selectedCell.cellId },
      });
    }
  }, [cellAnchorForSelected, selectedCell, table.id, footnote.id, mutations.linkAnchor, mutations.unlinkAnchor]);

  const badges = anchorBadges(footnote);

  return (
    <div
      className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
        isHighlighted ? "bg-brand-100 ring-1 ring-brand-400" : "bg-gray-50"
      }`}
    >
      {selectedCell?.tableId === table.id && !editing && (
        <button
          onClick={toggleCellLink}
          className={`mt-0.5 shrink-0 rounded border ${
            isLinkedToSelected
              ? "border-brand-500 bg-brand-500 text-white"
              : "border-gray-300 text-transparent hover:border-brand-400"
          }`}
          title={isLinkedToSelected ? "Отвязать сноску от ячейки" : "Привязать сноску к ячейке"}
        >
          <Check size={10} />
        </button>
      )}
      {editing ? (
        <>
          <input
            value={marker}
            onChange={(e) => setMarker(e.target.value)}
            className="w-10 shrink-0 rounded border border-gray-300 px-1 py-0.5 text-xs font-bold text-center"
            maxLength={8}
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
            placeholder="Текст сноски..."
          />
          <button
            onClick={handleSave}
            className="text-brand-600 hover:text-brand-700"
            title="Сохранить"
          >
            <Save size={11} />
          </button>
          <button
            onClick={() => {
              setMarker(footnote.marker);
              setText(footnote.text);
              setEditing(false);
            }}
            className="text-gray-400 hover:text-gray-600"
            title="Отмена"
          >
            <X size={11} />
          </button>
        </>
      ) : (
        <>
          <span className="shrink-0 font-bold text-gray-600 w-6 text-center">{footnote.marker}</span>
          <span className="flex-1 text-gray-700">{footnote.text || <em className="text-gray-400">(без текста)</em>}</span>
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-gray-500">
            {badges.cells > 0 && (
              <span className="rounded bg-blue-100 px-1 py-0.5 text-blue-700" title="Ячеек">
                {badges.cells}c
              </span>
            )}
            {badges.rows > 0 && (
              <span className="rounded bg-purple-100 px-1 py-0.5 text-purple-700" title="Строк">
                {badges.rows}r
              </span>
            )}
            {badges.cols > 0 && (
              <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-700" title="Столбцов">
                {badges.cols}col
              </span>
            )}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-gray-400 hover:text-brand-600"
            title="Редактировать"
          >
            <Edit3 size={11} />
          </button>
          <button
            onClick={() => {
              if (confirm(`Удалить сноску '${footnote.marker}'?`)) {
                mutations.delete.mutate({ footnoteId: footnote.id });
              }
            }}
            className="text-gray-400 hover:text-red-500"
            title="Удалить"
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </div>
  );
}

function FootnotesPanel({
  table,
  selectedCell,
  highlightedFootnoteIds,
  mutations,
}: {
  table: SoaTable;
  selectedCell: SelectedCell | null;
  highlightedFootnoteIds: string[];
  mutations: FootnoteMutations;
}) {
  const footnotes = table.soaFootnotes ?? [];
  const [newMarker, setNewMarker] = useState("");
  const [newText, setNewText] = useState("");
  const [bindMode, setBindMode] = useState<"row" | "col" | null>(null);
  const [bindFootnoteId, setBindFootnoteId] = useState<string>("");
  const [bindIndex, setBindIndex] = useState<number>(0);

  const handleAdd = useCallback(() => {
    const m = newMarker.trim();
    if (!m) return;
    mutations.create.mutate(
      { soaTableId: table.id, marker: m, text: newText },
      {
        onSuccess: () => {
          setNewMarker("");
          setNewText("");
        },
      },
    );
  }, [newMarker, newText, table.id, mutations.create]);

  const handleBind = useCallback(() => {
    if (!bindMode || !bindFootnoteId) return;
    mutations.linkAnchor.mutate(
      {
        footnoteId: bindFootnoteId,
        target:
          bindMode === "row"
            ? { type: "row", rowIndex: bindIndex }
            : { type: "col", colIndex: bindIndex },
      },
      {
        onSuccess: () => {
          setBindMode(null);
          setBindFootnoteId("");
          setBindIndex(0);
        },
      },
    );
  }, [bindMode, bindFootnoteId, bindIndex, mutations.linkAnchor]);

  const visits = table.headerData.visits;
  const procedureNames = useMemo(() => {
    const seen = new Set<number>();
    const out: { rowIndex: number; name: string }[] = [];
    for (const c of table.cells) {
      if (seen.has(c.rowIndex)) continue;
      seen.add(c.rowIndex);
      out.push({ rowIndex: c.rowIndex, name: c.procedureName });
    }
    out.sort((a, b) => a.rowIndex - b.rowIndex);
    return out;
  }, [table.cells]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">
          Сноски ({footnotes.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setBindMode(bindMode === "row" ? null : "row")}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
              bindMode === "row" ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"
            }`}
            title="Привязать сноску к строке (процедуре)"
          >
            <Link2 size={10} /> Строка
          </button>
          <button
            onClick={() => setBindMode(bindMode === "col" ? null : "col")}
            className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] ${
              bindMode === "col" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-gray-200 text-gray-500 hover:border-amber-300"
            }`}
            title="Привязать сноску к столбцу (визиту)"
          >
            <Link2 size={10} /> Столбец
          </button>
        </div>
      </div>

      {bindMode && (
        <div className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-[10px]">
          <select
            value={bindFootnoteId}
            onChange={(e) => setBindFootnoteId(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-1 py-0.5"
          >
            <option value="">— выберите сноску —</option>
            {footnotes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.marker} — {f.text.slice(0, 30) || "(без текста)"}
              </option>
            ))}
          </select>
          <select
            value={bindIndex}
            onChange={(e) => setBindIndex(parseInt(e.target.value, 10))}
            className="flex-1 rounded border border-gray-300 px-1 py-0.5"
          >
            {(bindMode === "row" ? procedureNames : visits.map((v, i) => ({ rowIndex: i, name: v }))).map(
              (item) => (
                <option key={item.rowIndex} value={item.rowIndex}>
                  {item.name}
                </option>
              ),
            )}
          </select>
          <button
            onClick={handleBind}
            disabled={!bindFootnoteId}
            className="rounded bg-brand-600 px-2 py-0.5 text-white hover:bg-brand-700 disabled:opacity-40"
          >
            Привязать
          </button>
        </div>
      )}

      <div className="space-y-1">
        {footnotes.length === 0 && (
          <span className="text-xs text-gray-400 italic">
            Сноски не обнаружены — добавьте вручную через форму ниже.
          </span>
        )}
        {footnotes.map((f) => (
          <FootnoteRow
            key={f.id}
            footnote={f}
            table={table}
            selectedCell={selectedCell}
            isHighlighted={highlightedFootnoteIds.includes(f.id)}
            mutations={mutations}
          />
        ))}
      </div>

      <div className="flex items-center gap-1 pt-1">
        <input
          value={newMarker}
          onChange={(e) => setNewMarker(e.target.value)}
          placeholder="*"
          maxLength={8}
          className="w-12 rounded border border-gray-300 px-1 py-0.5 text-xs font-bold text-center"
        />
        <input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Текст сноски..."
          className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
        />
        <button
          onClick={handleAdd}
          disabled={!newMarker.trim()}
          className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white hover:bg-brand-700 disabled:opacity-40"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════ Cell Detail Panel ═══════════════ */

function CellDetailPanel({
  cell,
  visits,
  verificationLevel,
  llmConfidence,
  onValueChange,
}: {
  cell: SoaCell;
  visits: string[];
  verificationLevel?: VerificationLevel;
  llmConfidence?: number | null;
  onValueChange: (cellId: string, value: string) => void;
}) {
  const val = cellValue(cell);

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/50 px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-700">
          {cell.procedureName} &rarr; {visits[cell.colIndex] ?? `Col ${cell.colIndex}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onValueChange(cell.id, "X")}
            className={`rounded px-2 py-0.5 border ${isPositive(val) ? "bg-green-100 border-green-400 text-green-700 font-bold" : "border-gray-300 text-gray-500 hover:border-green-300"}`}
          >
            <Check size={11} />
          </button>
          <button
            onClick={() => onValueChange(cell.id, "–")}
            className={`rounded px-2 py-0.5 border ${isDash(val) ? "bg-gray-200 border-gray-400 text-gray-700 font-bold" : "border-gray-300 text-gray-500 hover:border-gray-400"}`}
          >
            <Minus size={11} />
          </button>
          <button
            onClick={() => onValueChange(cell.id, "")}
            className={`rounded px-2 py-0.5 border ${!val ? "bg-red-50 border-red-300 text-red-600 font-bold" : "border-gray-300 text-gray-500 hover:border-red-300"}`}
          >
            <X size={11} />
          </button>
        </div>
      </div>
      <div className="flex gap-4 text-[10px] text-gray-500">
        <span>Исходное: &ldquo;{cell.rawValue || "—"}&rdquo;</span>
        <span>Нормализовано: &ldquo;{cell.normalizedValue || "—"}&rdquo;</span>
        <span>Уверенность: {Math.round(cell.confidence * 100)}%</span>
        {cell.markerSources && cell.markerSources.some((s) => s !== "text") && (
          <span className="text-blue-700 font-medium">
            Источник: {cell.markerSources.filter((s) => s !== "text").join(", ")}
          </span>
        )}
        {verificationLevel && verificationLevel !== "deterministic" && (
          <span className={verificationLevel === "llm_check" ? "text-blue-700" : "text-amber-700"}>
            Уровень: {verificationLevel}
            {typeof llmConfidence === "number"
              ? ` · LLM ${Math.round(llmConfidence * 100)}%`
              : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ Single Table Viewer ═══════════════ */

function SingleSoaTableViewer({
  table,
  selectedCell,
  onCellSelect,
  updateCellMutation,
  setStatusMutation,
  footnoteMutations,
}: {
  table: SoaTable;
  selectedCell: SelectedCell | null;
  onCellSelect: (cell: SelectedCell | null) => void;
  updateCellMutation: ReturnType<typeof trpc.processing.updateSoaCell.useMutation>;
  setStatusMutation: ReturnType<typeof trpc.processing.setSoaTableStatus.useMutation>;
  footnoteMutations: FootnoteMutations;
}) {
  const [showSource, setShowSource] = useState(true);
  const [showFootnotes, setShowFootnotes] = useState(true);

  const isNotSoa = table.status === "not_soa";

  const headerRowCount = useMemo(() => {
    const headerRows = table.headerData.headerRows ?? [];
    return Math.max(headerRows.length, 1);
  }, [table.headerData]);

  const selectedCellData = useMemo(() => {
    if (!selectedCell || selectedCell.tableId !== table.id) return null;
    return table.cells.find(
      (c) => c.rowIndex === selectedCell.rowIndex && c.colIndex === selectedCell.colIndex,
    );
  }, [selectedCell, table]);

  const highlightedFootnoteIds = useMemo(() => {
    if (!selectedCellData) return [];
    const ids = new Set<string>();
    for (const f of table.soaFootnotes ?? []) {
      for (const a of f.anchors) {
        if (a.targetType === "cell" && a.cellId === selectedCellData.id) ids.add(f.id);
      }
    }
    return Array.from(ids);
  }, [selectedCellData, table.soaFootnotes]);

  const lowConfCount = useMemo(
    () => table.cells.filter((c) => c.confidence < 0.8).length,
    [table.cells],
  );

  const handleCellValueChange = useCallback(
    (cellId: string, value: string) => {
      updateCellMutation.mutate({ cellId, manualValue: value });
    },
    [updateCellMutation],
  );

  return (
    <div className={`rounded-lg border ${isNotSoa ? "border-red-200 bg-red-50/30" : "border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${isNotSoa ? "text-red-500 line-through" : "text-gray-900"}`}>
            {table.title || "SOA"}
          </span>
          {isNotSoa && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
              Не SOA
            </span>
          )}
          {table.status === "validated" && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
              Подтверждена
            </span>
          )}
          {table.orientation === "visits_rows" && (
            <span
              className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700"
              title="Визиты были в строках в исходном документе — таблица автоматически транспонирована к каноническому виду"
            >
              Транспонирована
            </span>
          )}
          {table.orientation === "unknown" && (
            <span
              className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
              title="Ориентацию не удалось определить однозначно — проверьте вручную"
            >
              Ориентация ?
            </span>
          )}
          {table.orientationConflict && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              title="В документе есть SoA с разной ориентацией — приоритет дан таблице с визитами в столбцах"
            >
              Конфликт ориентации
            </span>
          )}
          {table.drawings && table.drawings.length > 0 && (
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
              title={`В исходном DOCX обнаружено ${table.drawings.length} графических объектов поверх таблицы`}
            >
              Графика: {table.drawings.length}
            </span>
          )}
          {table.verificationLevel === "llm_check" && (
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
              title="LLM Check выполнен в момент detect; уровень определяет согласие или конфликт детерминистики и LLM"
            >
              Проверено LLM{typeof table.llmConfidence === "number"
                ? ` (${Math.round(table.llmConfidence * 100)}%)`
                : ""}
            </span>
          )}
          {table.verificationLevel === "llm_qa" && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
              title="LLM Check выполнен в момент detect; уровень определяет согласие или конфликт детерминистики и LLM"
            >
              Требует проверки LLM QA{typeof table.llmConfidence === "number"
                ? ` (${Math.round(table.llmConfidence * 100)}%)`
                : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {lowConfCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle size={11} /> {lowConfCount} треб. проверки
            </span>
          )}
          <span>Процедур: {new Set(table.cells.map((c) => c.procedureName)).size}</span>
          <span>Визитов: {table.headerData.visits.length}</span>
          {table.soaScore > 0 && <span>Оценка: {Math.round(table.soaScore * 10) / 10}</span>}
          <div className="flex items-center gap-1 ml-2">
            {!isNotSoa && (
              <button
                onClick={() => setStatusMutation.mutate({ soaTableId: table.id, status: "not_soa" })}
                className="rounded border border-red-200 bg-white px-2 py-0.5 text-red-600 hover:bg-red-50"
                title="Пометить как не-SOA"
              >
                <Ban size={11} />
              </button>
            )}
            {isNotSoa && (
              <button
                onClick={() => setStatusMutation.mutate({ soaTableId: table.id, status: "detected" })}
                className="rounded border border-green-200 bg-white px-2 py-0.5 text-green-600 hover:bg-green-50"
                title="Вернуть статус SOA"
              >
                <Check size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!isNotSoa && (
        <div className="space-y-3 p-3">
          {/* Top: Parsed table */}
          <div>
            <h4 className="mb-1.5 text-xs font-semibold text-gray-600">Результат парсинга</h4>
            <ParsedSoaTable
              table={table}
              selectedCell={selectedCell}
              onCellSelect={onCellSelect}
              onCellValueChange={handleCellValueChange}
            />
          </div>

          {/* Cell detail */}
          {selectedCellData && (
            <CellDetailPanel
              cell={selectedCellData}
              visits={table.headerData.visits}
              verificationLevel={table.verificationLevel}
              llmConfidence={table.llmConfidence}
              onValueChange={handleCellValueChange}
            />
          )}

          {/* Bottom: Source table */}
          <div>
            <button
              onClick={() => setShowSource((v) => !v)}
              className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-800"
            >
              {showSource ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Исходная таблица
            </button>
            {showSource && (
              <SourceHtmlTable
                sourceHtml={table.sourceHtml}
                rawMatrix={table.rawMatrix as string[][]}
                selectedCell={selectedCell?.tableId === table.id ? selectedCell : null}
                headerRowCount={headerRowCount}
              />
            )}
          </div>

          {/* Footnotes */}
          <div>
            <button
              onClick={() => setShowFootnotes((v) => !v)}
              className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-800"
            >
              {showFootnotes ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Сноски
            </button>
            {showFootnotes && (
              <FootnotesPanel
                table={table}
                selectedCell={selectedCell?.tableId === table.id ? selectedCell : null}
                highlightedFootnoteIds={highlightedFootnoteIds}
                mutations={footnoteMutations}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Main Export ═══════════════ */

export default function SoaStageViewer({
  versionId,
}: {
  versionId: string;
  expectedResults?: unknown;
}) {
  const utils = trpc.useUtils();
  const q = trpc.processing.getSoaData.useQuery(
    { docVersionId: versionId },
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const invalidate = useCallback(
    () => utils.processing.getSoaData.invalidate({ docVersionId: versionId }),
    [utils, versionId],
  );

  const updateCellMutation = trpc.processing.updateSoaCell.useMutation({ onSuccess: invalidate });
  const setStatusMutation = trpc.processing.setSoaTableStatus.useMutation({ onSuccess: invalidate });

  const footnoteMutations: FootnoteMutations = {
    create: trpc.soaFootnote.create.useMutation({ onSuccess: invalidate }),
    update: trpc.soaFootnote.update.useMutation({ onSuccess: invalidate }),
    delete: trpc.soaFootnote.delete.useMutation({ onSuccess: invalidate }),
    linkAnchor: trpc.soaFootnote.linkAnchor.useMutation({ onSuccess: invalidate }),
    unlinkAnchor: trpc.soaFootnote.unlinkAnchor.useMutation({ onSuccess: invalidate }),
  };

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={18} className="animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Загрузка SOA данных...</span>
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle size={16} /> {q.error.message}
      </div>
    );
  }

  const tables = (q.data ?? []) as unknown as SoaTable[];
  if (tables.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400 italic">SOA таблицы не обнаружены.</p>;
  }

  const soaTables = tables.filter((t) => t.status !== "not_soa");
  const notSoaTables = tables.filter((t) => t.status === "not_soa");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="rounded bg-gray-100 px-2 py-1 font-medium">
          Таблиц: {tables.length}
        </span>
        {notSoaTables.length > 0 && (
          <span className="rounded bg-red-50 px-2 py-1 text-red-600">
            Не-SOA: {notSoaTables.length}
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto">
          Двойной клик по ячейке — переключить значение
        </span>
      </div>

      {soaTables.some((t) => t.orientationConflict) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            <strong className="font-medium">Конфликт ориентации SoA-таблиц.</strong>
            <span className="ml-1">
              В документе обнаружены таблицы с разной ориентацией (визиты в
              столбцах vs визиты в строках). Приоритет отдан таблицам с
              визитами в столбцах — остальные помечены бейджем «Конфликт
              ориентации» и могут отражать данные неточно. Проверьте их
              вручную.
            </span>
          </div>
        </div>
      )}

      {soaTables.map((table) => (
        <SingleSoaTableViewer
          key={table.id}
          table={table}
          selectedCell={selectedCell}
          onCellSelect={setSelectedCell}
          updateCellMutation={updateCellMutation}
          setStatusMutation={setStatusMutation}
          footnoteMutations={footnoteMutations}
        />
      ))}

      {notSoaTables.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Исключённые таблицы
          </h4>
          {notSoaTables.map((table) => (
            <SingleSoaTableViewer
              key={table.id}
              table={table}
              selectedCell={selectedCell}
              onCellSelect={setSelectedCell}
              updateCellMutation={updateCellMutation}
              setStatusMutation={setStatusMutation}
              footnoteMutations={footnoteMutations}
            />
          ))}
        </div>
      )}
    </div>
  );
}
