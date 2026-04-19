"use client";

import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { Toggle } from "@/components/Toggle";
import { Badge } from "@/components/Badge";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Zap,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Search,
  ArrowUpDown,
} from "lucide-react";

/* ═══════════════ Task grouping ═══════════════ */

const TASK_STAGES: Record<string, string[]> = {
  "Классификация": ["section_classify", "section_classify_qa"],
  "Извлечение": ["fact_extraction", "fact_extraction_qa"],
  SOA: ["soa_detection", "soa_detection_qa"],
  "Аудит": [
    "intra_audit",
    "intra_audit_qa",
    "inter_audit",
    "inter_audit_qa",
    "fact_audit_intra",
    "fact_audit_intra_qa",
    "fact_audit_inter",
    "fact_audit_inter_qa",
  ],
  "Генерация": ["generation", "generation_qa"],
  "Влияние": ["impact_analysis", "impact_analysis_qa"],
  "Прочее": ["comparison", "summarization", "translation"],
};

function getTaskStage(taskId: string): string {
  for (const [stage, ids] of Object.entries(TASK_STAGES)) {
    if (ids.includes(taskId)) return stage;
  }
  return "Прочее";
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "azure_openai", label: "Azure OpenAI" },
  { value: "qwen", label: "Qwen" },
  { value: "yandexgpt", label: "YandexGPT" },
];

const CONTEXT_STRATEGIES = [
  { value: "chunk", label: "Чанк" },
  { value: "multi_chunk", label: "Мульти-чанк" },
  { value: "full_document", label: "Весь документ" },
  { value: "multi_document", label: "Несколько документов" },
];

/* ═══════════════ Toast ═══════════════ */

