"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  FlaskConical,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ─── constants ─── */

const EVAL_TYPES = ["single", "batch", "llm_comparison", "context_window_test"] as const;
const EVAL_STATUSES = ["queued", "running", "completed", "failed"] as const;
const CONTEXT_STRATEGIES = ["chunk", "multi_chunk", "full_document", "multi_document"] as const;

type EvalType = (typeof EVAL_TYPES)[number];
type EvalStatus = (typeof EVAL_STATUSES)[number];

const TYPE_LABEL: Record<string, string> = {
  single: "Одиночный",
  batch: "Пакетный",
  llm_comparison: "Сравнение LLM",
  context_window_test: "Тест контекста",
};

const TYPE_BADGE: Record<string, string> = {
  single: "bg-blue-100 text-blue-700",
  batch: "bg-purple-100 text-purple-700",
  llm_comparison: "bg-amber-100 text-amber-700",
  context_window_test: "bg-teal-100 text-teal-700",
};

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function formatCost(c: number | null | undefined) {
  if (c == null) return "--";
  return `$${c.toFixed(4)}`;
}

/* ─── Create Modal ─── */

function CreateEvaluationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const pastRuns = trpc.evaluation.listRuns.useQuery({});

  const [name, setName] = useState("");
  const [type, setType] = useState<EvalType>("single");
  const [ruleSetVersionId, setRuleSetVersionId] = useState("");
  const [llmConfigId, setLlmConfigId] = useState("");
  const [contextStrategy, setContextStrategy] = useState("");
  const [comparedToRunId, setComparedToRunId] = useState("");

  const createMutation = trpc.evaluation.createRun.useMutation({
    onSuccess: (data) => {
      utils.evaluation.listRuns.invalidate();
      onClose();
      router.push(`/evaluation/${data.id}`);
    },
  });

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: name || undefined,
      type,
      ruleSetVersionId: ruleSetVersionId || undefined,
      llmConfigId: llmConfigId || undefined,
      contextStrategy: contextStrategy
        ? (contextStrategy as (typeof CONTEXT_STRATEGIES)[number])
        : undefined,
      comparedToRunId: comparedToRunId || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Новая оценка</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Название <span className="text-gray-400">(необязательно)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="например, регрессионный тест v2.1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Тип</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as EvalType)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {EVAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          {/* RuleSet Version */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Версия набора правил <span className="text-gray-400">(необязательно)</span>
            </label>
            <select
              value={ruleSetVersionId}
              onChange={(e) => setRuleSetVersionId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Последняя (по умолчанию)</option>
              {/* Placeholder: versions would be fetched via a separate query */}
            </select>
          </div>

          {/* LLM Config */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Конфигурация LLM <span className="text-gray-400">(необязательно)</span>
            </label>
            <select
              value={llmConfigId}
              onChange={(e) => setLlmConfigId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">По умолчанию</option>
              {/* Placeholder: configs would be fetched via a separate query */}
            </select>
          </div>

          {/* Context Strategy */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Стратегия контекста <span className="text-gray-400">(необязательно)</span>
            </label>
            <select
              value={contextStrategy}
              onChange={(e) => setContextStrategy(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Без переопределения</option>
              {CONTEXT_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          {/* Compare to previous run */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Сравнить с предыдущим прогоном <span className="text-gray-400">(необязательно)</span>
            </label>
            <select
              value={comparedToRunId}
              onChange={(e) => setComparedToRunId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Нет</option>
              {(pastRuns.data ?? [])
                .filter((r) => r.status === "completed")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? `Прогон ${r.id.slice(0, 8)}`} ({formatDate(r.createdAt)})
                  </option>
                ))}
            </select>
          </div>

          {createMutation.isError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle size={16} />
              <span>{createMutation.error.message}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
              Запустить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── page ─── */

export default function EvaluationPage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EvalType | "">("");
  const [statusFilter, setStatusFilter] = useState<EvalStatus | "">("");

  const runs = trpc.evaluation.listRuns.useQuery({
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Оценка качества</h1>
          <p className="mt-1 text-sm text-gray-500">Запуск и просмотр результатов оценки.</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Plus size={16} />
          Новая оценка
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as EvalType | "")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Все типы</option>
          {EVAL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EvalStatus | "")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Все статусы</option>
          {EVAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {{ queued: "В очереди", running: "Выполняется", completed: "Завершён", failed: "Ошибка" }[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      {runs.isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-16">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : runs.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <AlertCircle size={16} />
          <span>Не удалось загрузить прогоны: {runs.error.message}</span>
        </div>
      ) : (runs.data ?? []).length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-16 text-center text-sm text-gray-500">
          Прогоны оценки не найдены. Создайте новый, чтобы начать.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Название</th>
                <th className="px-4 py-3 font-medium text-gray-600">Тип</th>
                <th className="px-4 py-3 font-medium text-gray-600">Статус</th>
                <th className="px-4 py-3 font-medium text-gray-600">Метрики (F1)</th>
                <th className="px-4 py-3 font-medium text-gray-600">Стоимость</th>
                <th className="px-4 py-3 font-medium text-gray-600">Длительность</th>
                <th className="px-4 py-3 font-medium text-gray-600">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(runs.data ?? []).map((run) => {
                const metrics = run.metrics as Record<string, unknown> | null;
                const f1 =
                  metrics && typeof metrics === "object" && "avgF1" in metrics
                    ? (metrics.avgF1 as number)
                    : null;

                return (
                  <tr
                    key={run.id}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => router.push(`/evaluation/${run.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {run.name ?? `Прогон ${run.id.slice(0, 8)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE[run.type] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {TYPE_LABEL[run.type] ?? run.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[run.status] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {run.status === "completed" && <CheckCircle2 size={12} />}
                        {run.status === "failed" && <XCircle size={12} />}
                        {run.status === "running" && (
                          <Loader2 size={12} className="animate-spin" />
                        )}
                        {run.status === "queued" && <Clock size={12} />}
                        {{ queued: "в очереди", running: "выполняется", completed: "завершён", failed: "ошибка" }[run.status] ?? run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {f1 != null ? `${(f1 * 100).toFixed(1)}%` : "--"}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatCost(run.cost as number | null)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDuration(run.durationMs as number | null)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(run.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateEvaluationModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
