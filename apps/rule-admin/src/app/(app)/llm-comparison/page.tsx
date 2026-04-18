"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  GitCompare,
  ArrowUp,
  ArrowDown,
  Minus,
  Loader2,
  AlertCircle,
  ArrowLeft,
  Plus,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ─── helpers ─── */

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pct(v: number | null | undefined) {
  if (v == null) return "--";
  return `${(v * 100).toFixed(1)}%`;
}

function DeltaIndicator({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400">--</span>;
  const abs = Math.abs(value * 100).toFixed(1);
  if (value > 0.001) {
    return (
      <span className="inline-flex items-center gap-0.5 text-green-600">
        <ArrowUp size={14} />
        +{abs}%
      </span>
    );
  }
  if (value < -0.001) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600">
        <ArrowDown size={14} />
        -{abs}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-gray-500">
      <Minus size={14} />
      0%
    </span>
  );
}

function MetricBar({ value, maxValue = 1 }: { value: number | null; maxValue?: number }) {
  if (value == null) return <div className="h-4 w-full rounded bg-gray-100" />;
  const width = Math.min((value / maxValue) * 100, 100);
  let color = "bg-red-400";
  if (value > 0.8) color = "bg-green-500";
  else if (value > 0.6) color = "bg-yellow-400";

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-4 w-full rounded bg-gray-100">
        <div
          className={`absolute inset-y-0 left-0 rounded ${color}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="min-w-[40px] text-right text-xs font-mono text-gray-600">
        {pct(value)}
      </span>
    </div>
  );
}

/* ─── Pairwise Comparison ─── */

function PairwiseComparison({
  runId1,
  runId2,
}: {
  runId1: string;
  runId2: string;
}) {
  const comparison = trpc.evaluation.compareRuns.useQuery({ runId1, runId2 });

  if (comparison.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (comparison.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <AlertCircle size={16} />
        <span>{comparison.error.message}</span>
      </div>
    );
  }

  const data = comparison.data;
  if (!data) return null;

  const stages = Object.keys(data.delta);

  return (
    <div className="space-y-6">
      {/* Run headers */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-medium uppercase text-blue-600">Прогон 1</p>
          <p className="text-sm font-semibold text-gray-900">
            {data.run1.name ?? `Прогон ${data.run1.id.slice(0, 8)}`}
          </p>
          <p className="text-xs text-gray-500">{formatDate(data.run1.createdAt)}</p>
        </div>
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
          <p className="text-xs font-medium uppercase text-purple-600">Прогон 2</p>
          <p className="text-sm font-semibold text-gray-900">
            {data.run2.name ?? `Прогон ${data.run2.id.slice(0, 8)}`}
          </p>
          <p className="text-xs text-gray-500">{formatDate(data.run2.createdAt)}</p>
        </div>
      </div>

      {/* Stage-by-stage table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 font-medium text-gray-600">Этап</th>
              <th className="px-4 py-3 font-medium text-gray-600">Метрика</th>
              <th className="px-4 py-3 font-medium text-blue-600">Прогон 1</th>
              <th className="px-4 py-3 font-medium text-purple-600">Прогон 2</th>
              <th className="px-4 py-3 font-medium text-gray-600">Дельта</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {stages.map((stage) => {
              const d = data.delta[stage];
              const rows = [
                {
                  metric: "Точность",
                  v1: d.run1.avgPrecision,
                  v2: d.run2.avgPrecision,
                  delta: d.precisionDelta,
                },
                {
                  metric: "Полнота",
                  v1: d.run1.avgRecall,
                  v2: d.run2.avgRecall,
                  delta: d.recallDelta,
                },
                {
                  metric: "F1",
                  v1: d.run1.avgF1,
                  v2: d.run2.avgF1,
                  delta: d.f1Delta,
                },
                {
                  metric: "Процент прохождения",
                  v1: d.run1.passRate,
                  v2: d.run2.passRate,
                  delta: d.passRateDelta,
                },
              ];

              return rows.map((row, i) => (
                <tr key={`${stage}-${row.metric}`} className={i === 0 ? "border-t-2 border-gray-200" : ""}>
                  {i === 0 && (
                    <td
                      className="px-4 py-3 font-semibold text-gray-800"
                      rowSpan={rows.length}
                    >
                      {stage.replace(/_/g, " ")}
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-600">{row.metric}</td>
                  <td className="px-4 py-3">
                    <MetricBar value={row.v1} />
                  </td>
                  <td className="px-4 py-3">
                    <MetricBar value={row.v2} />
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">
                    <DeltaIndicator value={row.delta} />
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── page ─── */

export default function LlmComparisonPage() {
  const searchParams = useSearchParams();
  const initialRun1 = searchParams.get("run1") ?? "";
  const initialRun2 = searchParams.get("run2") ?? "";

  const [selectedRuns, setSelectedRuns] = useState<string[]>(
    [initialRun1, initialRun2].filter(Boolean),
  );
  const [addRunId, setAddRunId] = useState("");

  const allRuns = trpc.evaluation.listRuns.useQuery({});
  const completedRuns = (allRuns.data ?? []).filter((r) => r.status === "completed");

  // generate pairwise comparisons
  const pairs = useMemo(() => {
    const p: [string, string][] = [];
    for (let i = 0; i < selectedRuns.length; i++) {
      for (let j = i + 1; j < selectedRuns.length; j++) {
        p.push([selectedRuns[i], selectedRuns[j]]);
      }
    }
    return p;
  }, [selectedRuns]);

  const addRun = () => {
    if (addRunId && !selectedRuns.includes(addRunId) && selectedRuns.length < 3) {
      setSelectedRuns([...selectedRuns, addRunId]);
      setAddRunId("");
    }
  };

  const removeRun = (id: string) => {
    setSelectedRuns(selectedRuns.filter((r) => r !== id));
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Сравнение LLM</h1>
        <p className="mt-1 text-sm text-gray-500">
          Сравнение метрик между прогонами оценки.
        </p>
      </div>

      {/* Run selector */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-700">
          Выбранные прогоны ({selectedRuns.length}/3)
        </h2>

        {/* Selected chips */}
        <div className="mb-3 flex flex-wrap gap-2">
          {selectedRuns.map((id) => {
            const run = completedRuns.find((r) => r.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-50 px-3 py-1 text-sm"
              >
                {run?.name ?? `Прогон ${id.slice(0, 8)}`}
                <button
                  onClick={() => removeRun(id)}
                  className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              </span>
            );
          })}
        </div>

        {/* Add run */}
        {selectedRuns.length < 3 && (
          <div className="flex gap-2">
            <select
              value={addRunId}
              onChange={(e) => setAddRunId(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Выберите завершённый прогон...</option>
              {completedRuns
                .filter((r) => !selectedRuns.includes(r.id))
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? `Прогон ${r.id.slice(0, 8)}`} ({formatDate(r.createdAt)})
                  </option>
                ))}
            </select>
            <button
              onClick={addRun}
              disabled={!addRunId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Plus size={16} />
              Добавить
            </button>
          </div>
        )}
      </div>

      {/* Comparisons */}
      {selectedRuns.length < 2 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-16 text-center text-sm text-gray-500">
          Выберите минимум 2 завершённых прогона для сравнения.
        </div>
      ) : (
        <div className="space-y-8">
          {pairs.map(([id1, id2]) => {
            const run1 = completedRuns.find((r) => r.id === id1);
            const run2 = completedRuns.find((r) => r.id === id2);
            return (
              <div key={`${id1}-${id2}`}>
                {pairs.length > 1 && (
                  <h3 className="mb-3 text-sm font-semibold text-gray-600">
                    {run1?.name ?? `Прогон ${id1.slice(0, 8)}`} vs{" "}
                    {run2?.name ?? `Прогон ${id2.slice(0, 8)}`}
                  </h3>
                )}
                <PairwiseComparison runId1={id1} runId2={id2} />
              </div>
            );
          })}
        </div>
      )}

      {allRuns.isLoading && (
        <div className="mt-4 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-gray-400" />
        </div>
      )}
    </div>
  );
}
