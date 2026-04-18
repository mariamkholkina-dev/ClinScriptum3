"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  FileText,
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit3,
  Save,
  X,
  Wand2,
  Cpu,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { ParsingTreeViewer } from "./parsing-viewer";

/* ═══════════════ Constants ═══════════════ */

const STAGES = [
  { key: "parsing", label: "Парсинг" },
  { key: "classification", label: "Классификация" },
  { key: "extraction", label: "Извлечение" },
  { key: "soa", label: "SOA" },
  { key: "intra_audit", label: "Внутренний аудит" },
  { key: "inter_audit", label: "Межд. аудит" },
  { key: "generation", label: "Генерация" },
  { key: "impact", label: "Оценка влияния" },
] as const;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: "bg-gray-100", text: "text-gray-700", label: "Черновик" },
  in_review: { bg: "bg-yellow-50", text: "text-yellow-700", label: "На проверке" },
  approved: { bg: "bg-green-50", text: "text-green-700", label: "Утверждён" },
};

const DOC_TYPE_OPTIONS = ["protocol", "icf", "ib", "csr"] as const;

/* ═══════════════ Type Badge ═══════════════ */

function TypeBadge({ type }: { type: string }) {
  const isSingle = type === "single_document";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        isSingle ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
      }`}
    >
      {isSingle ? "Одиночный документ" : "Множественный документ"}
    </span>
  );
}

/* ═══════════════ Status Badge ═══════════════ */

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {status === "approved" && <CheckCircle2 size={12} />}
      {status === "in_review" && <Clock size={12} />}
      {style.label}
    </span>
  );
}

/* ═══════════════ Add Document Modal ═══════════════ */

const DOC_TYPE_LABELS: Record<string, string> = {
  protocol: "Протокол",
  icf: "ICF",
  ib: "IB",
  csr: "CSR",
};

function AddDocumentModal({
  goldenSampleId,
  onClose,
}: {
  goldenSampleId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"protocol" | "icf" | "ib" | "csr" | "">("");
  const [selectedVersion, setSelectedVersion] = useState<{
    id: string;
    versionNumber: number;
    versionLabel: string | null;
    document: { id: string; title: string; type: string; study: { id: string; title: string } };
  } | null>(null);
  const [role, setRole] = useState("primary");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleOpenDropdown = () => {
    setDropdownOpen(true);
    if (!hasFetched) setHasFetched(true);
  };

  const searchResults = trpc.goldenDataset.searchDocumentVersions.useQuery(
    {
      query: debouncedQuery || undefined,
      documentType: (filterType || undefined) as "protocol" | "icf" | "ib" | "csr" | undefined,
      limit: 20,
    },
    { enabled: hasFetched, staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const addMutation = trpc.goldenDataset.addDocument.useMutation({
    onSuccess: () => {
      utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVersion) return;
    addMutation.mutate({
      goldenSampleId,
      documentVersionId: selectedVersion.id,
      documentType: selectedVersion.document.type as "protocol" | "icf" | "ib" | "csr",
      role,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Добавить документ</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Документ
            </label>
            {selectedVersion ? (
              <div className="flex items-center gap-2 rounded-md border border-brand-300 bg-brand-50 px-3 py-2">
                <FileText size={16} className="shrink-0 text-brand-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {selectedVersion.document.title}
                  </div>
                  <div className="text-xs text-gray-500">
                    {selectedVersion.document.study.title} · {DOC_TYPE_LABELS[selectedVersion.document.type] ?? selectedVersion.document.type} · v{selectedVersion.versionNumber}
                    {selectedVersion.versionLabel ? ` (${selectedVersion.versionLabel})` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedVersion(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      handleOpenDropdown();
                    }}
                    onFocus={handleOpenDropdown}
                    placeholder="Поиск по названию документа..."
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as typeof filterType)}
                    className="rounded-md border border-gray-300 px-2 py-2 text-sm"
                  >
                    <option value="">Все типы</option>
                    {DOC_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>

                {dropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                    <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {searchResults.isLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 size={16} className="animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-500">Поиск...</span>
                        </div>
                      ) : !searchResults.data?.length ? (
                        <div className="py-4 text-center text-sm text-gray-500">
                          {searchQuery ? "Документы не найдены" : "Введите название для поиска"}
                        </div>
                      ) : (
                        searchResults.data.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50"
                            onClick={() => {
                              setSelectedVersion(v as unknown as typeof selectedVersion);
                              setDropdownOpen(false);
                              setSearchQuery("");
                            }}
                          >
                            <FileText size={14} className="mt-0.5 shrink-0 text-gray-400" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {v.document.title}
                              </div>
                              <div className="text-xs text-gray-500">
                                {v.document.study.title} · {DOC_TYPE_LABELS[v.document.type] ?? v.document.type} · v{v.versionNumber}
                                {v.versionLabel ? ` (${v.versionLabel})` : ""}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Роль документа</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="primary">Основной</option>
              <option value="reference">Справочный</option>
              <option value="comparator">Сравнительный</option>
            </select>
          </div>

          {addMutation.error && (
            <p className="text-sm text-red-600">{addMutation.error.message}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending || !selectedVersion}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {addMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Добавление...
                </span>
              ) : (
                "Добавить документ"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════ Stage Data Viewers ═══════════════ */

const CONFIDENCE_COLOR = (c: number) =>
  c >= 0.85 ? "text-green-700 bg-green-50" :
  c >= 0.6 ? "text-blue-700 bg-blue-50" :
  c >= 0.3 ? "text-amber-700 bg-amber-50" :
  "text-red-700 bg-red-50";

const STATUS_LABEL: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Проверен",
  validated: "Подтверждён",
  deferred: "Отложен",
  not_found: "Не найден",
  rejected: "Отклонён",
  pending: "Ожидание",
  confirmed: "Подтверждён",
  resolved: "Решён",
  false_positive: "Ложное",
  not_validated: "Не подтверждён",
  requires_rework: "Треб. доработки",
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
  info: "bg-gray-100 text-gray-700",
};

function SectionsViewer({ versionId }: { versionId: string }) {
  const q = trpc.document.getVersion.useQuery(
    { versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  if (q.isLoading) return <LoadingSpinner />;
  if (q.error) return <ErrorMsg msg={q.error.message} />;
  const sections = q.data?.sections ?? [];
  if (sections.length === 0) return <EmptyMsg text="Секции не найдены. Документ ещё не разобран." />;

  return (
    <div className="space-y-1">
      <p className="mb-3 text-xs text-gray-500">Найдено секций: {sections.length}</p>
      <div className="max-h-[500px] overflow-y-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Секция</th>
              <th className="px-3 py-2">Классификация</th>
              <th className="px-3 py-2">Уверенность</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">Блоков</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sections.map((s: Record<string, unknown>, i: number) => (
              <tr key={(s.id as string) ?? i} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span style={{ paddingLeft: `${((s.level as number) ?? 0) * 12}px` }} className="text-gray-900">
                    {(s.title as string) || "(без названия)"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {(s.standardSection as string) ? (
                    <span className="inline-flex rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      {s.standardSection as string}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {typeof s.confidence === "number" ? (
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLOR(s.confidence)}`}>
                      {Math.round(s.confidence * 100)}%
                    </span>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {STATUS_LABEL[s.status as string] ?? (s.status as string) ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {Array.isArray(s.contentBlocks) ? s.contentBlocks.length : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FactsViewer({ versionId }: { versionId: string }) {
  const q = trpc.processing.listFacts.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  if (q.isLoading) return <LoadingSpinner />;
  if (q.error) return <ErrorMsg msg={q.error.message} />;
  const facts = q.data ?? [];
  if (facts.length === 0) return <EmptyMsg text="Факты не извлечены. Этап извлечения ещё не выполнен." />;

  const grouped = new Map<string, typeof facts>();
  for (const f of facts) {
    const cat = (f as Record<string, unknown>).factCategory as string ?? "other";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(f);
  }

  const stats = {
    total: facts.length,
    validated: facts.filter((f: Record<string, unknown>) => f.status === "validated").length,
    contradictions: facts.filter((f: Record<string, unknown>) => f.hasContradiction).length,
    notFound: facts.filter((f: Record<string, unknown>) => f.status === "not_found").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4 text-xs">
        <span className="rounded bg-gray-100 px-2 py-1 font-medium">Всего: {stats.total}</span>
        <span className="rounded bg-green-50 px-2 py-1 text-green-700">Подтверждено: {stats.validated}</span>
        <span className="rounded bg-red-50 px-2 py-1 text-red-700">Противоречий: {stats.contradictions}</span>
        <span className="rounded bg-gray-50 px-2 py-1 text-gray-500">Не найдено: {stats.notFound}</span>
      </div>
      <div className="max-h-[500px] overflow-y-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-3 py-2">Ключ факта</th>
              <th className="px-3 py-2">Категория</th>
              <th className="px-3 py-2">Значение</th>
              <th className="px-3 py-2">Уверенность</th>
              <th className="px-3 py-2">Статус</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {facts.map((f: Record<string, unknown>, i: number) => (
              <tr key={(f.id as string) ?? i} className={`hover:bg-gray-50 ${f.hasContradiction ? "bg-red-50/40" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs text-gray-900">{f.factKey as string}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{f.factCategory as string}</td>
                <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-700" title={String(f.manualValue ?? f.value ?? "")}>
                  {String(f.manualValue ?? f.value ?? "—")}
                </td>
                <td className="px-3 py-2">
                  {typeof f.confidence === "number" ? (
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_COLOR(f.confidence)}`}>
                      {Math.round(f.confidence * 100)}%
                    </span>
                  ) : <span className="text-xs text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {STATUS_LABEL[f.status as string] ?? (f.status as string)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoaViewer({ versionId }: { versionId: string }) {
  const q = trpc.processing.getSoaData.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  if (q.isLoading) return <LoadingSpinner />;
  if (q.error) return <ErrorMsg msg={q.error.message} />;
  const tables = q.data ?? [];
  if (!Array.isArray(tables) || tables.length === 0) return <EmptyMsg text="SOA таблицы не обнаружены." />;

  return (
    <div className="space-y-6">
      {tables.map((tbl: Record<string, unknown>, ti: number) => {
        const cells = (tbl.cells ?? []) as Array<Record<string, unknown>>;
        const visits = new Set<string>();
        const procedures = new Set<string>();
        for (const c of cells) {
          visits.add(c.visitName as string);
          procedures.add(c.procedureName as string);
        }
        const visitArr = Array.from(visits);
        const procArr = Array.from(procedures);
        const cellMap = new Map<string, Record<string, unknown>>();
        for (const c of cells) cellMap.set(`${c.procedureName}||${c.visitName}`, c);

        return (
          <div key={(tbl.id as string) ?? ti} className="rounded-md border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
              <span className="text-sm font-medium text-gray-900">{(tbl.title as string) || `SOA #${ti + 1}`}</span>
              <div className="flex gap-3 text-xs text-gray-500">
                <span>Процедур: {procArr.length}</span>
                <span>Визитов: {visitArr.length}</span>
                {typeof tbl.soaScore === "number" && <span>Оценка: {Math.round((tbl.soaScore as number) * 100)}%</span>}
              </div>
            </div>
            <div className="max-h-[400px] overflow-auto p-2">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white px-2 py-1 text-left font-medium text-gray-600">Процедура</th>
                    {visitArr.map((v) => (
                      <th key={v} className="px-2 py-1 text-center font-medium text-gray-600 whitespace-nowrap">{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {procArr.map((proc) => (
                    <tr key={proc} className="hover:bg-gray-50">
                      <td className="sticky left-0 bg-white px-2 py-1 font-medium text-gray-800 whitespace-nowrap">{proc}</td>
                      {visitArr.map((vis) => {
                        const cell = cellMap.get(`${proc}||${vis}`);
                        const val = (cell?.normalizedValue ?? cell?.rawValue ?? "") as string;
                        const conf = cell?.confidence as number | undefined;
                        return (
                          <td key={vis} className={`px-2 py-1 text-center ${conf !== undefined && conf < 0.8 ? "bg-amber-50" : ""}`}>
                            {val || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FindingsViewer({ versionId }: { versionId: string }) {
  const q = trpc.processing.listFindings.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  if (q.isLoading) return <LoadingSpinner />;
  if (q.error) return <ErrorMsg msg={q.error.message} />;
  const findings = q.data ?? [];
  if (findings.length === 0) return <EmptyMsg text="Замечания не найдены. Аудит ещё не выполнен." />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Найдено замечаний: {findings.length}</p>
      <div className="max-h-[500px] overflow-y-auto space-y-2">
        {findings.map((f: Record<string, unknown>, i: number) => (
          <div key={(f.id as string) ?? i} className="rounded-md border border-gray-200 p-3">
            <div className="mb-1 flex items-center gap-2">
              {typeof f.severity === "string" && (
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[f.severity] ?? "bg-gray-100"}`}>
                  {f.severity.toUpperCase()}
                </span>
              )}
              {typeof f.auditCategory === "string" && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{f.auditCategory}</span>
              )}
              <span className="ml-auto text-xs text-gray-500">
                {STATUS_LABEL[f.status as string] ?? String(f.status ?? "")}
              </span>
            </div>
            <p className="text-sm text-gray-900">{String(f.description ?? "")}</p>
            {typeof f.suggestion === "string" && (
              <p className="mt-1 text-xs text-gray-600">
                <span className="font-medium">Рекомендация:</span> {f.suggestion}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <Loader2 size={18} className="animate-spin text-gray-400" />
      <span className="ml-2 text-sm text-gray-500">Загрузка данных...</span>
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
      <AlertCircle size={16} /> {msg}
    </div>
  );
}

function EmptyMsg({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-gray-400 italic">{text}</p>;
}

const STAGE_TO_RUN_TYPE: Record<string, string> = {
  classification: "section_classification",
  extraction: "fact_extraction",
  soa: "soa_detection",
  intra_audit: "intra_doc_audit",
  inter_audit: "inter_doc_audit",
  generation: "icf_generation",
};

const PIPELINE_LEVEL_LABELS: Record<string, string> = {
  deterministic: "Детерминированный",
  llm_check: "LLM проверка",
  llm_qa: "LLM арбитраж",
  operator_review: "Операторская проверка",
  user_validation: "Валидация",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  db_tenant: "БД (tenant)",
  db_global: "БД (глобальный)",
  env_task: "Env (задача)",
  env_global: "Env (глобальный)",
};

function LlmConfigPanel({ versionId, stageKey }: { versionId: string; stageKey: string }) {
  const runType = STAGE_TO_RUN_TYPE[stageKey];
  const [expanded, setExpanded] = useState(false);

  const runsQuery = trpc.processing.listRuns.useQuery(
    { docVersionId: versionId },
    { enabled: !!runType, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (!runType) return null;

  const runsData = runsQuery.data ?? [];
  const runs = runsData as unknown as Array<{
    id: string;
    type: string;
    status: string;
    createdAt: string;
    steps: Array<{
      id: string;
      level: string;
      status: string;
      llmConfigSnapshot?: {
        provider?: string;
        model?: string;
        temperature?: number;
        maxTokens?: number;
        sourceType?: string;
        sourceConfigId?: string;
      } | null;
      startedAt?: string;
      completedAt?: string;
    }>;
  }>;

  const relevantRuns = runs.filter((r) => r.type === runType);
  if (relevantRuns.length === 0) return null;

  const latestRun = relevantRuns[0];
  const stepsWithConfig = latestRun.steps.filter((s) => s.llmConfigSnapshot);

  if (stepsWithConfig.length === 0 && !expanded) {
    return null;
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100"
      >
        <Cpu size={12} className="text-gray-500" />
        <span className="font-medium text-gray-600">Настройки LLM</span>
        {stepsWithConfig.length > 0 && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
            {stepsWithConfig.length} {stepsWithConfig.length === 1 ? "шаг" : "шага"}
          </span>
        )}
        {expanded ? <ChevronDown size={12} className="ml-auto text-gray-400" /> : <ChevronRight size={12} className="ml-auto text-gray-400" />}
      </button>
      {expanded && (
        <div className="border-t border-gray-200 px-3 py-2 space-y-2">
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <span>Прогон: {latestRun.status === "completed" ? "✓" : latestRun.status}</span>
            <span>•</span>
            <span>{new Date(latestRun.createdAt).toLocaleString("ru")}</span>
          </div>
          {latestRun.steps.map((step) => (
            <div key={step.id} className="rounded border border-gray-200 bg-white px-2.5 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-700">
                  {PIPELINE_LEVEL_LABELS[step.level] ?? step.level}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  step.status === "completed" ? "bg-green-100 text-green-700" :
                  step.status === "failed" ? "bg-red-100 text-red-700" :
                  step.status === "skipped" ? "bg-gray-100 text-gray-500" :
                  "bg-yellow-100 text-yellow-700"
                }`}>
                  {step.status}
                </span>
              </div>
              {step.llmConfigSnapshot ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div>
                    <span className="text-gray-400">Провайдер: </span>
                    <span className="text-gray-700">{step.llmConfigSnapshot.provider}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Модель: </span>
                    <span className="font-mono text-gray-700">{step.llmConfigSnapshot.model}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Temperature: </span>
                    <span className="text-gray-700">{step.llmConfigSnapshot.temperature}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Max tokens: </span>
                    <span className="text-gray-700">{step.llmConfigSnapshot.maxTokens}</span>
                  </div>
                  {step.llmConfigSnapshot.sourceType && (
                    <div className="col-span-2">
                      <span className="text-gray-400">Источник: </span>
                      <span className="rounded bg-blue-50 px-1 py-0.5 text-blue-700">
                        {SOURCE_TYPE_LABELS[step.llmConfigSnapshot.sourceType] ?? step.llmConfigSnapshot.sourceType}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-gray-400 italic">LLM не использовался</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StageDataViewer({ stageKey, versionIds, expectedResults }: { stageKey: string; versionIds: string[]; expectedResults?: unknown }) {
  if (versionIds.length === 0) {
    return <EmptyMsg text="Добавьте документы, чтобы увидеть результаты обработки." />;
  }
  const vid = versionIds[0];

  switch (stageKey) {
    case "parsing":
      return <ParsingTreeViewer versionId={vid} expectedResults={expectedResults} />;
    case "classification":
      return <SectionsViewer versionId={vid} />;
    case "extraction":
      return <FactsViewer versionId={vid} />;
    case "soa":
      return <SoaViewer versionId={vid} />;
    case "intra_audit":
    case "inter_audit":
      return <FindingsViewer versionId={vid} />;
    default:
      return <EmptyMsg text="Просмотр данных для этого этапа пока не реализован." />;
  }
}

/* ═══════════════ Stage Tab Panel ═══════════════ */

function ReviewCommentModal({
  onSubmit,
  onClose,
  isPending,
}: {
  onSubmit: (comment: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900">Отправить на проверку</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Комментарий <span className="text-gray-400 font-normal">(необязательно)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Опишите, что именно нужно проверить..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              onClick={() => onSubmit(comment)}
              disabled={isPending}
              className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Отправка...
                </span>
              ) : (
                "Отправить на проверку"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StagePanel({
  goldenSampleId,
  stageKey,
  stageStatus,
  documentVersionIds,
}: {
  goldenSampleId: string;
  stageKey: string;
  stageStatus?: { status: string; expectedResults: unknown; reviewComment?: string | null };
  documentVersionIds: string[];
}) {
  const utils = trpc.useUtils();
  const currentStatus = stageStatus?.status ?? "not_set";
  const [isEditing, setIsEditing] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [expectedJson, setExpectedJson] = useState(() => {
    if (stageStatus?.expectedResults) {
      return JSON.stringify(stageStatus.expectedResults, null, 2);
    }
    return "{}";
  });
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateMutation = trpc.goldenDataset.updateStageStatus.useMutation({
    onSuccess: () => {
      utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
      setShowReviewModal(false);
    },
  });

  const primaryVersionId = documentVersionIds[0] ?? null;
  const versionQuery = trpc.document.getVersion.useQuery(
    { versionId: primaryVersionId! },
    { enabled: !!primaryVersionId, staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const factsQuery = trpc.processing.listFacts.useQuery(
    { docVersionId: primaryVersionId! },
    { enabled: !!primaryVersionId && (stageKey === "extraction"), staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const findingsQuery = trpc.processing.listFindings.useQuery(
    { docVersionId: primaryVersionId! },
    { enabled: !!primaryVersionId && (stageKey === "intra_audit" || stageKey === "inter_audit"), staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const soaQuery = trpc.processing.getSoaData.useQuery(
    { docVersionId: primaryVersionId! },
    { enabled: !!primaryVersionId && stageKey === "soa", staleTime: 60_000, refetchOnWindowFocus: false },
  );

  const canGenerate = useMemo(() => {
    if (!primaryVersionId) return false;
    switch (stageKey) {
      case "parsing":
      case "classification":
        return !!versionQuery.data?.sections?.length;
      case "extraction":
        return !!(factsQuery.data as unknown[])?.length;
      case "soa":
        return !!(soaQuery.data as unknown[])?.length;
      case "intra_audit":
      case "inter_audit":
        return !!(findingsQuery.data as unknown[])?.length;
      default:
        return false;
    }
  }, [primaryVersionId, stageKey, versionQuery.data, factsQuery.data, soaQuery.data, findingsQuery.data]);

  const generateExpectedJson = useCallback(() => {
    let generated: unknown;

    switch (stageKey) {
      case "parsing": {
        const sections = (versionQuery.data?.sections ?? []) as Array<Record<string, unknown>>;
        generated = {
          sections: sections.map((s) => ({
            title: s.title,
            level: s.level,
            order: s.order,
            hasContent: Array.isArray(s.contentBlocks) && s.contentBlocks.length > 0,
          })),
        };
        break;
      }
      case "classification": {
        const sections = (versionQuery.data?.sections ?? []) as Array<Record<string, unknown>>;
        generated = {
          sections: sections.map((s) => ({
            title: s.title,
            standardSection: s.standardSection,
            confidence: s.confidence,
          })),
        };
        break;
      }
      case "extraction": {
        const facts = (factsQuery.data ?? []) as Array<Record<string, unknown>>;
        generated = {
          facts: facts.map((f) => ({
            factKey: f.factKey,
            factCategory: f.factCategory,
            value: f.manualValue ?? f.value,
            status: f.status,
          })),
        };
        break;
      }
      case "soa": {
        const tables = (soaQuery.data ?? []) as Array<Record<string, unknown>>;
        generated = {
          tables: tables.map((t) => ({
            title: t.title,
            soaScore: t.soaScore,
            cellCount: Array.isArray(t.cells) ? t.cells.length : 0,
          })),
        };
        break;
      }
      case "intra_audit":
      case "inter_audit": {
        const findings = (findingsQuery.data ?? []) as Array<Record<string, unknown>>;
        generated = {
          findings: findings.map((f) => ({
            description: f.description,
            severity: f.severity,
            status: f.status,
            auditCategory: f.auditCategory,
          })),
        };
        break;
      }
      default:
        return;
    }

    setExpectedJson(JSON.stringify(generated, null, 2));
    setIsEditing(true);
  }, [stageKey, versionQuery.data, factsQuery.data, soaQuery.data, findingsQuery.data]);

  const handleStatusChange = useCallback(
    (status: "draft" | "in_review" | "approved", reviewComment?: string) => {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(expectedJson);
      } catch {
        // ignore parse errors for status-only changes
      }
      updateMutation.mutate({
        goldenSampleId,
        stage: stageKey,
        status,
        expectedResults: parsed,
        ...(reviewComment !== undefined ? { reviewComment } : {}),
      });
    },
    [goldenSampleId, stageKey, expectedJson, updateMutation],
  );

  const handleSaveExpected = useCallback(() => {
    setJsonError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(expectedJson);
    } catch {
      parsed = { description: expectedJson };
    }
    updateMutation.mutate(
      {
        goldenSampleId,
        stage: stageKey,
        status: (currentStatus === "not_set" ? "draft" : currentStatus) as
          | "draft"
          | "in_review"
          | "approved",
        expectedResults: parsed as Record<string, unknown>,
      },
      {
        onSuccess: () => setIsEditing(false),
      },
    );
  }, [expectedJson, goldenSampleId, stageKey, currentStatus, updateMutation]);

  return (
    <div className="space-y-6">
      {/* Stage Status & Actions */}
      <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <CheckCircle2 size={14} className="text-brand-600" />
          <span className="text-xs font-semibold uppercase tracking-wider text-brand-700">Статус этапа</span>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Управление статусом готовности этого этапа эталонного образца. Не влияет на статус отдельных секций.
        </p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600">Текущий:</span>
            {currentStatus === "not_set" ? (
              <span className="text-sm text-gray-400 italic">Не настроен</span>
            ) : (
              <StatusBadge status={currentStatus} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {updateMutation.isPending && (
              <Loader2 size={16} className="animate-spin text-gray-400" />
            )}
            <button
              onClick={() => handleStatusChange("draft")}
              disabled={updateMutation.isPending || currentStatus === "draft"}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Черновик
            </button>
            <button
              onClick={() => setShowReviewModal(true)}
              disabled={updateMutation.isPending || currentStatus === "in_review"}
              className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-700 hover:bg-yellow-100 disabled:opacity-40"
            >
              На проверку
            </button>
            <button
              onClick={() => handleStatusChange("approved")}
              disabled={updateMutation.isPending || currentStatus === "approved"}
              className="rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-40"
            >
              Утвердить
            </button>
          </div>
        </div>
      </div>

      {/* Review comment display */}
      {currentStatus === "in_review" && stageStatus?.reviewComment && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-xs font-medium text-yellow-800 mb-1">Комментарий к проверке:</p>
          <p className="text-sm text-yellow-700">{stageStatus.reviewComment}</p>
        </div>
      )}

      {updateMutation.error && (
        <p className="text-sm text-red-600">{updateMutation.error.message}</p>
      )}

      {/* Review comment modal */}
      {showReviewModal && (
        <ReviewCommentModal
          onSubmit={(comment) => handleStatusChange("in_review", comment || undefined)}
          onClose={() => setShowReviewModal(false)}
          isPending={updateMutation.isPending}
        />
      )}

      {/* Actual Processing Results */}
      <div>
        <h4 className="mb-3 text-sm font-semibold text-gray-700">Результаты обработки</h4>
        <StageDataViewer stageKey={stageKey} versionIds={documentVersionIds} expectedResults={stageStatus?.expectedResults} />
      </div>

      {/* LLM Config Info */}
      {documentVersionIds[0] && (
        <LlmConfigPanel versionId={documentVersionIds[0]} stageKey={stageKey} />
      )}

      {/* Expected Results */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-700">Ожидаемые результаты</h4>
          {!isEditing ? (
            <div className="flex items-center gap-2">
              {canGenerate && (
                <button
                  onClick={generateExpectedJson}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
                >
                  <Wand2 size={12} /> Сгенерировать из результатов
                </button>
              )}
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <Edit3 size={12} /> Редактировать
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setJsonError(null);
                  if (stageStatus?.expectedResults) {
                    setExpectedJson(JSON.stringify(stageStatus.expectedResults, null, 2));
                  }
                }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <X size={12} /> Отмена
              </button>
              <button
                onClick={handleSaveExpected}
                disabled={updateMutation.isPending}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <Save size={12} /> Сохранить
              </button>
            </div>
          )}
        </div>
        {jsonError && <p className="mb-2 text-xs text-red-600">{jsonError}</p>}
        {isEditing ? (
          <textarea
            value={expectedJson}
            onChange={(e) => setExpectedJson(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        ) : (
          <pre className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-700">
            {stageStatus?.expectedResults
              ? JSON.stringify(stageStatus.expectedResults, null, 2)
              : "Ожидаемые результаты не определены."}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ Detail Page ═══════════════ */

export default function GoldenDatasetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const utils = trpc.useUtils();
  const id = params.id as string;

  const [activeStage, setActiveStage] = useState<(typeof STAGES)[number]["key"]>(STAGES[0].key);
  const [showAddDoc, setShowAddDoc] = useState(false);

  const sampleQuery = trpc.goldenDataset.getSample.useQuery({ id });

  const removeMutation = trpc.goldenDataset.removeDocument.useMutation({
    onSuccess: () => {
      utils.goldenDataset.getSample.invalidate({ id });
    },
  });

  const deleteMutation = trpc.goldenDataset.deleteSample.useMutation({
    onSuccess: () => {
      router.push("/golden-dataset");
    },
  });

  const sample = sampleQuery.data;

  const stageStatusMap = new Map(
    sample?.stageStatuses?.map((s) => [s.stage, s]) ?? [],
  );

  /* ── Loading ── */
  if (sampleQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  /* ── Error ── */
  if (sampleQuery.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <AlertCircle size={28} className="text-red-400" />
        <p className="text-sm text-red-600">{sampleQuery.error.message}</p>
        <button
          onClick={() => router.push("/golden-dataset")}
          className="text-sm text-brand-600 hover:text-brand-700"
        >
          Назад к списку
        </button>
      </div>
    );
  }

  if (!sample) return null;

  return (
    <div>
      {/* Back + Header */}
      <button
        onClick={() => router.push("/golden-dataset")}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} /> Назад к эталонному набору
      </button>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{sample.name}</h1>
            <TypeBadge type={sample.sampleType} />
          </div>
          {sample.description && (
            <p className="mt-1 text-sm text-gray-500">{sample.description}</p>
          )}
          {sample.createdBy && (
            <p className="mt-1 text-xs text-gray-400">
              Создал(а) {sample.createdBy.name ?? sample.createdBy.email},{" "}
              {new Date(sample.createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
        <button
          onClick={() => {
            if (confirm("Удалить этот эталонный образец? Это действие нельзя отменить.")) {
              deleteMutation.mutate({ id });
            }
          }}
          disabled={deleteMutation.isPending}
          className="flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          <Trash2 size={14} />
          {deleteMutation.isPending ? "Удаление..." : "Удалить"}
        </button>
      </div>

      {/* Documents Section */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Документы ({sample.documents.length})
          </h2>
          <button
            onClick={() => setShowAddDoc(true)}
            className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={14} /> Добавить документ
          </button>
        </div>

        {sample.documents.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            Документы ещё не добавлены.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="pb-2 pr-4">Документ</th>
                <th className="pb-2 pr-4">Тип</th>
                <th className="pb-2 pr-4">Роль</th>
                <th className="pb-2 pr-4">Версия</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sample.documents.map((doc) => (
                <tr key={doc.id} className="group">
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-gray-400" />
                      <span className="text-sm text-gray-900">
                        {doc.documentVersion?.document?.title ?? doc.documentVersionId}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {doc.documentType.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-sm text-gray-600">
                    {doc.role ?? "primary"}
                  </td>
                  <td className="py-2.5 pr-4 text-sm text-gray-500">
                    {doc.documentVersion?.versionLabel ??
                      `v${doc.documentVersion?.versionNumber ?? "?"}`}
                  </td>
                  <td className="py-2.5">
                    <button
                      onClick={() => {
                        if (confirm("Удалить этот документ из образца?")) {
                          removeMutation.mutate({ goldenSampleDocumentId: doc.id });
                        }
                      }}
                      disabled={removeMutation.isPending}
                      className="invisible text-gray-400 hover:text-red-500 group-hover:visible"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Stages Section */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 pt-4">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Этапы пайплайна</h2>
          <div className="flex gap-0 overflow-x-auto">
            {STAGES.map((stage) => {
              const stageData = stageStatusMap.get(stage.key);
              const status = stageData?.status;
              const isActive = activeStage === stage.key;
              return (
                <button
                  key={stage.key}
                  onClick={() => setActiveStage(stage.key)}
                  className={`relative flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "border-brand-600 text-brand-700 font-medium"
                      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  {status && (
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        status === "approved"
                          ? "bg-green-500"
                          : status === "in_review"
                            ? "bg-yellow-400"
                            : "bg-gray-300"
                      }`}
                    />
                  )}
                  {stage.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-6">
          <StagePanel
            key={activeStage}
            goldenSampleId={id}
            stageKey={activeStage}
            stageStatus={
              stageStatusMap.get(activeStage) as
                | { status: string; expectedResults: unknown; reviewComment?: string | null }
                | undefined
            }
            documentVersionIds={
              sample.documents
                .map((d) => d.documentVersion?.id)
                .filter((vid): vid is string => !!vid)
            }
          />
        </div>
      </div>

      {/* Modals */}
      {showAddDoc && (
        <AddDocumentModal goldenSampleId={id} onClose={() => setShowAddDoc(false)} />
      )}
    </div>
  );
}
