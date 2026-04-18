"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  GitCompare,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ─── constants ─── */

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

const RESULT_STATUS_BADGE: Record<string, string> = {
  pass: "bg-green-100 text-green-700",
  fail: "bg-red-100 text-red-700",
  error: "bg-orange-100 text-orange-700",
  pending: "bg-gray-100 text-gray-700",
  skipped: "bg-gray-100 text-gray-500",
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

function f1Color(v: number | null) {
  if (v == null) return "text-gray-400";
  if (v > 0.8) return "text-green-600";
  if (v > 0.6) return "text-yellow-600";
  return "text-red-600";
}

function f1BgColor(v: number | null) {
  if (v == null) return "bg-gray-50 border-gray-200";
  if (v > 0.8) return "bg-green-50 border-green-200";
  if (v > 0.6) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}

function pct(v: number | null | undefined) {
  if (v == null) return "--";
  return `${(v * 100).toFixed(1)}%`;
}

/* ─── Compare Modal ─── */

function CompareModal({
  open,
  onClose,
  currentRunId,
}: {
  open: boolean;
  onClose: () => void;
  currentRunId: string;
}) {
  const router = useRouter();
  const [selectedRunId, setSelectedRunId] = useState("");
  const runs = trpc.evaluation.listRuns.useQuery({});

  if (!open) return null;

  const completedRuns = (runs.data ?? []).filter(
    (r) => r.id !== currentRunId && r.status === "completed",
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">Сравнить с другим прогоном</h3>
        <select
          value={selectedRunId}
          onChange={(e) => setSelectedRunId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Выберите прогон...</option>
          {completedRuns.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name ?? `Прогон ${r.id.slice(0, 8)}`} ({formatDate(r.createdAt)})
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            disabled={!selectedRunId}
            onClick={() => {
              router.push(
                `/llm-comparison?run1=${currentRunId}&run2=${selectedRunId}`,
              );
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <GitCompare size={16} />
            Сравнить
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Expandable Row ─── */

function ResultRow({
  result,
}: {
  result: {
    id: string;
    stage: string;
    status: string;
    goldenSample: { id: string; name: string; sampleType: string } | null;
    expected: unknown;
    actual: unknown;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {expanded ? (
              <ChevronDown size={14} className="text-gray-400" />
            ) : (
              <ChevronRight size={14} className="text-gray-400" />
            )}
            <span className="font-medium text-gray-900">
              {result.goldenSample?.name ?? "Неизвестный образец"}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-gray-600">{result.stage.replace(/_/g, " ")}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${RESULT_STATUS_BADGE[result.status] ?? "bg-gray-100 text-gray-700"}`}
          >
            {result.status === "pass" && <CheckCircle2 size={12} />}
            {result.status === "fail" && <XCircle size={12} />}
            {{ pass: "успех", fail: "неудача", error: "ошибка", pending: "ожидание", skipped: "пропущен" }[result.status] ?? result.status}
          </span>
        </td>
        <td className={`px-4 py-3 font-mono text-sm ${f1Color(result.precision)}`}>
          {pct(result.precision)}
        </td>
        <td className={`px-4 py-3 font-mono text-sm ${f1Color(result.recall)}`}>
          {pct(result.recall)}
        </td>
        <td className={`px-4 py-3 font-mono text-sm font-semibold ${f1Color(result.f1)}`}>
          {pct(result.f1)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50">
          <td colSpan={6} className="px-8 py-4">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">Ожидаемое</h4>
                <pre className="max-h-48 overflow-auto rounded border border-gray-200 bg-white p-3 text-xs text-gray-700">
                  {JSON.stringify(result.expected, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">Фактическое</h4>
                <pre className="max-h-48 overflow-auto rounded border border-gray-200 bg-white p-3 text-xs text-gray-700">
                  {JSON.stringify(result.actual, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── page ─── */

export default function EvaluationDetailPage() {
  const params = useParams();
  const runId = params.id as string;

  const [stageFilter, setStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);

  const run = trpc.evaluation.getRun.useQuery({ id: runId });
  const metrics = trpc.evaluation.getRunMetrics.useQuery({ evaluationRunId: runId });
  const results = trpc.evaluation.getRunResults.useQuery({
    evaluationRunId: runId,
    stage: stageFilter || undefined,
    status: statusFilter
      ? (statusFilter as "pending" | "pass" | "fail" | "error" | "skipped")
      : undefined,
  });

  if (run.isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 size={32} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (run.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <AlertCircle size={16} />
        <span>Не удалось загрузить прогон: {run.error.message}</span>
      </div>
    );
  }

  const data = run.data;
  if (!data) return null;

  const stageMetrics = metrics.data?.stages ?? {};
  const allStages = Object.keys(stageMetrics);

  return (
    <div>
      {/* Back link */}
      <Link
        href="/evaluation"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft size={16} />
        Назад к оценкам
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {data.name ?? `Прогон ${data.id.slice(0, 8)}`}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_BADGE[data.type] ?? "bg-gray-100 text-gray-700"}`}
              >
                {TYPE_LABEL[data.type] ?? data.type}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[data.status] ?? "bg-gray-100 text-gray-700"}`}
              >
                {data.status === "completed" && <CheckCircle2 size={12} />}
                {data.status === "failed" && <XCircle size={12} />}
                {data.status === "running" && <Loader2 size={12} className="animate-spin" />}
                {data.status === "queued" && <Clock size={12} />}
                {{ queued: "в очереди", running: "выполняется", completed: "завершён", failed: "ошибка" }[data.status] ?? data.status}
              </span>
              <span className="text-gray-500">Создан {formatDate(data.createdAt)}</span>
            </div>
          </div>
          <button
            onClick={() => setCompareOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <GitCompare size={16} />
            Сравнить
          </button>
        </div>

        {/* Summary stats */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Всего образцов</p>
            <p className="text-lg font-semibold text-gray-900">
              {data.totalSamples ?? metrics.data?.totalResults ?? "--"}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Процент прохождения</p>
            <p className="text-lg font-semibold text-gray-900">
              {metrics.data ? pct(metrics.data.overallPassRate) : "--"}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Стоимость</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatCost(data.cost as number | null)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Длительность</p>
            <p className="text-lg font-semibold text-gray-900">
              {formatDuration(data.durationMs as number | null)}
            </p>
          </div>
        </div>
      </div>

      {/* Stage metrics cards */}
      {allStages.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-gray-900">Метрики по этапам</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allStages.map((stage) => {
              const m = stageMetrics[stage];
              return (
                <div
                  key={stage}
                  className={`rounded-lg border p-4 ${f1BgColor(m.avgF1)}`}
                >
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    {stage.replace(/_/g, " ")}
                  </h3>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-xs text-gray-500">Точность</p>
                      <p className={`text-lg font-bold ${f1Color(m.avgPrecision)}`}>
                        {pct(m.avgPrecision)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Полнота</p>
                      <p className={`text-lg font-bold ${f1Color(m.avgRecall)}`}>
                        {pct(m.avgRecall)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">F1</p>
                      <p className={`text-lg font-bold ${f1Color(m.avgF1)}`}>
                        {pct(m.avgF1)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 text-center text-xs text-gray-500">
                    {m.passed}/{m.total} пройдено ({pct(m.passRate)})
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Results table */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Результаты</h2>
          <div className="flex gap-3">
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Все этапы</option>
              {allStages.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Все статусы</option>
              <option value="pass">Успех</option>
              <option value="fail">Неудача</option>
              <option value="error">Ошибка</option>
              <option value="pending">Ожидание</option>
              <option value="skipped">Пропущен</option>
            </select>
          </div>
        </div>

        {results.isLoading ? (
          <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : results.isError ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <AlertCircle size={16} />
            <span>{results.error.message}</span>
          </div>
        ) : (results.data ?? []).length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
            Результаты не найдены.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Образец</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Этап</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Статус</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Точность</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Полнота</th>
                  <th className="px-4 py-3 font-medium text-gray-600">F1</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(results.data ?? []).map((r) => (
                  <ResultRow key={r.id} result={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        currentRunId={runId}
      />
    </div>
  );
}
