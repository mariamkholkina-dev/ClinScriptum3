"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
  footnoteRefs: number[];
}

interface SoaTable {
  id: string;
  title: string;
  soaScore: number;
  status: string;
  headerData: { visits: string[]; headerRows?: { text: string; span: number }[][] };
  rawMatrix: string[][];
  footnotes: string[];
  cells: SoaCell[];
  sourceHtml: string | null;
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

  const [editingCellId, setEditingCellId] = useState<string | null>(null);

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
                  const hasFootnote = Array.isArray(cell.footnoteRefs) && cell.footnoteRefs.length > 0;

                  let bgClass = "";
                  if (isSelected) bgClass = "bg-brand-100 ring-2 ring-brand-500 ring-inset";
                  else if (lowConf) bgClass = "bg-amber-50";
                  else if (isPositive(val)) bgClass = "bg-green-50";
                  else if (isDash(val)) bgClass = "bg-gray-50";

                  return (
                    <td
                      key={colIdx}
                      className={`border border-gray-200 px-1 py-1 text-center cursor-pointer relative select-none ${bgClass}`}
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
                      {hasFootnote && (
                        <sup className="absolute bottom-0 right-0.5 text-[8px] text-blue-600 font-bold">
                          {(cell.footnoteRefs as number[]).join(",")}
                        </sup>
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
                      {cell || " "}
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
                      {cell.text || " "}
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

/* ═══════════════ Footnotes Panel ═══════════════ */

function FootnotesPanel({
  table,
  selectedCell,
  highlightedFootnotes,
  onUpdateFootnoteRefs,
  onUpdateFootnotes,
}: {
  table: SoaTable;
  selectedCell: SelectedCell | null;
  highlightedFootnotes: number[];
  onUpdateFootnoteRefs: (cellId: string, refs: number[]) => void;
  onUpdateFootnotes: (tableId: string, footnotes: string[]) => void;
}) {
  const footnotes = (table.footnotes ?? []) as string[];
  const [isEditing, setIsEditing] = useState(false);
  const [editedFootnotes, setEditedFootnotes] = useState(footnotes);
  const [newFootnote, setNewFootnote] = useState("");

  useEffect(() => {
    setEditedFootnotes(footnotes);
  }, [footnotes.length]);

  const selectedCellData = useMemo(() => {
    if (!selectedCell || selectedCell.tableId !== table.id) return null;
    return table.cells.find(
      (c) => c.rowIndex === selectedCell.rowIndex && c.colIndex === selectedCell.colIndex,
    );
  }, [selectedCell, table]);

  const cellFootnoteRefs: number[] = useMemo(() => {
    if (!selectedCellData) return [];
    return (selectedCellData.footnoteRefs ?? []) as number[];
  }, [selectedCellData]);

  const toggleFootnoteRef = useCallback(
    (index: number) => {
      if (!selectedCellData) return;
      const current = [...cellFootnoteRefs];
      const pos = current.indexOf(index);
      if (pos >= 0) current.splice(pos, 1);
      else current.push(index);
      current.sort((a, b) => a - b);
      onUpdateFootnoteRefs(selectedCellData.id, current);
    },
    [selectedCellData, cellFootnoteRefs, onUpdateFootnoteRefs],
  );

  const handleSaveFootnotes = useCallback(() => {
    const cleaned = editedFootnotes.filter((f) => f.trim().length > 0);
    onUpdateFootnotes(table.id, cleaned);
    setIsEditing(false);
  }, [editedFootnotes, table.id, onUpdateFootnotes]);

  const addFootnote = useCallback(() => {
    if (!newFootnote.trim()) return;
    setEditedFootnotes((prev) => [...prev, newFootnote.trim()]);
    setNewFootnote("");
  }, [newFootnote]);

  if (footnotes.length === 0 && !isEditing) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 italic">
        <span>Сноски не обнаружены.</span>
        <button
          onClick={() => setIsEditing(true)}
          className="text-brand-600 hover:text-brand-700 not-italic"
        >
          Добавить вручную
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">
          Сноски ({footnotes.length})
        </span>
        <button
          onClick={() => {
            if (isEditing) handleSaveFootnotes();
            else setIsEditing(true);
          }}
          className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
        >
          {isEditing ? <><Save size={11} /> Сохранить</> : <><Edit3 size={11} /> Редактировать</>}
        </button>
      </div>
      <div className="space-y-1">
        {(isEditing ? editedFootnotes : footnotes).map((fn, idx) => {
          const isHighlighted = highlightedFootnotes.includes(idx);
          const isLinked = cellFootnoteRefs.includes(idx);

          return (
            <div
              key={idx}
              className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                isHighlighted ? "bg-brand-100 ring-1 ring-brand-400" : "bg-gray-50"
              }`}
            >
              {selectedCellData && !isEditing && (
                <button
                  onClick={() => toggleFootnoteRef(idx)}
                  className={`mt-0.5 shrink-0 rounded border ${
                    isLinked
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-gray-300 text-transparent hover:border-brand-400"
                  }`}
                  title={isLinked ? "Отвязать сноску" : "Привязать сноску к ячейке"}
                >
                  <Check size={10} />
                </button>
              )}
              <span className="shrink-0 font-bold text-gray-500 w-5 text-right">
                {idx + 1}.
              </span>
              {isEditing ? (
                <div className="flex flex-1 items-center gap-1">
                  <input
                    value={editedFootnotes[idx]}
                    onChange={(e) => {
                      const next = [...editedFootnotes];
                      next[idx] = e.target.value;
                      setEditedFootnotes(next);
                    }}
                    className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
                  />
                  <button
                    onClick={() => setEditedFootnotes((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-red-400 hover:text-red-600"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ) : (
                <span className="text-gray-700">{fn}</span>
              )}
            </div>
          );
        })}
        {isEditing && (
          <div className="flex items-center gap-1 pt-1">
            <input
              value={newFootnote}
              onChange={(e) => setNewFootnote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addFootnote()}
              placeholder="Новая сноска..."
              className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs"
            />
            <button
              onClick={addFootnote}
              disabled={!newFootnote.trim()}
              className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Plus size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ Cell Detail Panel ═══════════════ */

function CellDetailPanel({
  cell,
  visits,
  onValueChange,
}: {
  cell: SoaCell;
  visits: string[];
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
  updateFootnoteRefsMutation,
  updateFootnotesMutation,
  setStatusMutation,
}: {
  table: SoaTable;
  selectedCell: SelectedCell | null;
  onCellSelect: (cell: SelectedCell | null) => void;
  updateCellMutation: ReturnType<typeof trpc.processing.updateSoaCell.useMutation>;
  updateFootnoteRefsMutation: ReturnType<typeof trpc.processing.updateSoaCellFootnoteRefs.useMutation>;
  updateFootnotesMutation: ReturnType<typeof trpc.processing.updateSoaTableFootnotes.useMutation>;
  setStatusMutation: ReturnType<typeof trpc.processing.setSoaTableStatus.useMutation>;
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

  const highlightedFootnotes = useMemo(() => {
    if (!selectedCellData) return [];
    return (selectedCellData.footnoteRefs ?? []) as number[];
  }, [selectedCellData]);

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

  const handleFootnoteRefsUpdate = useCallback(
    (cellId: string, refs: number[]) => {
      updateFootnoteRefsMutation.mutate({ cellId, footnoteRefs: refs });
    },
    [updateFootnoteRefsMutation],
  );

  const handleFootnotesUpdate = useCallback(
    (tableId: string, footnotes: string[]) => {
      updateFootnotesMutation.mutate({ soaTableId: tableId, footnotes });
    },
    [updateFootnotesMutation],
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
                highlightedFootnotes={highlightedFootnotes}
                onUpdateFootnoteRefs={handleFootnoteRefsUpdate}
                onUpdateFootnotes={handleFootnotesUpdate}
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

  const updateCellMutation = trpc.processing.updateSoaCell.useMutation({
    onSuccess: () => utils.processing.getSoaData.invalidate({ docVersionId: versionId }),
  });

  const updateFootnoteRefsMutation = trpc.processing.updateSoaCellFootnoteRefs.useMutation({
    onSuccess: () => utils.processing.getSoaData.invalidate({ docVersionId: versionId }),
  });

  const updateFootnotesMutation = trpc.processing.updateSoaTableFootnotes.useMutation({
    onSuccess: () => utils.processing.getSoaData.invalidate({ docVersionId: versionId }),
  });

  const setStatusMutation = trpc.processing.setSoaTableStatus.useMutation({
    onSuccess: () => utils.processing.getSoaData.invalidate({ docVersionId: versionId }),
  });

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

      {soaTables.map((table) => (
        <SingleSoaTableViewer
          key={table.id}
          table={table}
          selectedCell={selectedCell}
          onCellSelect={setSelectedCell}
          updateCellMutation={updateCellMutation}
          updateFootnoteRefsMutation={updateFootnoteRefsMutation}
          updateFootnotesMutation={updateFootnotesMutation}
          setStatusMutation={setStatusMutation}
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
              updateFootnoteRefsMutation={updateFootnoteRefsMutation}
              updateFootnotesMutation={updateFootnotesMutation}
              setStatusMutation={setStatusMutation}
            />
          ))}
        </div>
      )}
    </div>
  );
}
