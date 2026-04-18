"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  Plus,
  Upload,
  Database,
  FileText,
  Search,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const STAGES = [
  "parsing",
  "classification",
  "extraction",
  "soa",
  "intra_audit",
  "inter_audit",
  "generation",
  "impact",
] as const;

const STAGE_LABELS: Record<string, string> = {
  parsing: "Парсинг",
  classification: "Классиф.",
  extraction: "Извлеч.",
  soa: "SOA",
  intra_audit: "Внутр.",
  inter_audit: "Межд.",
  generation: "Генер.",
  impact: "Влияние",
};

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-500",
  in_review: "bg-yellow-400",
  draft: "bg-gray-300",
};

const SAMPLE_TYPE_OPTIONS = [
  { label: "Все типы", value: "" },
  { label: "Одиночный документ", value: "single_document" },
  { label: "Множественный документ", value: "multi_document" },
] as const;

const STAGE_OPTIONS = [
  { label: "All Stages", value: "" },
  ...STAGES.map((s) => ({ label: STAGE_LABELS[s] ?? s, value: s })),
] as const;

const STATUS_OPTIONS = [
  { label: "Все статусы", value: "" },
  { label: "Черновик", value: "draft" },
  { label: "На проверке", value: "in_review" },
  { label: "Утверждён", value: "approved" },
] as const;

const DOC_TYPE_OPTIONS = ["protocol", "icf", "ib", "csr"] as const;

const DOC_TYPE_LABELS: Record<string, string> = {
  protocol: "Протокол",
  icf: "ICF",
  ib: "IB",
  csr: "CSR",
};

type DocVersion = {
  id: string;
  versionNumber: number;
  versionLabel: string | null;
  document: { id: string; title: string; type: string; study: { id: string; title: string } };
};

/* ═══════════════ Document Search Picker ═══════════════ */

