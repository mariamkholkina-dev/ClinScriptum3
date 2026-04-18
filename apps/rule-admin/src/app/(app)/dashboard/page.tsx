"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Database,
  FlaskConical,
  ShieldCheck,
  PenLine,
  Loader2,
  Play,
  Upload,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
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

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

const TYPE_LABEL: Record<string, string> = {
  single: "Одиночный",
  batch: "Пакетный",
  llm_comparison: "Сравнение LLM",
  context_window_test: "Тест контекста",
};

/* ─── stat card ─── */

function StatCard({
  label,
  value,
  icon,
  color,
  loading,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`rounded-lg p-3 ${color}`}>{icon}</div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          {loading ? (
            <Loader2 size={20} className="mt-1 animate-spin text-gray-400" />
          ) : (
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── page ─── */

export default function DashboardPage() {
  const goldenSamples = trpc.goldenDataset.listSamples.useQuery({});
  const evalRuns = trpc.evaluation.listRuns.useQuery({});
  const pendingApprovals = trpc.quality.getPendingApprovalCount.useQuery();
  const unprocessedCorrections = trpc.quality.listCorrections.useQuery({
    isProcessed: false,
  });

  const recentRuns = (evalRuns.data ?? []).slice(0, 5);

  const stats = [
    {
      label: "Эталонные образцы",
      value: goldenSamples.data?.length ?? 0,
      icon: <Database size={24} />,
      color: "text-blue-600 bg-blue-50",
      loading: goldenSamples.isLoading,
    },
    {
      label: "Запуски оценки",
      value: evalRuns.data?.length ?? 0,
      icon: <FlaskConical size={24} />,
      color: "text-green-600 bg-green-50",
      loading: evalRuns.isLoading,
    },
    {
      label: "Ожидают согласования",
      value: (pendingApprovals.data as number) ?? 0,
      icon: <ShieldCheck size={24} />,
      color: "text-amber-600 bg-amber-50",
      loading: pendingApprovals.isLoading,
    },
    {
      label: "Необработанные корректировки",
      value: unprocessedCorrections.data?.length ?? 0,
      icon: <PenLine size={24} />,
      color: "text-red-600 bg-red-50",
      loading: unprocessedCorrections.isLoading,
    },
  ];

  const anyError =
    goldenSamples.isError ||
    evalRuns.isError ||
    pendingApprovals.isError ||
    unprocessedCorrections.isError;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Панель качества</h1>

      {anyError && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={16} />
          <span>Часть данных не удалось загрузить. Показаны частичные результаты.</span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      {/* Quick actions */}
      <div className="mt-8 flex gap-4">
        <Link
          href="/evaluation"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Play size={16} />
          Запустить оценку
        </Link>
        <Link
          href="/golden-dataset"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Upload size={16} />
          Загрузить эталонный образец
        </Link>
      </div>

      {/* Recent evaluation runs */}
      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Последние запуски оценки</h2>
        {evalRuns.isLoading ? (
          <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        ) : recentRuns.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
            Запусков оценки пока нет. Начните первый, чтобы увидеть результаты.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Название</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Тип</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Статус</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Метрики</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Дата</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentRuns.map((run) => {
                  const metrics = run.metrics as Record<string, unknown> | null;
                  const f1 =
                    metrics && typeof metrics === "object" && "avgF1" in metrics
                      ? (metrics.avgF1 as number)
                      : null;

                  return (
                    <tr
                      key={run.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        window.location.href = `/evaluation/${run.id}`;
                      }}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {run.name ?? `Запуск ${run.id.slice(0, 8)}`}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
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
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {f1 != null ? `F1: ${(f1 * 100).toFixed(1)}%` : "--"}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(run.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
