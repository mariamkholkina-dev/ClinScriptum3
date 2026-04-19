"use client";

import { useState, useMemo, Fragment } from "react";
import { trpc } from "@/lib/trpc";
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  X,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  section_classification: "Классификация секций",
  fact_extraction: "Извлечение фактов",
  soa_detection: "Обнаружение SOA",
  intra_doc_audit: "Внутренний аудит",
  inter_doc_audit: "Межд. аудит",
  icf_generation: "Генерация ICF",
  csr_generation: "Генерация CSR",
  version_comparison: "Сравнение версий",
};

const STATUS_LABELS: Record<string, string> = {
  queued: "В очереди",
  running: "Выполняется",
  completed: "Завершено",
  failed: "Ошибка",
  pending: "Ожидание",
  skipped: "Пропущено",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  skipped: "bg-gray-100 text-gray-500",
};

const LEVEL_LABELS: Record<string, string> = {
  deterministic: "Детерминированный",
  llm_check: "LLM проверка",
  llm_qa: "LLM QA",
  operator_review: "Оператор",
  user_validation: "Валидация",
};

const PAGE_SIZES = [20, 50, 100] as const;

type SortField = "date" | "type" | "status" | "document" | "study" | "steps";
type SortDir = "asc" | "desc";

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className ?? ""}`}>
      {label}
    </span>
  );
}

function LlmConfigCell({ snapshot }: { snapshot: any }) {
  if (!snapshot) return <span className="text-gray-400">—</span>;
  const provider = snapshot.provider ?? snapshot.llmProvider ?? "?";
  const model = snapshot.model ?? snapshot.llmModel ?? "?";
  const temp = snapshot.temperature ?? snapshot.llmTemperature;
  return (
    <div className="text-xs leading-tight">
      <div className="font-medium">{provider}</div>
      <div className="text-gray-500">{model}</div>
      {temp !== undefined && temp !== null && (
        <div className="text-gray-400">t={temp}</div>
      )}
    </div>
  );
}

function RuleSnapshotCell({ snapshot }: { snapshot: any }) {
  if (!snapshot) return <span className="text-gray-400">—</span>;
  const rules = Array.isArray(snapshot) ? snapshot : snapshot.rules;
  if (!rules) return <span className="text-gray-400">—</span>;
  return <span className="text-xs text-gray-600">{rules.length} правил(а)</span>;
}

function ExpandedRow({ runId }: { runId: string }) {
  const { data: run } = trpc.processing.getRun.useQuery({ runId });

  if (!run) return <tr><td colSpan={9} className="px-4 py-3 text-sm text-gray-500">Загрузка...</td></tr>;

  const steps = run.steps ?? [];
  if (steps.length === 0) {
    return <tr><td colSpan={9} className="px-4 py-3 text-sm text-gray-400">Нет этапов</td></tr>;
  }

  return (
    <>
      <tr className="bg-gray-50">
        <td />
        <td colSpan={8}>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="px-3 py-1 text-left font-medium">Уровень</th>
                <th className="px-3 py-1 text-left font-medium">Статус</th>
                <th className="px-3 py-1 text-left font-medium">LLM конфиг</th>
                <th className="px-3 py-1 text-left font-medium">Правила</th>
                <th className="px-3 py-1 text-left font-medium">Начало</th>
                <th className="px-3 py-1 text-left font-medium">Длительность</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step: any) => {
                const dur = step.startedAt && step.completedAt
                  ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000)
                  : null;
                return (
                  <tr key={step.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-sm">{LEVEL_LABELS[step.level] ?? step.level}</td>
                    <td className="px-3 py-1.5">
                      <Badge label={STATUS_LABELS[step.status] ?? step.status} className={STATUS_COLORS[step.status] ?? "bg-gray-100"} />
                    </td>
                    <td className="px-3 py-1.5"><LlmConfigCell snapshot={step.llmConfigSnapshot} /></td>
                    <td className="px-3 py-1.5"><RuleSnapshotCell snapshot={step.ruleSnapshot} /></td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {step.startedAt ? new Date(step.startedAt).toLocaleTimeString("ru") : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {dur !== null ? `${dur}с` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ArrowUpDown size={14} className="text-gray-300" />;
  return dir === "asc" ? <ArrowUp size={14} className="text-brand-600" /> : <ArrowDown size={14} className="text-brand-600" />;
}

export default function AuditPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [cursors, setCursors] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const currentCursor = currentPage > 0 ? cursors[currentPage - 1] : undefined;

  const { data, isLoading, refetch, isFetching } = trpc.processing.listAllRuns.useQuery({
    limit: pageSize,
    cursor: currentCursor,
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  });

  const runs = data?.runs ?? [];
  const nextCursor = data?.nextCursor;

  const sortedRuns = useMemo(() => {
    const sorted = [...runs];
    sorted.sort((a: any, b: any) => {
      let cmp = 0;
      switch (sortField) {
        case "date":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "type":
          cmp = (a.type ?? "").localeCompare(b.type ?? "");
          break;
        case "status":
          cmp = (a.status ?? "").localeCompare(b.status ?? "");
          break;
        case "document":
          cmp = (a.docVersion?.document?.title ?? "").localeCompare(b.docVersion?.document?.title ?? "");
          break;
        case "study":
          cmp = (a.study?.title ?? "").localeCompare(b.study?.title ?? "");
          break;
        case "steps":
          cmp = (a.steps?.length ?? 0) - (b.steps?.length ?? 0);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [runs, sortField, sortDir]);

  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) return sortedRuns;
    const q = searchQuery.toLowerCase();
    return sortedRuns.filter((run: any) => {
      const docTitle = (run.docVersion?.document?.title ?? "").toLowerCase();
      const studyTitle = (run.study?.title ?? "").toLowerCase();
      const type = (TYPE_LABELS[run.type] ?? run.type ?? "").toLowerCase();
      const bundleName = (run.ruleSetBundle?.name ?? "").toLowerCase();
      return docTitle.includes(q) || studyTitle.includes(q) || type.includes(q) || bundleName.includes(q);
    });
  }, [sortedRuns, searchQuery]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir(field === "date" ? "desc" : "asc");
    }
  };

  const goNextPage = () => {
    if (!nextCursor) return;
    const newCursors = [...cursors];
    newCursors[currentPage] = nextCursor;
    setCursors(newCursors);
    setCurrentPage(currentPage + 1);
    setExpandedId(null);
  };

  const goPrevPage = () => {
    if (currentPage === 0) return;
    setCurrentPage(currentPage - 1);
    setExpandedId(null);
  };

  const resetFilters = () => {
    setTypeFilter("");
    setStatusFilter("");
    setSearchQuery("");
    setCursors([]);
    setCurrentPage(0);
  };

  const hasActiveFilters = typeFilter || statusFilter || searchQuery;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Аудит обработок</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          Обновить
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Поиск по документу, исследованию..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-8 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            style={{ width: 320 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setCursors([]); setCurrentPage(0); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Все типы</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setCursors([]); setCurrentPage(0); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setCursors([]); setCurrentPage(0); }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s} на странице</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <X size={14} />
            Сбросить
          </button>
        )}
        <span className="ml-auto text-sm text-gray-500">
          {filteredRuns.length} записей{nextCursor ? "+" : ""}
          {currentPage > 0 && ` · стр. ${currentPage + 1}`}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          Обработки не найдены
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs font-medium uppercase text-gray-500">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("document")}>
                    <span className="inline-flex items-center gap-1">Документ <SortIcon field="document" current={sortField} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("study")}>
                    <span className="inline-flex items-center gap-1">Исследование <SortIcon field="study" current={sortField} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("type")}>
                    <span className="inline-flex items-center gap-1">Тип <SortIcon field="type" current={sortField} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    <span className="inline-flex items-center gap-1">Статус <SortIcon field="status" current={sortField} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 py-3">Bundle</th>
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("steps")}>
                    <span className="inline-flex items-center gap-1">Этапы <SortIcon field="steps" current={sortField} dir={sortDir} /></span>
                  </th>
                  <th className="px-4 py-3">Длительность</th>
                  <th className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort("date")}>
                    <span className="inline-flex items-center gap-1">Дата <SortIcon field="date" current={sortField} dir={sortDir} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRuns.map((run: any) => {
                  const isExpanded = expandedId === run.id;
                  const totalDur = run.steps?.length
                    ? (() => {
                        const starts = run.steps.filter((s: any) => s.startedAt).map((s: any) => new Date(s.startedAt).getTime());
                        const ends = run.steps.filter((s: any) => s.completedAt).map((s: any) => new Date(s.completedAt).getTime());
                        if (!starts.length || !ends.length) return null;
                        return Math.round((Math.max(...ends) - Math.min(...starts)) / 1000);
                      })()
                    : null;
                  return (
                    <Fragment key={run.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedId(isExpanded ? null : run.id)}
                      >
                        <td className="px-4 py-3 text-gray-400">
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">
                            {run.docVersion?.document?.title ?? "—"}
                          </div>
                          <div className="text-xs text-gray-500">
                            v{run.docVersion?.versionNumber ?? "?"} &middot; {run.docVersion?.document?.type ?? ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {run.study?.title ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {TYPE_LABELS[run.type] ?? run.type}
                        </td>
                        <td className="px-4 py-3">
                          <Badge label={STATUS_LABELS[run.status] ?? run.status} className={STATUS_COLORS[run.status] ?? "bg-gray-100"} />
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {run.ruleSetBundle ? (
                            <span className="text-gray-700">{run.ruleSetBundle.name}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {run.steps?.length ?? 0}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {totalDur !== null ? `${totalDur}с` : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(run.createdAt).toLocaleString("ru")}
                        </td>
                      </tr>
                      {isExpanded && <ExpandedRow runId={run.id} />}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
            <button
              onClick={goPrevPage}
              disabled={currentPage === 0}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              Назад
            </button>
            <span className="text-sm text-gray-500">Страница {currentPage + 1}</span>
            <button
              onClick={goNextPage}
              disabled={!nextCursor}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Далее
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