interface ToastData {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

let toastId = 0;

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const Icon = toast.type === "success" ? CheckCircle2 : toast.type === "error" ? XCircle : AlertCircle;
  const colors =
    toast.type === "success"
      ? "bg-green-50 text-green-800 border-green-200"
      : toast.type === "error"
        ? "bg-red-50 text-red-800 border-red-200"
        : "bg-blue-50 text-blue-800 border-blue-200";

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 shadow-md ${colors}`}>
      <Icon size={18} />
      <span className="text-sm">{toast.message}</span>
      <button onClick={onDismiss} className="ml-2 text-current opacity-60 hover:opacity-100">
        &times;
      </button>
    </div>
  );
}

/* ═══════════════ Form types ═══════════════ */

interface ConfigFormData {
  name: string;
  taskId: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxInputTokens: string;
  contextStrategy: string;
  chunkSizeChars: string;
  chunkOverlapChars: string;
  modelWindowChars: string;
  rateLimit: string;
  timeoutMs: string;
  coldStartMs: string;
  costPerInputKTokens: string;
  costPerOutputKTokens: string;
  isActive: boolean;
}

const EMPTY_FORM: ConfigFormData = {
  name: "",
  taskId: "",
  provider: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.1,
  maxOutputTokens: 2048,
  maxInputTokens: "",
  contextStrategy: "chunk",
  chunkSizeChars: "",
  chunkOverlapChars: "",
  modelWindowChars: "",
  rateLimit: "",
  timeoutMs: "",
  coldStartMs: "",
  costPerInputKTokens: "",
  costPerOutputKTokens: "",
  isActive: true,
};

/* ═══════════════ Helpers ═══════════════ */

function optionalInt(val: string): number | undefined {
  if (!val || val.trim() === "") return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

function optionalFloat(val: string): number | undefined {
  if (!val || val.trim() === "") return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

/* ═══════════════ Main page ═══════════════ */

export default function LlmConfigPage() {
  const [filterTask, setFilterTask] = useState("");
  const [filterProvider, setFilterProvider] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "active" | "inactive">("");
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "taskId" | "provider" | "model" | "isActive">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConfigFormData>(EMPTY_FORM);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [cloneSource, setCloneSource] = useState<NonNullable<(typeof configsQuery)["data"]>[number] | null>(null);
  const [cloneTargetTasks, setCloneTargetTasks] = useState<string[]>([]);
  const [cloning, setCloning] = useState(false);

  const utils = trpc.useUtils();

  // --- Queries ---
  const configsQuery = trpc.llmConfig.listConfigs.useQuery(
    { taskId: filterTask || undefined },
    { refetchOnWindowFocus: false },
  );
  const tasksQuery = trpc.llmConfig.listTasks.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // --- Mutations ---
  const createMut = trpc.llmConfig.createConfig.useMutation();

  const updateMut = trpc.llmConfig.updateConfig.useMutation({
    onSuccess: () => {
      utils.llmConfig.listConfigs.invalidate();
      setModalOpen(false);
      addToast("success", "Конфигурация обновлена");
    },
    onError: (err) => addToast("error", err.message),
  });

  const deleteMut = trpc.llmConfig.deleteConfig.useMutation({
    onSuccess: () => {
      utils.llmConfig.listConfigs.invalidate();
      setDeleteConfirmId(null);
      addToast("success", "Конфигурация удалена");
    },
    onError: (err) => addToast("error", err.message),
  });

  const setDefaultMut = trpc.llmConfig.setDefault.useMutation({
    onSuccess: () => {
      utils.llmConfig.listConfigs.invalidate();
      addToast("success", "Значение по умолчанию обновлено");
    },
    onError: (err) => addToast("error", err.message),
  });

  const testMut = trpc.llmConfig.testConnection.useMutation({
    onSuccess: (result) => {
      setTestingId(null);
      if (result.success) {
        addToast("success", `Соединение установлено (${result.latencyMs}мс)`);
      } else {
        addToast("error", `Ошибка соединения: ${result.error}`);
      }
    },
    onError: (err) => {
      setTestingId(null);
      addToast("error", err.message);
    },
  });

  // --- Toasts ---
  const addToast = useCallback((type: ToastData["type"], message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  // --- Grouped tasks for dropdowns ---
  const groupedTasks = useMemo(() => {
    const tasks = tasksQuery.data ?? [];
    const groups: Record<string, typeof tasks> = {};
    for (const stage of Object.keys(TASK_STAGES)) {
      groups[stage] = [];
    }
    for (const t of tasks) {
      const stage = getTaskStage(t.id);
      if (!groups[stage]) groups[stage] = [];
      groups[stage].push(t);
    }
    return groups;
  }, [tasksQuery.data]);

  // --- Sorted & filtered data ---
  const displayedConfigs = useMemo(() => {
    let list = configsQuery.data ?? [];

    if (filterProvider) list = list.filter((c) => c.provider === filterProvider);
    if (filterStatus === "active") list = list.filter((c) => c.isActive);
    if (filterStatus === "inactive") list = list.filter((c) => !c.isActive);
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.taskId.toLowerCase().includes(q) ||
          c.model.toLowerCase().includes(q),
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "taskId":
          return dir * a.taskId.localeCompare(b.taskId);
        case "provider":
          return dir * a.provider.localeCompare(b.provider);
        case "model":
          return dir * a.model.localeCompare(b.model);
        case "isActive":
          return dir * (Number(b.isActive) - Number(a.isActive));
        default:
          return 0;
      }
    });
  }, [configsQuery.data, filterProvider, filterStatus, searchText, sortKey, sortDir]);

  const toggleSort = useCallback((key: typeof sortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  // --- Clone handler ---
  const handleClone = useCallback(async () => {
    if (!cloneSource || cloneTargetTasks.length === 0) return;
    setCloning(true);
    let ok = 0;
    let fail = 0;
    for (const taskId of cloneTargetTasks) {
      try {
        await createMut.mutateAsync({
          name: `${cloneSource.name} (${taskId})`,
          taskId,
          provider: cloneSource.provider,
          baseUrl: cloneSource.baseUrl ?? undefined,
          apiKey: cloneSource.apiKey ?? undefined,
          model: cloneSource.model,
          temperature: cloneSource.temperature,
          maxOutputTokens: cloneSource.maxOutputTokens,
          maxInputTokens: cloneSource.maxInputTokens ?? undefined,
          contextStrategy: (cloneSource.contextStrategy as any) ?? undefined,
          chunkSizeChars: cloneSource.chunkSizeChars ?? undefined,
          chunkOverlapChars: cloneSource.chunkOverlapChars ?? undefined,
          modelWindowChars: cloneSource.modelWindowChars ?? undefined,
          rateLimit: cloneSource.rateLimit ?? undefined,
          timeoutMs: cloneSource.timeoutMs ?? undefined,
          coldStartMs: cloneSource.coldStartMs ?? undefined,
          costPerInputKTokens: cloneSource.costPerInputKTokens ?? undefined,
          costPerOutputKTokens: cloneSource.costPerOutputKTokens ?? undefined,
          isActive: cloneSource.isActive,
        });
        ok++;
      } catch {
        fail++;
      }
    }
    setCloning(false);
    setCloneSource(null);
    setCloneTargetTasks([]);
    utils.llmConfig.listConfigs.invalidate();
    if (ok > 0) addToast("success", `Клонировано на ${ok} задач${fail > 0 ? `, ошибок: ${fail}` : ""}`);
    else addToast("error", `Не удалось клонировать (${fail} ошибок)`);
  }, [cloneSource, cloneTargetTasks, createMut, utils, addToast]);

  // --- Handlers ---
  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback(
    (config: NonNullable<(typeof configsQuery.data)>[number]) => {
      setEditingId(config.id);
      setForm({
        name: config.name,
        taskId: config.taskId,
        provider: config.provider,
        baseUrl: config.baseUrl ?? "",
        apiKey: config.apiKey ?? "",
        model: config.model,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        maxInputTokens: config.maxInputTokens?.toString() ?? "",
        contextStrategy: config.contextStrategy ?? "chunk",
        chunkSizeChars: config.chunkSizeChars?.toString() ?? "",
        chunkOverlapChars: config.chunkOverlapChars?.toString() ?? "",
        modelWindowChars: config.modelWindowChars?.toString() ?? "",
        rateLimit: config.rateLimit?.toString() ?? "",
        timeoutMs: config.timeoutMs?.toString() ?? "",
        coldStartMs: config.coldStartMs?.toString() ?? "",
        costPerInputKTokens: config.costPerInputKTokens?.toString() ?? "",
        costPerOutputKTokens: config.costPerOutputKTokens?.toString() ?? "",
        isActive: config.isActive,
      });
      setModalOpen(true);
    },
    [],
  );

  const handleSubmit = useCallback(() => {
    const payload = {
      name: form.name,
      taskId: form.taskId,
      provider: form.provider,
      baseUrl: form.baseUrl || undefined,
      apiKey: form.apiKey || undefined,
      model: form.model,
      temperature: form.temperature,
      maxOutputTokens: form.maxOutputTokens,
      maxInputTokens: optionalInt(form.maxInputTokens),
      contextStrategy: form.contextStrategy as
        | "chunk"
        | "multi_chunk"
        | "full_document"
        | "multi_document"
        | undefined,
      chunkSizeChars: optionalInt(form.chunkSizeChars),
      chunkOverlapChars: optionalInt(form.chunkOverlapChars),
      modelWindowChars: optionalInt(form.modelWindowChars),
      rateLimit: optionalInt(form.rateLimit),
      timeoutMs: optionalInt(form.timeoutMs),
      coldStartMs: optionalInt(form.coldStartMs),
      costPerInputKTokens: optionalFloat(form.costPerInputKTokens),
      costPerOutputKTokens: optionalFloat(form.costPerOutputKTokens),
      isActive: form.isActive,
    };

    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload, {
        onSuccess: () => {
          utils.llmConfig.listConfigs.invalidate();
          setModalOpen(false);
          addToast("success", "Конфигурация создана");
        },
        onError: (err) => addToast("error", err.message),
      });
    }
  }, [form, editingId, createMut, updateMut, utils, addToast]);

  const handleTest = useCallback(
    (id: string) => {
      setTestingId(id);
      testMut.mutate({ id });
    },
    [testMut],
  );

  const setField = useCallback(
    <K extends keyof ConfigFormData>(key: K, value: ConfigFormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const showChunkFields =
    form.contextStrategy === "chunk" || form.contextStrategy === "multi_chunk";

  const isSaving = createMut.isPending || updateMut.isPending;

  // --- Render ---
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Настройка LLM</h1>
          <p className="mt-1 text-sm text-gray-500">
            Настройка провайдеров, моделей и параметров LLM для каждой задачи пайплайна.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          <Plus size={16} />
          Добавить конфигурацию
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Поиск..."
            className="rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="relative">
          <select
            value={filterTask}
            onChange={(e) => setFilterTask(e.target.value)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все задачи</option>
            {Object.entries(groupedTasks).map(([stage, tasks]) =>
              tasks.length > 0 ? (
                <optgroup key={stage} label={stage}>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
        <div className="relative">
          <select
            value={filterProvider}
            onChange={(e) => setFilterProvider(e.target.value)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все провайдеры</option>
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
        <div className="relative">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </div>
        {(searchText || filterTask || filterProvider || filterStatus) && (
          <button
            onClick={() => { setSearchText(""); setFilterTask(""); setFilterProvider(""); setFilterStatus(""); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            Сбросить
          </button>
        )}
      </div>

      {/* Count + sort info */}
      {configsQuery.data && configsQuery.data.length > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Показано {displayedConfigs.length} из {configsQuery.data.length} конфигураций
          </span>
          <span>Сортировка по заголовку колонки (клик для переключения)</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        {configsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
            <span className="ml-2 text-sm">Загрузка конфигураций...</span>
          </div>
        ) : configsQuery.isError ? (
          <div className="flex items-center justify-center py-16 text-red-500">
            <AlertCircle size={20} />
            <span className="ml-2 text-sm">
              Ошибка загрузки конфигураций: {configsQuery.error.message}
            </span>
          </div>
        ) : configsQuery.data && configsQuery.data.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            Конфигурации не найдены.{" "}
            <button onClick={openCreate} className="text-brand-600 hover:underline">
              Создать
            </button>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {([
                  ["name", "Название"],
                  ["taskId", "Задача"],
                  ["provider", "Провайдер"],
                  ["model", "Модель"],
                  ["isActive", "Статус"],
                ] as const).map(([key, label]) => (
                  <th
                    key={key}
                    onClick={() => toggleSort(key)}
                    className="cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sortKey === key ? (
                        sortDir === "asc" ? <ChevronUp size={14} className="text-brand-600" /> : <ChevronDown size={14} className="text-brand-600" />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-40" />
                      )}
                    </span>
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  По умолчанию
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayedConfigs.map((config) => (
                <tr key={config.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                    {config.name}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-900">{config.taskId}</span>
                      <span className="text-xs text-gray-400">{getTaskStage(config.taskId)}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                    {PROVIDERS.find((p) => p.value === config.provider)?.label ?? config.provider}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-600">
                    {config.model}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant={config.isActive ? "green" : "gray"}>
                      {config.isActive ? "Активна" : "Неактивна"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {config.isDefault ? (
                      <Star size={18} className="fill-yellow-400 text-yellow-400" />
                    ) : (
                      <Star size={18} className="text-gray-300" />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => openEdit(config)}
                        title="Редактировать"
                        className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => { setCloneSource(config); setCloneTargetTasks([]); }}
                        title="Клонировать на несколько задач"
                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Copy size={14} />
                        <span>Клон</span>
                      </button>
                      {!config.isDefault && (
                        <button
                          onClick={() => setDefaultMut.mutate({ id: config.id })}
                          title="Сделать по умолчанию"
                          className="rounded p-1.5 text-gray-400 hover:bg-yellow-50 hover:text-yellow-600"
                        >
                          <Star size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleTest(config.id)}
                        title="Проверить соединение"
                        disabled={testingId === config.id}
                        className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
                      >
                        {testingId === config.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Zap size={16} />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(config.id)}
                        title="Удалить"
                        className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Редактирование конфигурации" : "Новая конфигурация"}
        wide
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Название *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="напр. GPT-4o Классификация"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Task */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Задача *</label>
            <select
              value={form.taskId}
              onChange={(e) => setField("taskId", e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Выберите задачу...</option>
              {Object.entries(groupedTasks).map(([stage, tasks]) =>
                tasks.length > 0 ? (
                  <optgroup key={stage} label={stage}>
                    {tasks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id} - {t.description}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
          </div>

          {/* Provider */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Провайдер *</label>
            <select
              value={form.provider}
              onChange={(e) => setField("provider", e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Base URL */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Базовый URL</label>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(e) => setField("baseUrl", e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">API-ключ</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setField("apiKey", e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Model */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Модель *</label>
            <input
              type="text"
              value={form.model}
              onChange={(e) => setField("model", e.target.value)}
              placeholder="gpt-4o"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Temperature */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Температура ({form.temperature})
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) => setField("temperature", parseFloat(e.target.value))}
              className="w-full accent-brand-600"
            />
            <div className="mt-0.5 flex justify-between text-xs text-gray-400">
              <span>0</span>
              <span>2</span>
            </div>
          </div>

          {/* Max Output Tokens */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Макс. токенов на выходе</label>
            <input
              type="number"
              min={1}
              value={form.maxOutputTokens}
              onChange={(e) => setField("maxOutputTokens", parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Max Input Tokens */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Макс. токенов на входе <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.maxInputTokens}
              onChange={(e) => setField("maxInputTokens", e.target.value)}
              placeholder="e.g. 128000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Context Strategy */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Стратегия контекста</label>
            <select
              value={form.contextStrategy}
              onChange={(e) => setField("contextStrategy", e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {CONTEXT_STRATEGIES.map((cs) => (
                <option key={cs.value} value={cs.value}>
                  {cs.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model Window Chars */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Окно модели (символов) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.modelWindowChars}
              onChange={(e) => setField("modelWindowChars", e.target.value)}
              placeholder="e.g. 500000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Chunk fields (conditional) */}
          {showChunkFields && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Размер чанка (символов) <span className="text-gray-400">(необязательно)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.chunkSizeChars}
                  onChange={(e) => setField("chunkSizeChars", e.target.value)}
                  placeholder="e.g. 4000"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Перекрытие чанков (символов) <span className="text-gray-400">(необязательно)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.chunkOverlapChars}
                  onChange={(e) => setField("chunkOverlapChars", e.target.value)}
                  placeholder="e.g. 200"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </>
          )}

          {/* Divider - Performance & Cost */}
          <div className="col-span-2 mt-2 border-t border-gray-100 pt-2">
            <h3 className="text-sm font-medium text-gray-500">Производительность и стоимость</h3>
          </div>

          {/* Rate Limit */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Лимит запросов (запр/мин) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.rateLimit}
              onChange={(e) => setField("rateLimit", e.target.value)}
              placeholder="e.g. 60"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Timeout */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Таймаут (мс) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={1}
              value={form.timeoutMs}
              onChange={(e) => setField("timeoutMs", e.target.value)}
              placeholder="e.g. 30000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Cold Start */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Холодный старт (мс) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={0}
              value={form.coldStartMs}
              onChange={(e) => setField("coldStartMs", e.target.value)}
              placeholder="e.g. 5000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Cost per Input K Tokens */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Стоимость / 1K вх. токенов ($) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={0}
              step={0.001}
              value={form.costPerInputKTokens}
              onChange={(e) => setField("costPerInputKTokens", e.target.value)}
              placeholder="e.g. 0.005"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Cost per Output K Tokens */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Стоимость / 1K исх. токенов ($) <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="number"
              min={0}
              step={0.001}
              value={form.costPerOutputKTokens}
              onChange={(e) => setField("costPerOutputKTokens", e.target.value)}
              placeholder="e.g. 0.015"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Active toggle */}
          <div className="col-span-2">
            <Toggle
              checked={form.isActive}
              onChange={(val) => setField("isActive", val)}
              label="Активна"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={() => setModalOpen(false)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving || !form.name || !form.taskId || !form.model}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving && <Loader2 size={16} className="animate-spin" />}
            {editingId ? "Сохранить" : "Создать"}
          </button>
        </div>
      </Modal>

      {/* Clone Modal */}
      <Modal
        open={cloneSource !== null}
        onClose={() => setCloneSource(null)}
        title={`Клонировать «${cloneSource?.name ?? ""}»`}
        wide
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Провайдер: </span>
                <span className="font-medium">{PROVIDERS.find((p) => p.value === cloneSource?.provider)?.label ?? cloneSource?.provider}</span>
              </div>
              <div>
                <span className="text-gray-500">Модель: </span>
                <span className="font-medium font-mono">{cloneSource?.model}</span>
              </div>
              <div>
                <span className="text-gray-500">Температура: </span>
                <span className="font-medium">{cloneSource?.temperature}</span>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">
                Выберите задачи для клонирования ({cloneTargetTasks.length} выбрано)
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const all = (tasksQuery.data ?? [])
                      .filter((t) => t.id !== cloneSource?.taskId)
                      .map((t) => t.id);
                    setCloneTargetTasks(all);
                  }}
                  className="text-xs text-brand-600 hover:underline"
                >
                  Выбрать все
                </button>
                <button
                  onClick={() => setCloneTargetTasks([])}
                  className="text-xs text-gray-500 hover:underline"
                >
                  Сбросить
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
              {Object.entries(groupedTasks).map(([stage, tasks]) => {
                const available = tasks.filter((t) => t.id !== cloneSource?.taskId);
                if (available.length === 0) return null;
                const allSelected = available.every((t) => cloneTargetTasks.includes(t.id));
                return (
                  <div key={stage}>
                    <button
                      onClick={() => {
                        const ids = available.map((t) => t.id);
                        if (allSelected) {
                          setCloneTargetTasks((prev) => prev.filter((id) => !ids.includes(id)));
                        } else {
                          setCloneTargetTasks((prev) => [...new Set([...prev, ...ids])]);
                        }
                      }}
                      className="mb-0.5 mt-2 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs font-semibold uppercase text-gray-500 hover:bg-gray-50"
                    >
                      <input type="checkbox" checked={allSelected} readOnly className="accent-brand-600" />
                      {stage}
                    </button>
                    {available.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-4 py-1.5 text-sm hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={cloneTargetTasks.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCloneTargetTasks((prev) => [...prev, t.id]);
                            } else {
                              setCloneTargetTasks((prev) => prev.filter((id) => id !== t.id));
                            }
                          }}
                          className="accent-brand-600"
                        />
                        <span className="font-mono text-gray-700">{t.id}</span>
                        <span className="text-xs text-gray-400">{t.description}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={() => setCloneSource(null)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={handleClone}
            disabled={cloning || cloneTargetTasks.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cloning && <Loader2 size={16} className="animate-spin" />}
            Клонировать на {cloneTargetTasks.length} задач
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteConfirmId !== null}
        onClose={() => setDeleteConfirmId(null)}
        title="Удаление конфигурации"
      >
        <p className="text-sm text-gray-600">
          Вы уверены, что хотите удалить эту конфигурацию? Это действие нельзя отменить.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setDeleteConfirmId(null)}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={() => deleteConfirmId && deleteMut.mutate({ id: deleteConfirmId })}
            disabled={deleteMut.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
          >
            {deleteMut.isPending && <Loader2 size={16} className="animate-spin" />}
            Удалить
          </button>
        </div>
      </Modal>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </div>
  );
}
