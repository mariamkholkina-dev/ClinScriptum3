"use client";

import { useState, useMemo, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  AlertCircle,
  ChevronDown,
  AlertTriangle,
  ChevronsUpDown,
  Filter,
  CheckSquare,
  Square,
  X,
  Edit3,
  Save,
  FileText,
  HelpCircle,
  Search,
} from "lucide-react";

import type { Fact, FactSource, SortKey, FilterState } from "./types";
import { EMPTY_FILTERS } from "./types";
import { sortFacts, filterFacts } from "./utils";

/* ═══════════════ Helpers ═══════════════ */

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.85 ? "text-green-700 bg-green-50" :
  c >= 0.6 ? "text-blue-700 bg-blue-50" :
  c >= 0.3 ? "text-amber-700 bg-amber-50" :
  "text-red-700 bg-red-50";

const STATUS_CLS: Record<string, string> = {
  extracted: "bg-blue-100 text-blue-800",
  verified: "bg-indigo-100 text-indigo-800",
  validated: "bg-green-100 text-green-800",
  deferred: "bg-yellow-100 text-yellow-800",
  not_found: "bg-gray-100 text-gray-600",
  rejected: "bg-red-100 text-red-800",
};

const STATUS_LABEL: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Проверен",
  validated: "Подтверждён",
  deferred: "Отложен",
  not_found: "Не найден",
  rejected: "Отклонён",
};

const SORT_LABELS: Record<SortKey, string> = {
  factKey: "По ключу",
  factCategory: "По категории",
  confidence: "По уверенности",
  status: "По статусу",
  value: "По значению",
  hasContradiction: "По противоречиям",
};

/* ═══════════════ SourcePanel ═══════════════ */

function SourcePanel({ sources, factValue }: { sources: FactSource[]; factValue: string }) {
  if (sources.length === 0) {
    return (
      <p className="py-2 pl-8 text-xs italic text-gray-400">
        Источники не найдены.
      </p>
    );
  }

  return (
    <div className="border-l-2 border-brand-200 bg-gray-50/60 py-2 pl-8 pr-4 space-y-3">
      {sources.map((src, i) => {
        const highlighted = factValue
          ? highlightText(src.text, factValue)
          : src.text;

        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2 text-[10px]">
              <FileText size={11} className="text-gray-400" />
              <span className="font-medium text-gray-700">{src.sectionTitle}</span>
              {src.standardSection && (
                <span className="rounded bg-brand-100 px-1.5 py-0.5 text-brand-700">
                  {src.standardSection}
                </span>
              )}
              {src.isSynopsis && (
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                  Synopsis
                </span>
              )}
            </div>
            <p
              className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </div>
        );
      })}
    </div>
  );
}