function DocumentSearchPicker({
  selected,
  onSelect,
  onRemove,
}: {
  selected: DocVersion | null;
  onSelect: (v: DocVersion) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const searchResults = trpc.goldenDataset.searchDocumentVersions.useQuery(
    { query: debouncedQuery || undefined, limit: 15 },
    { enabled: hasFetched, staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const handleOpen = () => {
    setOpen(true);
    setHasFetched(true);
  };

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5">
        <FileText size={14} className="shrink-0 text-brand-600" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-gray-900 truncate block">
            {selected.document.title}
          </span>
          <span className="text-[10px] text-gray-500">
            {selected.document.study.title} · {DOC_TYPE_LABELS[selected.document.type] ?? selected.document.type} · v{selected.versionNumber}
          </span>
        </div>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); handleOpen(); }}
        onFocus={handleOpen}
        placeholder="Поиск по названию..."
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
            {searchResults.isLoading ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 size={14} className="animate-spin text-gray-400" />
                <span className="ml-2 text-xs text-gray-500">Поиск...</span>
              </div>
            ) : !searchResults.data?.length ? (
              <div className="py-3 text-center text-xs text-gray-500">
                {query ? "Не найдено" : "Введите название"}
              </div>
            ) : (
              searchResults.data.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50"
                  onClick={() => {
                    onSelect(v as unknown as DocVersion);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <FileText size={12} className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-900 truncate">{v.document.title}</div>
                    <div className="text-[10px] text-gray-500">
                      {v.document.study.title} · {DOC_TYPE_LABELS[v.document.type] ?? v.document.type} · v{v.versionNumber}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════ Create Sample Modal ═══════════════ */

type DocEntry = {
  selected: DocVersion | null;
  role: string;
};

function CreateSampleModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sampleType, setSampleType] = useState<"single_document" | "multi_document">(
    "single_document",
  );
  const [docEntries, setDocEntries] = useState<DocEntry[]>([
    { selected: null, role: "primary" },
  ]);

  const createMutation = trpc.goldenDataset.createSample.useMutation({
    onSuccess: async (sample) => {
      const docsToAdd = docEntries.filter((d) => d.selected);
      for (let i = 0; i < docsToAdd.length; i++) {
        const entry = docsToAdd[i];
        await addDocMutation.mutateAsync({
          goldenSampleId: sample.id,
          documentVersionId: entry.selected!.id,
          documentType: entry.selected!.document.type as "protocol" | "icf" | "ib" | "csr",
          role: entry.role,
          order: i,
        });
      }
      utils.goldenDataset.listSamples.invalidate();
      onClose();
    },
  });

  const addDocMutation = trpc.goldenDataset.addDocument.useMutation();

  const addDocEntry = () => {
    setDocEntries((prev) => [...prev, { selected: null, role: "primary" }]);
  };

  const removeDocEntry = (idx: number) => {
    setDocEntries((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateDocEntry = (idx: number, field: keyof DocEntry, value: DocEntry[keyof DocEntry]) => {
    setDocEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name: name.trim(), description: description.trim() || undefined, sampleType });
  };

  const isLoading = createMutation.isPending || addDocMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Создать эталонный образец</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="напр. Протокол v2.1 Эталон"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Необязательное описание..."
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Sample Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тип образца</label>
            <select
              value={sampleType}
              onChange={(e) => setSampleType(e.target.value as "single_document" | "multi_document")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="single_document">Одиночный документ</option>
              <option value="multi_document">Множественный документ</option>
            </select>
          </div>

          {/* Documents */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Документы</label>
              <button
                type="button"
                onClick={addDocEntry}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                + Добавить документ
              </button>
            </div>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {docEntries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <DocumentSearchPicker
                      selected={entry.selected}
                      onSelect={(v) => updateDocEntry(idx, "selected", v)}
                      onRemove={() => updateDocEntry(idx, "selected", null)}
                    />
                  </div>
                  <select
                    value={entry.role}
                    onChange={(e) => updateDocEntry(idx, "role", e.target.value)}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                  >
                    <option value="primary">Основной</option>
                    <option value="reference">Справочный</option>
                    <option value="comparator">Сравнительный</option>
                  </select>
                  {docEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDocEntry(idx)}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {createMutation.error && (
            <p className="text-sm text-red-600">{createMutation.error.message}</p>
          )}

          {/* Actions */}
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
              disabled={isLoading || !name.trim()}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Создание...
                </span>
              ) : (
                "Создать образец"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════ Batch Import Modal ═══════════════ */

function BatchImportModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [jsonInput, setJsonInput] = useState(
    JSON.stringify(
      [
        {
          name: "Sample 1",
          documentVersionIds: [],
          documentTypes: [],
          sampleType: "single_document",
        },
      ],
      null,
      2,
    ),
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const batchMutation = trpc.goldenDataset.batchImport.useMutation({
    onSuccess: () => {
      utils.goldenDataset.listSamples.invalidate();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParseError(null);
    try {
      const items = JSON.parse(jsonInput);
      if (!Array.isArray(items)) {
        setParseError("Входные данные должны быть JSON-массивом");
        return;
      }
      batchMutation.mutate({ items });
    } catch {
      setParseError("Некорректный JSON");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Пакетный импорт</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-gray-500">
            Вставьте JSON-массив образцов. Каждый элемент должен содержать: name, documentVersionIds, documentTypes,
            sampleType.
          </p>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />

          {(parseError || batchMutation.error) && (
            <p className="text-sm text-red-600">{parseError ?? batchMutation.error?.message}</p>
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
              disabled={batchMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {batchMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Импорт...
                </span>
              ) : (
                "Импортировать"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════ Stage Status Dots ═══════════════ */

function StageDots({
  stageStatuses,
}: {
  stageStatuses: Array<{ stage: string; status: string }>;
}) {
  const statusMap = new Map(stageStatuses.map((s) => [s.stage, s.status]));

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage) => {
        const status = statusMap.get(stage);
        const color = status ? (STATUS_COLORS[status] ?? "bg-gray-200") : "bg-gray-200";
        return (
          <span
            key={stage}
            title={`${STAGE_LABELS[stage]}: ${status ?? "не задан"}`}
            className={`inline-block h-2.5 w-2.5 rounded-full ${color}`}
          />
        );
      })}
    </div>
  );
}

/* ═══════════════ Type Badge ═══════════════ */

function TypeBadge({ type }: { type: string }) {
  const isSingle = type === "single_document";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isSingle
          ? "bg-blue-50 text-blue-700"
          : "bg-purple-50 text-purple-700"
      }`}
    >
      {isSingle ? "Одиночный" : "Множественный"}
    </span>
  );
}

/* ═══════════════ Main Page ═══════════════ */

export default function GoldenDatasetPage() {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [showBatch, setShowBatch] = useState(false);

  const [filterType, setFilterType] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const samplesQuery = trpc.goldenDataset.listSamples.useQuery({
    sampleType: filterType || undefined,
    stage: filterStage || undefined,
    stageStatus: filterStatus || undefined,
  } as { sampleType?: "single_document" | "multi_document"; stage?: string; stageStatus?: "draft" | "in_review" | "approved" });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Эталонный набор</h1>
          <p className="mt-1 text-sm text-gray-500">
            Управление эталонными образцами для оценки пайплайна и бенчмаркинга качества.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowBatch(true)}
            className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Upload size={16} />
            Пакетный импорт
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus size={16} />
            Создать образец
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Search size={16} />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {SAMPLE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {(filterType || filterStage || filterStatus) && (
          <button
            onClick={() => {
              setFilterType("");
              setFilterStage("");
              setFilterStatus("");
            }}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Сбросить фильтры
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {samplesQuery.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}

        {samplesQuery.error && (
          <div className="flex items-center justify-center gap-2 py-16 text-red-500">
            <AlertCircle size={20} />
            <span className="text-sm">{samplesQuery.error.message}</span>
          </div>
        )}

        {samplesQuery.data && samplesQuery.data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Database size={32} className="mb-2" />
            <p className="text-sm">Эталонные образцы не найдены.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-sm text-brand-600 hover:text-brand-700"
            >
              Создайте первый образец
            </button>
          </div>
        )}

        {samplesQuery.data && samplesQuery.data.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Этапы</th>
                <th className="px-4 py-3 text-center">Док.</th>
                <th className="px-4 py-3">Создано</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {samplesQuery.data.map((sample) => (
                <tr
                  key={sample.id}
                  onClick={() => router.push(`/golden-dataset/${sample.id}`)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">
                        {sample.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={sample.sampleType} />
                  </td>
                  <td className="px-4 py-3">
                    <StageDots stageStatuses={sample.stageStatuses} />
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600">
                    {sample._count.documents}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {new Date(sample.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showCreate && <CreateSampleModal onClose={() => setShowCreate(false)} />}
      {showBatch && <BatchImportModal onClose={() => setShowBatch(false)} />}
    </div>
  );
}
