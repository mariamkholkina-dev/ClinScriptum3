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
  Save,
  FileText,
  HelpCircle,
  Search,
  Check,
} from "lucide-react";

import type { GroupedFact, FactVariant, FactSource, SortKey, FilterState, FactStatus } from "./types";
import { EMPTY_FILTERS } from "./types";
import { sortGroupedFacts, filterGroupedFacts } from "./utils";

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

const LEVEL_LABEL: Record<string, string> = {
  deterministic: "Алго",
  llm_check: "LLM",
  llm_qa: "QA",
};

const LEVEL_CLS: Record<string, string> = {
  deterministic: "bg-blue-50 text-blue-700",
  llm_check: "bg-purple-50 text-purple-700",
  llm_qa: "bg-amber-50 text-amber-700",
};

/* ═══════════════ SourceHighlight ═══════════════ */

function SourceHighlight({ text, factValue }: { text: string; factValue: string }) {
  if (!text) return null;
  const highlighted = factValue ? highlightText(text, factValue) : escapeHtml(text);
  return (
    <p
      className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

function highlightText(text: string, value: string): string {
  if (!value || value.length < 2) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const mark = (s: string) =>
    `<mark style="background:#fef08a;border-radius:2px;padding:0 2px">${s}</mark>`;

  const exactPattern = escapeRegExp(escapeHtml(value));
  try {
    const reExact = new RegExp(`(${exactPattern})`, "gi");
    if (reExact.test(escaped)) return escaped.replace(reExact, (_, m) => mark(m));
  } catch { /* fall through */ }

  const words = value.split(/[\s,;:./\-–—()[\]{}]+/).filter((w) => w.length >= 2).map((w) => escapeRegExp(escapeHtml(w)));
  if (words.length === 0) return escaped;
  try {
    return escaped.replace(new RegExp(`(${words.join("|")})`, "gi"), (_, m) => mark(m));
  } catch { return escaped; }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ═══════════════ VariantPanel ═══════════════ */

function VariantPanel({
  fact,
  onSelectValue,
  onSaveManual,
  isPending,
}: {
  fact: GroupedFact;
  onSelectValue: (value: string) => void;
  onSaveManual: (value: string) => void;
  isPending: boolean;
}) {
  const [manualInput, setManualInput] = useState("");
  const currentFinal = fact.manualValue ?? fact.finalValue;

  const uniqueVariants = useMemo(() => {
    const map = new Map<string, { values: FactVariant[]; levels: Set<string> }>();
    for (const v of fact.variants) {
      const existing = map.get(v.value);
      if (existing) {
        existing.values.push(v);
        existing.levels.add(v.level);
      } else {
        map.set(v.value, { values: [v], levels: new Set([v.level]) });
      }
    }
    return Array.from(map.entries()).map(([value, { values, levels }]) => ({
      value,
      levels: Array.from(levels),
      bestConfidence: Math.max(...values.map((v) => v.confidence)),
      sources: values,
    }));
  }, [fact.variants]);

  return (
    <div className="space-y-3 px-8 py-3">
      {fact.description && (
        <p className="text-xs text-gray-500 italic">{fact.description}</p>
      )}

      {/* Level summary */}
      <div className="flex flex-wrap gap-3 text-xs">
        {fact.deterministicValue != null && (
          <div className="flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1">
            <span className="font-medium text-blue-700">Алго:</span>
            <span className="text-blue-900 max-w-[250px] truncate" title={fact.deterministicValue}>{fact.deterministicValue}</span>
            <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.deterministicConfidence)}`}>
              {Math.round(fact.deterministicConfidence * 100)}%
            </span>
          </div>
        )}
        {fact.llmValue != null && (
          <div className="flex items-center gap-1.5 rounded bg-purple-50 px-2 py-1">
            <span className="font-medium text-purple-700">LLM:</span>
            <span className="text-purple-900 max-w-[250px] truncate" title={fact.llmValue}>{fact.llmValue}</span>
            <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.llmConfidence)}`}>
              {Math.round(fact.llmConfidence * 100)}%
            </span>
          </div>
        )}
        {fact.qaValue != null && (
          <div className="flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1">
            <span className="font-medium text-amber-700">QA:</span>
            <span className="text-amber-900 max-w-[250px] truncate" title={fact.qaValue}>{fact.qaValue}</span>
            <span className={`rounded px-1 py-0.5 text-[10px] ${CONFIDENCE_COLOR(fact.qaConfidence)}`}>
              {Math.round(fact.qaConfidence * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Variant list with radio selection */}
      {uniqueVariants.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
            Варианты значений ({uniqueVariants.length})
          </p>
          {uniqueVariants.map((uv, idx) => {
            const isSelected = currentFinal === uv.value;
            return (
              <div key={idx} className={`rounded-md border ${isSelected ? "border-brand-300 bg-brand-50/30" : "border-gray-200"} p-2.5`}>
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => onSelectValue(uv.value)}
                    disabled={isPending}
                    className={`mt-0.5 shrink-0 rounded-full border-2 w-4 h-4 flex items-center justify-center
                      ${isSelected ? "border-brand-600 bg-brand-600" : "border-gray-300 hover:border-brand-400"}`}
                  >
                    {isSelected && <Check size={10} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">&quot;{uv.value}&quot;</span>
                      {uv.levels.map((l) => (
                        <span key={l} className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${LEVEL_CLS[l] ?? "bg-gray-100"}`}>
                          {LEVEL_LABEL[l] ?? l}
                        </span>
                      ))}
                      <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(uv.bestConfidence)}`}>
                        {Math.round(uv.bestConfidence * 100)}%
                      </span>
                    </div>
                    {/* Sources for this variant */}
                    {uv.sources.filter((s) => s.sourceText).map((src, si) => (
                      <div key={si} className="mt-1.5 border-l-2 border-gray-200 pl-3">
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                          <FileText size={10} />
                          <span>{src.sectionTitle || "—"}</span>
                          <span className={`rounded px-1 py-0.5 ${LEVEL_CLS[src.level] ?? ""}`}>
                            {LEVEL_LABEL[src.level] ?? src.level}
                          </span>
                        </div>
                        <SourceHighlight text={src.sourceText} factValue={uv.value} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legacy sources (from pre-variant data) */}
      {uniqueVariants.length === 0 && fact.sources.length > 0 && (
        <div className="border-l-2 border-brand-200 bg-gray-50/60 py-2 pl-4 pr-4 space-y-2">
          {fact.sources.map((src, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2 text-[10px]">
                <FileText size={11} className="text-gray-400" />
                <span className="font-medium text-gray-700">{src.sectionTitle}</span>
                {src.isSynopsis && (
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">Synopsis</span>
                )}
              </div>
              <SourceHighlight text={src.text} factValue={fact.finalValue ?? ""} />
            </div>
          ))}
        </div>
      )}

      {/* Manual input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          placeholder="Ввести значение вручную..."
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          onClick={(e) => { e.stopPropagation(); if (manualInput.trim()) onSaveManual(manualInput.trim()); }}
          disabled={isPending || !manualInput.trim()}
          className="flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Сохранить
        </button>
      </div>
      {fact.manualValue && (
        <p className="text-[10px] text-amber-600">
          Ручное значение: &quot;{fact.manualValue}&quot;
        </p>
      )}
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
      <span className="text-xs font-medium text-brand-700">Выбрано: {selectedCount}</span>
      <button onClick={onBulkValidate} disabled={bulkPending} className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">Подтвердить</button>
      <button onClick={onBulkDefer} disabled={bulkPending} className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">Отложить</button>
      <button onClick={onBulkReject} disabled={bulkPending} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Отклонить</button>
      {bulkPending && <Loader2 size={14} className="animate-spin text-brand-500" />}
      <button onClick={onSelectAll} className="ml-auto rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">Выделить все</button>
      <button onClick={onClearSelection} className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100">Снять выделение</button>
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

function FactRegistryDialog({ onClose }: { onClose: () => void }) {
  const q = trpc.processing.getFactRegistry.useQuery(undefined, { staleTime: Infinity });
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
        (e) => e.factKey.toLowerCase().includes(searchLower) || e.description.toLowerCase().includes(searchLower) ||
          (e.labelsRu ?? []).some((l) => l.toLowerCase().includes(searchLower)) || catLabel.toLowerCase().includes(searchLower),
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [grouped, categoryLabels, search, searchLower]);

  const totalCount = useMemo(() => Object.values(filteredGrouped).reduce((s, a) => s + a.length, 0), [filteredGrouped]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-3xl max-h-[80vh] flex flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Справочник фактов</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="px-6 pt-4 pb-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по ключу, описанию, меткам..."
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">{totalCount} фактов в {Object.keys(filteredGrouped).length} категориях</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
          {q.isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin text-gray-400" /></div>
          ) : Object.keys(filteredGrouped).length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">Ничего не найдено</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(filteredGrouped).map(([cat, entries]) => {
                const label = categoryLabels[cat] ?? cat;
                const isOpen = expandedCat === cat || !!search;
                return (
                  <div key={cat} className="rounded-md border border-gray-200">
                    <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50">
                      <ChevronDown size={14} className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`} />
                      <span className="text-sm font-medium text-gray-900">{label}</span>
                      <span className="ml-auto rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{entries.length}</span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-gray-100 divide-y divide-gray-50">
                        {entries.map((e) => (
                          <div key={e.factKey} className="px-4 py-2.5 pl-9">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700">{e.factKey}</span>
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{e.valueType}</span>
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">P{e.priority}</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-600 leading-relaxed">{e.description}</p>
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
  sortKey, onSortChange, filters, onFiltersChange, categories,
  selectedCount, totalCount, visibleCount, contradictionCount,
  onBulkValidate, onBulkDefer, onBulkReject, onSelectAll, onClearSelection,
  bulkPending, onShowRegistry, registryCount,
}: {
  sortKey: SortKey; onSortChange: (k: SortKey) => void;
  filters: FilterState; onFiltersChange: (f: FilterState) => void;
  categories: string[]; selectedCount: number; totalCount: number;
  visibleCount: number; contradictionCount: number;
  onBulkValidate: () => void; onBulkDefer: () => void; onBulkReject: () => void;
  onSelectAll: () => void; onClearSelection: () => void;
  bulkPending: boolean; onShowRegistry: () => void; registryCount: number;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <ChevronsUpDown size={14} className="text-gray-400" />
          <select value={sortKey} onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <button onClick={onShowRegistry} className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100" title="Справочник фактов">
          <HelpCircle size={13} /> Справочник
        </button>
        <span className="ml-auto text-xs text-gray-500">
          {visibleCount === totalCount ? `${totalCount} фактов` : `${visibleCount} из ${totalCount}`}
          {registryCount > 0 && <span className="ml-1 text-gray-400">(+{registryCount} из реестра)</span>}
          {contradictionCount > 0 && <span className="ml-1 text-red-600">, {contradictionCount} противоречий</span>}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter size={12} className="text-gray-400" />
        <select value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as FilterState["status"] })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Статус: все</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Категория: все</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.hasContradiction} onChange={(e) => onFiltersChange({ ...filters, hasContradiction: e.target.value as FilterState["hasContradiction"] })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Противоречия: все</option>
          <option value="yes">С противоречиями</option>
          <option value="no">Без противоречий</option>
        </select>
        <select value={filters.hasValue} onChange={(e) => onFiltersChange({ ...filters, hasValue: e.target.value as FilterState["hasValue"] })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Значение: все</option>
          <option value="yes">Есть значение</option>
          <option value="no">Нет значения</option>
        </select>
        <select value={filters.confidenceRange} onChange={(e) => onFiltersChange({ ...filters, confidenceRange: e.target.value as FilterState["confidenceRange"] })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Уверенность: все</option>
          <option value="high">Высокая (≥85%)</option>
          <option value="medium">Средняя (30-85%)</option>
          <option value="low">Низкая (&lt;30%)</option>
        </select>
        <select value={filters.levelAgreement} onChange={(e) => onFiltersChange({ ...filters, levelAgreement: e.target.value as FilterState["levelAgreement"] })} className="rounded border border-gray-300 px-2 py-1 text-xs">
          <option value="">Уровни: все</option>
          <option value="all_agree">Д=LLM=QA</option>
          <option value="llm_qa_agree">LLM=QA</option>
          <option value="det_ne_llm">Д≠LLM</option>
          <option value="qa_corrected">QA исправил</option>
        </select>
        {(filters.status || filters.category || filters.hasContradiction || filters.hasValue || filters.confidenceRange || filters.levelAgreement) && (
          <button onClick={() => onFiltersChange(EMPTY_FILTERS)} className="text-xs text-brand-600 hover:text-brand-700">Сбросить</button>
        )}
      </div>

      {selectedCount > 0 && (
        <BulkActionsBar selectedCount={selectedCount} onBulkValidate={onBulkValidate} onBulkDefer={onBulkDefer} onBulkReject={onBulkReject}
          onSelectAll={onSelectAll} onClearSelection={onClearSelection} bulkPending={bulkPending} />
      )}
    </div>
  );
}

/* ═══════════════ GroupedFactRow ═══════════════ */

function GroupedFactRow({
  fact, isSelected, isExpanded, onToggleSelect, onToggleExpand,
  onSelectValue, onSaveManual, onStatusChange, valuePending, statusPending,
}: {
  fact: GroupedFact; isSelected: boolean; isExpanded: boolean;
  onToggleSelect: () => void; onToggleExpand: () => void;
  onSelectValue: (value: string) => void; onSaveManual: (value: string) => void;
  onStatusChange: (status: FactStatus) => void;
  valuePending: boolean; statusPending: boolean;
}) {
  const disagreement = fact.deterministicValue != null && fact.llmValue != null && fact.deterministicValue !== fact.llmValue;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer hover:bg-gray-50
          ${fact.hasContradiction ? "bg-red-50/40" : ""}
          ${fact.isFromRegistry && fact.status === "not_found" ? "bg-gray-50/60" : ""}
          ${isSelected ? "bg-brand-50/40" : ""}`}
        onClick={onToggleExpand}
      >
        <button onClick={(e) => { e.stopPropagation(); onToggleSelect(); }} className="shrink-0 text-gray-400 hover:text-brand-600">
          {isSelected ? <CheckSquare size={15} className="text-brand-600" /> : <Square size={15} />}
        </button>

        <span className="shrink-0 w-44 font-mono text-xs text-gray-900 truncate" title={fact.factKey}>{fact.factKey}</span>

        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">{fact.factCategory}</span>

        {/* Level badges */}
        <div className="shrink-0 flex items-center gap-1">
          {fact.deterministicValue != null && (
            <span className={`inline-flex items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 text-[9px] max-w-[90px] ${disagreement ? "ring-1 ring-amber-400" : ""}`}
              title={`Алго: ${fact.deterministicValue} (${Math.round(fact.deterministicConfidence * 100)}%)`}>
              <span className="font-bold text-blue-700">Д</span>
              <span className="truncate text-blue-800">{fact.deterministicValue}</span>
            </span>
          )}
          {fact.llmValue != null && (
            <span className={`inline-flex items-center gap-0.5 rounded bg-purple-50 px-1 py-0.5 text-[9px] max-w-[90px] ${disagreement ? "ring-1 ring-amber-400" : ""}`}
              title={`LLM: ${fact.llmValue} (${Math.round(fact.llmConfidence * 100)}%)`}>
              <span className="font-bold text-purple-700">L</span>
              <span className="truncate text-purple-800">{fact.llmValue}</span>
            </span>
          )}
          {fact.qaValue != null && (
            <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 py-0.5 text-[9px] max-w-[90px]"
              title={`QA: ${fact.qaValue} (${Math.round(fact.qaConfidence * 100)}%)`}>
              <span className="font-bold text-amber-700">Q</span>
              <span className="truncate text-amber-800">{fact.qaValue}</span>
            </span>
          )}
        </div>

        {/* Final value */}
        <div className="flex-1 min-w-0">
          <span className={`block truncate text-xs ${fact.finalValue ? "text-gray-700" : "text-gray-400 italic"}`} title={fact.manualValue ?? fact.finalValue ?? ""}>
            {fact.manualValue ?? fact.finalValue ?? "Не найден"}
            {fact.manualValue && fact.manualValue !== fact.finalValue && (
              <span className="ml-1 text-[10px] text-amber-600">(ред.)</span>
            )}
          </span>
        </div>

        {/* Confidence */}
        {fact.finalConfidence > 0 && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${CONFIDENCE_COLOR(fact.finalConfidence)}`}>
            {Math.round(fact.finalConfidence * 100)}%
          </span>
        )}

        {/* Status */}
        <select value={fact.status} onChange={(e) => { e.stopPropagation(); onStatusChange(e.target.value as FactStatus); }}
          onClick={(e) => e.stopPropagation()} disabled={statusPending || fact.factIds.length === 0}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border-0 cursor-pointer ${STATUS_CLS[fact.status] ?? ""}`}>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {fact.hasContradiction && <span className="shrink-0 text-red-500" title="Противоречие"><AlertTriangle size={13} /></span>}

        <span className="shrink-0 text-[10px] text-gray-400 w-6 text-right" title="Вариантов">{fact.variants.length}</span>

        <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </div>

      {isExpanded && (
        <div className="bg-gray-50/30 border-t border-gray-100">
          <VariantPanel fact={fact} onSelectValue={onSelectValue} onSaveManual={onSaveManual} isPending={valuePending} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════ Main Component ═══════════════ */

export default function ExtractionViewer({ versionId }: { versionId: string; expectedResults?: unknown }) {
  const q = trpc.processing.listFactsGrouped.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const summaryQ = trpc.processing.getFactExtractionSummary.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const [sortKey, setSortKey] = useState<SortKey>("factCategory");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showRegistry, setShowRegistry] = useState(false);

  const utils = trpc.useUtils();

  const rawFacts = useMemo(() => {
    return ((q.data ?? []) as Record<string, unknown>[]).map((f) => ({
      factKey: f.factKey as string,
      factCategory: f.factCategory as string,
      description: (f.description as string) ?? "",
      valueType: (f.valueType as string) ?? "string",
      deterministicValue: (f.deterministicValue as string) ?? null,
      deterministicConfidence: (f.deterministicConfidence as number) ?? 0,
      llmValue: (f.llmValue as string) ?? null,
      llmConfidence: (f.llmConfidence as number) ?? 0,
      qaValue: (f.qaValue as string) ?? null,
      qaConfidence: (f.qaConfidence as number) ?? 0,
      finalValue: (f.finalValue as string) ?? null,
      finalConfidence: (f.finalConfidence as number) ?? 0,
      manualValue: (f.manualValue as string) ?? null,
      status: (f.status as FactStatus) ?? "not_found",
      hasContradiction: (f.hasContradiction as boolean) ?? false,
      isFromRegistry: (f.isFromRegistry as boolean) ?? false,
      factIds: (f.factIds as string[]) ?? [],
      factClass: (f.factClass as string) ?? "general",
      variants: ((f.variants ?? []) as FactVariant[]),
      sources: ((f.sources ?? []) as FactSource[]),
    }));
  }, [q.data]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const f of rawFacts) cats.add(f.factCategory);
    return Array.from(cats).sort();
  }, [rawFacts]);

  const sorted = useMemo(() => sortGroupedFacts(rawFacts, sortKey), [rawFacts, sortKey]);
  const filtered = useMemo(() => filterGroupedFacts(sorted, filters), [sorted, filters]);

  const stats = useMemo(() => ({
    total: rawFacts.length,
    extracted: rawFacts.filter((f) => f.finalValue).length,
    notFound: rawFacts.filter((f) => f.status === "not_found").length,
    fromRegistry: rawFacts.filter((f) => f.isFromRegistry && f.status === "not_found").length,
    contradictions: rawFacts.filter((f) => f.hasContradiction).length,
    validated: rawFacts.filter((f) => f.status === "validated").length,
    disagreements: rawFacts.filter((f) => f.deterministicValue != null && f.llmValue != null && f.deterministicValue !== f.llmValue).length,
  }), [rawFacts]);

  const bulkMutation = trpc.processing.bulkUpdateFactStatus.useMutation({
    onSuccess: () => { utils.processing.listFactsGrouped.invalidate({ docVersionId: versionId }); setSelectedKeys(new Set()); },
  });

  const updateStatusMutation = trpc.processing.updateFactStatus.useMutation({
    onSuccess: () => utils.processing.listFactsGrouped.invalidate({ docVersionId: versionId }),
  });

  const updateValueMutation = trpc.processing.updateFactValue.useMutation({
    onSuccess: () => utils.processing.listFactsGrouped.invalidate({ docVersionId: versionId }),
  });

  const handleBulkUpdate = useCallback((status: FactStatus) => {
    const allIds: string[] = [];
    for (const key of selectedKeys) {
      const fact = rawFacts.find((f) => f.factKey === key);
      if (fact) allIds.push(...fact.factIds);
    }
    if (allIds.length > 0) bulkMutation.mutate({ factIds: allIds, status });
  }, [selectedKeys, rawFacts, bulkMutation]);

  const handleSelectValue = useCallback((factKey: string, value: string) => {
    const fact = rawFacts.find((f) => f.factKey === factKey);
    if (!fact || fact.factIds.length === 0) return;
    updateValueMutation.mutate({ factId: fact.factIds[0], manualValue: value });
  }, [rawFacts, updateValueMutation]);

  const handleStatusChange = useCallback((factKey: string, status: FactStatus) => {
    const fact = rawFacts.find((f) => f.factKey === factKey);
    if (!fact) return;
    for (const id of fact.factIds) updateStatusMutation.mutate({ factId: id, status });
  }, [rawFacts, updateStatusMutation]);

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

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
    return <p className="py-8 text-center text-sm italic text-gray-400">Факты не извлечены. Этап извлечения ещё не выполнен.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-gray-100 px-2 py-1 font-medium">Всего: {stats.total}</span>
        <span className="rounded bg-green-50 px-2 py-1 text-green-700">Извлечено: {stats.extracted}</span>
        <span className="rounded bg-green-50 px-2 py-1 text-green-700">Подтверждено: {stats.validated}</span>
        <span className="rounded bg-red-50 px-2 py-1 text-red-700">Противоречий: {stats.contradictions}</span>
        <span className="rounded bg-gray-50 px-2 py-1 text-gray-500">Не найдено: {stats.notFound}</span>
        {stats.disagreements > 0 && (
          <span className="rounded bg-orange-50 px-2 py-1 text-orange-700">Расхождений Д/L: {stats.disagreements}</span>
        )}
      </div>

      {summaryQ.data?.run && (
        <div className="rounded border border-gray-200 bg-gray-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">Метрики последнего запуска</span>
            <span className="text-[10px] text-gray-400">
              run {summaryQ.data.run.id.slice(0, 8)} ·{" "}
              {new Date(summaryQ.data.run.createdAt).toLocaleString("ru-RU")} ·{" "}
              attempt {summaryQ.data.run.attemptNumber} · {summaryQ.data.run.stepCount} шагов
            </span>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-green-50 px-2 py-1 text-green-700">
              Высокая ≥80%: <span className="font-semibold">{summaryQ.data.facts.highConfidence}</span>
            </span>
            <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">
              Средняя 50-80%: <span className="font-semibold">{summaryQ.data.facts.midConfidence}</span>
            </span>
            <span className="rounded bg-red-50 px-2 py-1 text-red-700">
              Низкая &lt;50%: <span className="font-semibold">{summaryQ.data.facts.lowConfidence}</span>
            </span>
            {summaryQ.data.failures.parseErrors > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-amber-800">
                <AlertCircle size={12} />
                LLM JSON parse errors: <span className="font-semibold">{summaryQ.data.failures.parseErrors}</span>
              </span>
            )}
            {summaryQ.data.failures.skippedSections > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-amber-800">
                <AlertCircle size={12} />
                Секций пропущено по лимиту: <span className="font-semibold">{summaryQ.data.failures.skippedSections}</span>
              </span>
            )}
            {summaryQ.data.failures.stepFailures > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-red-800">
                <AlertCircle size={12} />
                Шагов pipeline упало: <span className="font-semibold">{summaryQ.data.failures.stepFailures}</span>
              </span>
            )}
            {summaryQ.data.failures.llmRetries > 0 && (
              <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">
                LLM ретраев: {summaryQ.data.failures.llmRetries}
              </span>
            )}
            {summaryQ.data.failures.totalTokens > 0 && (
              <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">
                Токенов: {summaryQ.data.failures.totalTokens.toLocaleString("ru-RU")}
              </span>
            )}
          </div>
        </div>
      )}

      <ExtractionToolbar
        sortKey={sortKey} onSortChange={setSortKey}
        filters={filters} onFiltersChange={setFilters}
        categories={categories} selectedCount={selectedKeys.size}
        totalCount={rawFacts.length} visibleCount={filtered.length}
        contradictionCount={stats.contradictions}
        onBulkValidate={() => handleBulkUpdate("validated")}
        onBulkDefer={() => handleBulkUpdate("deferred")}
        onBulkReject={() => handleBulkUpdate("rejected")}
        onSelectAll={() => setSelectedKeys(new Set(filtered.map((f) => f.factKey)))}
        onClearSelection={() => setSelectedKeys(new Set())}
        bulkPending={bulkMutation.isPending}
        onShowRegistry={() => setShowRegistry(true)}
        registryCount={stats.fromRegistry}
      />

      {showRegistry && <FactRegistryDialog onClose={() => setShowRegistry(false)} />}

      <div className="max-h-[600px] overflow-y-auto rounded-md border border-gray-200 bg-white">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-gray-50 px-3 py-2 border-b border-gray-200 text-[10px] font-medium uppercase tracking-wider text-gray-500">
          <span className="w-[15px] shrink-0" />
          <span className="w-44 shrink-0">Ключ факта</span>
          <span className="shrink-0 w-20">Категория</span>
          <span className="shrink-0 w-[200px]">Д / L / Q</span>
          <span className="flex-1">Финальное значение</span>
          <span className="shrink-0 w-12 text-center">Уверен.</span>
          <span className="shrink-0 w-20 text-center">Статус</span>
          <span className="shrink-0 w-4" />
          <span className="shrink-0 w-6 text-right">Вар.</span>
          <span className="shrink-0 w-[13px]" />
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm italic text-gray-400">Нет фактов, соответствующих фильтрам.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((f) => (
              <GroupedFactRow
                key={f.factKey}
                fact={f}
                isSelected={selectedKeys.has(f.factKey)}
                isExpanded={expandedKeys.has(f.factKey)}
                onToggleSelect={() => toggleSelect(f.factKey)}
                onToggleExpand={() => toggleExpand(f.factKey)}
                onSelectValue={(value) => handleSelectValue(f.factKey, value)}
                onSaveManual={(value) => handleSelectValue(f.factKey, value)}
                onStatusChange={(status) => handleStatusChange(f.factKey, status)}
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