function highlightText(text: string, value: string): string {
  if (!value || value.length < 2) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const mark = (s: string) =>
    `<mark style="background:#fef08a;border-radius:2px;padding:0 2px">${s}</mark>`;

  // 1) Try exact match first
  const exactPattern = escapeRegExp(escapeHtml(value));
  try {
    const reExact = new RegExp(`(${exactPattern})`, "gi");
    if (reExact.test(escaped)) {
      return escaped.replace(reExact, (_, m) => mark(m));
    }
  } catch { /* fall through */ }

  // 2) Split value into meaningful words (≥2 chars) and highlight each
  const words = value
    .split(/[\s,;:./\-–—()[\]{}]+/)
    .filter((w) => w.length >= 2)
    .map((w) => escapeRegExp(escapeHtml(w)));

  if (words.length === 0) return escaped;

  try {
    const reWords = new RegExp(`(${words.join("|")})`, "gi");
    return escaped.replace(reWords, (_, m) => mark(m));
  } catch {
    return escaped;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ═══════════════ InlineValueEditor ═══════════════ */

function InlineValueEditor({
  fact,
  onSave,
  onCancel,
  isPending,
}: {
  fact: Fact;
  onSave: (value: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [value, setValue] = useState(fact.manualValue ?? fact.value);

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
        autoFocus
      />
      <button
        onClick={() => onSave(value)}
        disabled={isPending}
        className="flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
      </button>
      <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
        <X size={14} />
      </button>
    </div>
  );
}

/* ═══════════════ BulkActionsBar ═══════════════ */

function BulkActionsBar({
  selectedCount,
  onBulkValidate,
  onBulkDefer,
  onBulkReject,
  onSelectAll,
  onClearSelection,
  bulkPending,
}: {
  selectedCount: number;
  onBulkValidate: () => void;
  onBulkDefer: () => void;
  onBulkReject: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  bulkPending: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-brand-50 border border-brand-200 px-3 py-2">
      <span className="text-xs font-medium text-brand-700">
        Выбрано: {selectedCount}
      </span>
      <button
        onClick={onBulkValidate}
        disabled={bulkPending}
        className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        Подтвердить
      </button>
      <button
        onClick={onBulkDefer}
        disabled={bulkPending}
        className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Отложить
      </button>
      <button
        onClick={onBulkReject}
        disabled={bulkPending}
        className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        Отклонить
      </button>
      {bulkPending && <Loader2 size={14} className="animate-spin text-brand-500" />}
      <button
        onClick={onSelectAll}
        className="ml-auto rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
      >
        Выделить все
      </button>
      <button
        onClick={onClearSelection}
        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
      >
        Снять выделение
      </button>
    </div>
  );
}

/* ═══════════════ FactRegistryDialog ═══════════════ */

interface RegistryEntry {
  factKey: string;
  category: string;
  description: string;
  valueType: string;
  priority: number;
  labelsRu: string[];
}

function FactRegistryDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const q = trpc.processing.getFactRegistry.useQuery(undefined, {
    staleTime: Infinity,
  });

  const [search, setSearch] = useState("");
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const searchLower = search.toLowerCase();

  const { grouped, categoryLabels } = useMemo(() => {
    if (!q.data) return { grouped: {} as Record<string, RegistryEntry[]>, categoryLabels: {} as Record<string, string> };
    const entries = (q.data.entries ?? []) as RegistryEntry[];
    const labels = (q.data.categoryLabels ?? {}) as Record<string, string>;
    const map: Record<string, RegistryEntry[]> = {};
    for (const e of entries) {
      if (!map[e.category]) map[e.category] = [];
      map[e.category].push(e);
    }
    return { grouped: map, categoryLabels: labels };
  }, [q.data]);

  const filteredGrouped = useMemo(() => {
    if (!search) return grouped;
    const result: Record<string, RegistryEntry[]> = {};
    for (const [cat, entries] of Object.entries(grouped)) {
      const catLabel = categoryLabels[cat] ?? cat;
      const filtered = entries.filter(
        (e) =>
          e.factKey.toLowerCase().includes(searchLower) ||
          e.description.toLowerCase().includes(searchLower) ||
          (e.labelsRu ?? []).some((l) => l.toLowerCase().includes(searchLower)) ||
          catLabel.toLowerCase().includes(searchLower),
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [grouped, categoryLabels, search, searchLower]);

  const totalCount = useMemo(
    () => Object.values(filteredGrouped).reduce((s, a) => s + a.length, 0),
    [filteredGrouped],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Справочник фактов</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ключу, описанию, меткам..."
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {totalCount} {totalCount === 1 ? "факт" : "фактов"} в {Object.keys(filteredGrouped).length} категориях
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {q.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : Object.keys(filteredGrouped).length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Ничего не найдено</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(filteredGrouped).map(([cat, entries]) => {
                const label = categoryLabels[cat] ?? cat;
                const isOpen = expandedCat === cat || !!search;

                return (
                  <div key={cat} className="rounded-md border border-gray-200">
                    <button
                      onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                    >
                      <ChevronDown
                        size={14}
                        className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                      />
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                        {entries.length}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {entries.map((e) => (
                          <div key={e.factKey} className="px-4 py-2.5 pl-9">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700">
                                {e.factKey}
                              </span>
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                {e.valueType}
                              </span>
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                                P{e.priority}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
                              {e.description}
                            </p>
                            {e.labelsRu && e.labelsRu.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {e.labelsRu.map((l, i) => (
                                  <span key={i} className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500">
                                    {l}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ Toolbar ═══════════════ */

function ExtractionToolbar({
  sortKey,
  onSortChange,
  filters,
  onFiltersChange,
  categories,
  selectedCount,
  totalCount,
  visibleCount,
  contradictionCount,
  onBulkValidate,
  onBulkDefer,
  onBulkReject,
  onSelectAll,
  onClearSelection,
  bulkPending,
  onShowRegistry,
}: {
  sortKey: SortKey;
  onSortChange: (k: SortKey) => void;
  filters: FilterState;
  onFiltersChange: (f: FilterState) => void;
  categories: string[];
  selectedCount: number;
  totalCount: number;
  visibleCount: number;
  contradictionCount: number;
  onBulkValidate: () => void;
  onBulkDefer: () => void;
  onBulkReject: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  bulkPending: boolean;
  onShowRegistry: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Row 1: Sort + Summary */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <ChevronsUpDown size={14} className="text-gray-400" />
          <select
            value={sortKey}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <button
          onClick={onShowRegistry}
          className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
          title="Справочник фактов"
        >
          <HelpCircle size={13} />
          Справочник
        </button>

        <span className="ml-auto text-xs text-gray-500">
          {visibleCount === totalCount
            ? `${totalCount} фактов`
            : `${visibleCount} из ${totalCount}`}
          {contradictionCount > 0 && (
            <span className="ml-1 text-red-600">, {contradictionCount} противоречий</span>
          )}
        </span>
      </div>

      {/* Row 2: Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={12} className="text-gray-400" />

        <select
          value={filters.status}
          onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as FilterState["status"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Статус: все</option>
          <option value="extracted">Извлечён</option>
          <option value="verified">Проверен</option>
          <option value="validated">Подтверждён</option>
          <option value="deferred">Отложен</option>
          <option value="not_found">Не найден</option>
          <option value="rejected">Отклонён</option>
        </select>

        <select
          value={filters.category}
          onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Категория: все</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filters.hasContradiction}
          onChange={(e) => onFiltersChange({ ...filters, hasContradiction: e.target.value as FilterState["hasContradiction"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Противоречия: все</option>
          <option value="yes">С противоречиями</option>
          <option value="no">Без противоречий</option>
        </select>

        <select
          value={filters.hasValue}
          onChange={(e) => onFiltersChange({ ...filters, hasValue: e.target.value as FilterState["hasValue"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Значение: все</option>
          <option value="yes">Есть значение</option>
          <option value="no">Нет значения</option>
        </select>

        <select
          value={filters.confidenceRange}
          onChange={(e) => onFiltersChange({ ...filters, confidenceRange: e.target.value as FilterState["confidenceRange"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Уверенность: все</option>
          <option value="high">Высокая (≥85%)</option>
          <option value="medium">Средняя (30-85%)</option>
          <option value="low">Низкая (&lt;30%)</option>
        </select>

        <select
          value={filters.levelAgreement}
          onChange={(e) => onFiltersChange({ ...filters, levelAgreement: e.target.value as FilterState["levelAgreement"] })}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="">Уровни: все</option>
          <option value="agree">Д/L совпадают</option>
          <option value="disagree">Д/L расходятся</option>
          <option value="qa_corrected">QA исправил</option>
        </select>

        {(filters.status || filters.category || filters.hasContradiction || filters.hasValue || filters.confidenceRange || filters.levelAgreement) && (
          <button
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="text-xs text-brand-600 hover:text-brand-700"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Row 3: Bulk actions */}
      {selectedCount > 0 && (
        <BulkActionsBar
          selectedCount={selectedCount}
          onBulkValidate={onBulkValidate}
          onBulkDefer={onBulkDefer}
          onBulkReject={onBulkReject}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          bulkPending={bulkPending}
        />
      )}
    </div>
  );
}

/* ═══════════════ FactRow ═══════════════ */

function FactRow({
  fact,
  isSelected,
  isExpanded,
  isEditing,
  onToggleSelect,
  onToggleExpand,
  onStartEdit,
  onSaveValue,
  onCancelEdit,
  onStatusChange,
  valuePending,
  statusPending,
}: {
  fact: Fact;
  isSelected: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onSaveValue: (value: string) => void;
  onCancelEdit: () => void;
  onStatusChange: (status: Fact["status"]) => void;
  valuePending: boolean;
  statusPending: boolean;
}) {
  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer hover:bg-gray-50
          ${fact.hasContradiction ? "bg-red-50/40" : ""}
          ${isSelected ? "bg-brand-50/40" : ""}`}
        onClick={onToggleExpand}
      >
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className="shrink-0 text-gray-400 hover:text-brand-600"
        >
          {isSelected ? <CheckSquare size={15} className="text-brand-600" /> : <Square size={15} />}
        </button>

        {/* Fact key */}
        <span className="shrink-0 w-40 font-mono text-xs text-gray-900 truncate" title={fact.factKey}>
          {fact.factKey}
        </span>

        {/* Category */}
        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
          {fact.factCategory}
        </span>

        {/* Level results: Д / L / Q */}
        <div className="shrink-0 flex items-center gap-1">
          {fact.deterministicValue != null && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[9px] max-w-[80px]"
              title={`Алгоритм: ${fact.deterministicValue} (${Math.round(fact.deterministicConfidence * 100)}%)`}
            >
              <span className="font-bold text-blue-700">Д</span>
              <span className="truncate text-blue-800">{fact.deterministicValue || "—"}</span>
              <span className="text-blue-500">{Math.round(fact.deterministicConfidence * 100)}</span>
            </span>
          )}
          {fact.llmValue != null && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-purple-50 px-1 py-0.5 text-[9px] max-w-[80px]"
              title={`LLM: ${fact.llmValue} (${Math.round(fact.llmConfidence * 100)}%)`}
            >
              <span className="font-bold text-purple-700">L</span>
              <span className="truncate text-purple-800">{fact.llmValue || "—"}</span>
              <span className="text-purple-500">{Math.round(fact.llmConfidence * 100)}</span>
            </span>
          )}
          {fact.qaValue != null && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[9px] max-w-[80px]"
              title={`QA: ${fact.qaValue} (${Math.round(fact.qaConfidence * 100)}%)`}
            >
              <span className="font-bold text-amber-700">Q</span>
              <span className="truncate text-amber-800">{fact.qaValue || "—"}</span>
              <span className="text-amber-500">{Math.round(fact.qaConfidence * 100)}</span>
            </span>
          )}
        </div>

        {/* Value */}
        <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          {isEditing ? (
            <InlineValueEditor
              fact={fact}
              onSave={onSaveValue}
              onCancel={onCancelEdit}
              isPending={valuePending}
            />
          ) : (
            <span className="block truncate text-xs text-gray-700" title={fact.manualValue ?? fact.value}>
              {(fact.manualValue ?? fact.value) || "—"}
              {fact.manualValue && fact.manualValue !== fact.value && (
                <span className="ml-1 text-[10px] text-amber-600">(ред.)</span>
              )}
            </span>
          )}
        </div>

        {/* Confidence */}
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(fact.confidence)}`}>
          {Math.round(fact.confidence * 100)}%
        </span>

        {/* Status dropdown */}
        <select
          value={fact.status}
          onChange={(e) => { e.stopPropagation(); onStatusChange(e.target.value as Fact["status"]); }}
          onClick={(e) => e.stopPropagation()}
          disabled={statusPending}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border-0 cursor-pointer ${STATUS_CLS[fact.status] ?? ""}`}
        >
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Contradiction */}
        {fact.hasContradiction && (
          <span className="shrink-0 text-red-500" title="Противоречие">
            <AlertTriangle size={13} />
          </span>
        )}

        {/* Sources count */}
        <span className="shrink-0 text-[10px] text-gray-400 w-6 text-right" title="Источников">
          {(fact.sources ?? []).length}
        </span>

        {/* Edit button */}
        {!isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            className="shrink-0 text-gray-400 hover:text-brand-600"
            title="Изменить значение"
          >
            <Edit3 size={13} />
          </button>
        )}

        {/* Expand indicator */}
        <ChevronDown
          size={13}
          className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </div>

      {/* Expanded: level results + sources + description */}
      {isExpanded && (
        <div className="bg-gray-50/30 border-t border-gray-100">
          {fact.description && (
            <p className="px-8 pt-2 text-xs text-gray-500 italic">{fact.description}</p>
          )}

          {/* Per-level extraction results */}
          {(fact.deterministicValue || fact.llmValue || fact.qaValue) && (
            <div className="px-8 pt-2 pb-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 mb-1">Результаты по уровням</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {fact.deterministicValue != null && (
                  <div className="flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1">
                    <span className="font-medium text-blue-700">Алго:</span>
                    <span className="text-blue-900 max-w-[200px] truncate" title={fact.deterministicValue}>{fact.deterministicValue || "—"}</span>
                    <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.deterministicConfidence)}`}>
                      {Math.round(fact.deterministicConfidence * 100)}%
                    </span>
                  </div>
                )}
                {fact.llmValue != null && (
                  <div className="flex items-center gap-1.5 rounded bg-purple-50 px-2 py-1">
                    <span className="font-medium text-purple-700">LLM:</span>
                    <span className="text-purple-900 max-w-[200px] truncate" title={fact.llmValue}>{fact.llmValue || "—"}</span>
                    <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.llmConfidence)}`}>
                      {Math.round(fact.llmConfidence * 100)}%
                    </span>
                  </div>
                )}
                {fact.qaValue != null && (
                  <div className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1">
                    <span className="font-medium text-amber-700">QA:</span>
                    <span className="text-amber-900 max-w-[200px] truncate" title={fact.qaValue}>{fact.qaValue || "—"}</span>
                    <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.qaConfidence)}`}>
                      {Math.round(fact.qaConfidence * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <SourcePanel
            sources={(fact.sources ?? []) as FactSource[]}
            factValue={fact.manualValue ?? fact.value}
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Main Component ═══════════════ */

export default function ExtractionViewer({
  versionId,
}: {
  versionId: string;
  expectedResults?: unknown;
}) {
  const q = trpc.processing.listFacts.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const [sortKey, setSortKey] = useState<SortKey>("factKey");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showRegistry, setShowRegistry] = useState(false);

  const utils = trpc.useUtils();

  const rawFacts = useMemo(() => {
    return ((q.data ?? []) as Record<string, unknown>[]).map((f) => ({
      id: f.id as string,
      factKey: f.factKey as string,
      factCategory: f.factCategory as string,
      description: (f.description as string) ?? "",
      value: f.value as string,
      manualValue: (f.manualValue as string) ?? null,
      confidence: f.confidence as number,
      factClass: f.factClass as string,
      sources: (f.sources ?? []) as FactSource[],
      hasContradiction: f.hasContradiction as boolean,
      status: f.status as Fact["status"],
      deterministicValue: (f.deterministicValue as string) ?? null,
      deterministicConfidence: (f.deterministicConfidence as number) ?? 0,
      llmValue: (f.llmValue as string) ?? null,
      llmConfidence: (f.llmConfidence as number) ?? 0,
      qaValue: (f.qaValue as string) ?? null,
      qaConfidence: (f.qaConfidence as number) ?? 0,
    }));
  }, [q.data]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const f of rawFacts) cats.add(f.factCategory);
    return Array.from(cats).sort();
  }, [rawFacts]);

  const sorted = useMemo(() => sortFacts(rawFacts, sortKey), [rawFacts, sortKey]);
  const filtered = useMemo(() => filterFacts(sorted, filters), [sorted, filters]);

  const stats = useMemo(() => ({
    total: rawFacts.length,
    validated: rawFacts.filter((f) => f.status === "validated").length,
    contradictions: rawFacts.filter((f) => f.hasContradiction).length,
    notFound: rawFacts.filter((f) => f.status === "not_found").length,
    withDeterministic: rawFacts.filter((f) => f.deterministicValue != null).length,
    withLlm: rawFacts.filter((f) => f.llmValue != null).length,
    withQa: rawFacts.filter((f) => f.qaValue != null).length,
    disagreements: rawFacts.filter((f) => f.deterministicValue != null && f.llmValue != null && f.deterministicValue !== f.llmValue).length,
  }), [rawFacts]);

  // Mutations
  const bulkMutation = trpc.processing.bulkUpdateFactStatus.useMutation({
    onSuccess: () => {
      utils.processing.listFacts.invalidate({ docVersionId: versionId });
      setSelectedIds(new Set());
    },
  });

  const updateStatusMutation = trpc.processing.updateFactStatus.useMutation({
    onSuccess: () => utils.processing.listFacts.invalidate({ docVersionId: versionId }),
  });

  const updateValueMutation = trpc.processing.updateFactValue.useMutation({
    onSuccess: () => {
      utils.processing.listFacts.invalidate({ docVersionId: versionId });
      setEditingId(null);
    },
  });

  const handleBulkUpdate = useCallback(
    (status: Fact["status"]) => {
      bulkMutation.mutate({ factIds: Array.from(selectedIds), status });
    },
    [selectedIds, bulkMutation],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /* ── Loading ── */
  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Загрузка фактов...</span>
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-sm text-red-700">
        <AlertCircle size={16} /> {q.error.message}
      </div>
    );
  }

  if (rawFacts.length === 0) {
    return (
      <p className="py-8 text-center text-sm italic text-gray-400">
        Факты не извлечены. Этап извлечения ещё не выполнен.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-gray-100 px-2 py-1 font-medium">Всего: {stats.total}</span>
        <span className="rounded bg-green-50 px-2 py-1 text-green-700">Подтверждено: {stats.validated}</span>
        <span className="rounded bg-red-50 px-2 py-1 text-red-700">Противоречий: {stats.contradictions}</span>
        <span className="rounded bg-gray-50 px-2 py-1 text-gray-500">Не найдено: {stats.notFound}</span>
        <span className="border-l border-gray-200 pl-3 rounded bg-blue-50 px-2 py-1 text-blue-700">Д: {stats.withDeterministic}</span>
        <span className="rounded bg-purple-50 px-2 py-1 text-purple-700">L: {stats.withLlm}</span>
        <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">Q: {stats.withQa}</span>
        {stats.disagreements > 0 && (
          <span className="rounded bg-orange-50 px-2 py-1 text-orange-700">Расхождений Д/L: {stats.disagreements}</span>
        )}
      </div>

      <ExtractionToolbar
        sortKey={sortKey}
        onSortChange={setSortKey}
        filters={filters}
        onFiltersChange={setFilters}
        categories={categories}
        selectedCount={selectedIds.size}
        totalCount={rawFacts.length}
        visibleCount={filtered.length}
        contradictionCount={stats.contradictions}
        onBulkValidate={() => handleBulkUpdate("validated")}
        onBulkDefer={() => handleBulkUpdate("deferred")}
        onBulkReject={() => handleBulkUpdate("rejected")}
        onSelectAll={() => setSelectedIds(new Set(filtered.map((f) => f.id)))}
        onClearSelection={() => setSelectedIds(new Set())}
        bulkPending={bulkMutation.isPending}
        onShowRegistry={() => setShowRegistry(true)}
      />

      {showRegistry && <FactRegistryDialog onClose={() => setShowRegistry(false)} />}

      {/* Table header */}
      <div className="max-h-[600px] overflow-y-auto rounded-md border border-gray-200 bg-white">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-gray-50 px-3 py-2 border-b border-gray-200 text-[10px] font-medium uppercase tracking-wider text-gray-500">
          <span className="w-[15px] shrink-0" />
          <span className="w-40 shrink-0">Ключ факта</span>
          <span className="shrink-0 w-20">Категория</span>
          <span className="shrink-0">Д / L / Q</span>
          <span className="flex-1">Значение</span>
          <span className="shrink-0 w-12 text-center">Уверен.</span>
          <span className="shrink-0 w-20 text-center">Статус</span>
          <span className="shrink-0 w-4" />
          <span className="shrink-0 w-6 text-right">Ист.</span>
          <span className="shrink-0 w-[13px]" />
          <span className="shrink-0 w-[13px]" />
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm italic text-gray-400">
            Нет фактов, соответствующих фильтрам.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((f) => (
              <FactRow
                key={f.id}
                fact={f}
                isSelected={selectedIds.has(f.id)}
                isExpanded={expandedIds.has(f.id)}
                isEditing={editingId === f.id}
                onToggleSelect={() => toggleSelect(f.id)}
                onToggleExpand={() => toggleExpand(f.id)}
                onStartEdit={() => setEditingId(f.id)}
                onSaveValue={(value) => updateValueMutation.mutate({ factId: f.id, manualValue: value })}
                onCancelEdit={() => setEditingId(null)}
                onStatusChange={(status) => updateStatusMutation.mutate({ factId: f.id, status })}
                valuePending={updateValueMutation.isPending}
                statusPending={updateStatusMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
