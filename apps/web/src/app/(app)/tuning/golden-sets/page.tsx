"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Award,
  Play,
  Loader2,
  FileCheck,
  FileText,
  Table2,
  Trash2,
  CheckCircle2,
  XCircle,
  BarChart3,
  Sparkles,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  section_classification: "Секции",
  fact_extraction: "Факты",
  soa_detection: "SOA",
  icf_generation: "Генерация ICF",
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  section_classification: FileCheck,
  fact_extraction: FileText,
  soa_detection: Table2,
  icf_generation: Sparkles,
};

export default function GoldenSetsPage() {
  const [selectedType, setSelectedType] = useState<string>("section_classification");
  const [regressionResult, setRegressionResult] = useState<any>(null);
  const [runningRegression, setRunningRegression] = useState(false);

  const goldenSetsQuery = trpc.tuning.listGoldenSets.useQuery({});
  const toggleMutation = trpc.tuning.toggleGoldenSet.useMutation({
    onSuccess: () => goldenSetsQuery.refetch(),
  });
  const regressionMutation = trpc.tuning.runRegression.useMutation({
    onSuccess: (data) => {
      setRegressionResult(data);
      setRunningRegression(false);
    },
    onError: () => setRunningRegression(false),
  });

  const goldenSets = goldenSetsQuery.data ?? [];

  const groupedByType = {
    section_classification: goldenSets.filter((s: any) => s.type === "section_classification"),
    fact_extraction: goldenSets.filter((s: any) => s.type === "fact_extraction"),
    soa_detection: goldenSets.filter((s: any) => s.type === "soa_detection"),
    icf_generation: goldenSets.filter((s: any) => s.type === "icf_generation"),
  };

  function handleRunRegression() {
    setRunningRegression(true);
    setRegressionResult(null);
    regressionMutation.mutate({ type: selectedType as any });
  }

  function getSessionUrl(session: any) {
    const typeMap: Record<string, string> = {
      section_classification: "sections",
      fact_extraction: "facts",
      soa_detection: "soa",
      icf_generation: "generation",
    };
    return `/tuning/${typeMap[session.type]}/${session.id}`;
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <Link
          href="/tuning"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3 flex-1">
          <Award className="h-7 w-7 text-yellow-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Золотые наборы</h1>
            <p className="text-sm text-gray-500">
              Эталонные сессии для регрессионного тестирования
            </p>
          </div>
        </div>
      </div>

      {/* Regression runner */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-brand-600" />
          Регрессионное тестирование
        </h2>
        <div className="flex items-center gap-4">
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setRegressionResult(null);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="section_classification">Классификация секций</option>
            <option value="fact_extraction">Извлечение фактов</option>
            <option value="soa_detection">Определение SOA</option>
            <option value="icf_generation">Генерация ICF</option>
          </select>
          <button
            onClick={handleRunRegression}
            disabled={runningRegression}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {runningRegression ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Запустить регрессию
          </button>
          <div className="text-sm text-gray-500">
            {groupedByType[selectedType as keyof typeof groupedByType]?.length ?? 0} золотых наборов
          </div>
        </div>

        {regressionMutation.error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {regressionMutation.error.message}
          </div>
        )}

        {/* Regression results */}
        {regressionResult && (
          <div className="mt-6">
            <div className="mb-4 grid grid-cols-4 gap-4">
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {regressionResult.goldenSetCount}
                </div>
                <div className="text-xs text-gray-500">Золотых наборов</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {regressionResult.totalItems}
                </div>
                <div className="text-xs text-gray-500">Элементов</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  {regressionResult.totalMatches}
                </div>
                <div className="text-xs text-gray-500">Совпадений</div>
              </div>
              <div className="rounded-lg bg-gray-50 p-4 text-center">
                <div
                  className={`text-2xl font-bold ${
                    regressionResult.overallAccuracy >= 0.9
                      ? "text-green-600"
                      : regressionResult.overallAccuracy >= 0.7
                      ? "text-yellow-600"
                      : "text-red-600"
                  }`}
                >
                  {(regressionResult.overallAccuracy * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500">Точность</div>
              </div>
            </div>

            {/* Per-session breakdown */}
            {regressionResult.sessions.map((s: any) => (
              <div
                key={s.sessionId}
                className="mb-3 rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-900">
                    Сессия {s.sessionId.slice(0, 8)}...
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        s.accuracy >= 0.9
                          ? "bg-green-100 text-green-700"
                          : s.accuracy >= 0.7
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {(s.accuracy * 100).toFixed(1)}%
                    </span>
                    <span className="text-xs text-gray-500">
                      {s.matches}/{s.totalItems}
                    </span>
                  </div>
                </div>

                {s.details.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      Несовпадения:
                    </div>
                    <div className="space-y-1">
                      {s.details.slice(0, 10).map((d: any, i: number) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 text-xs bg-red-50 rounded px-2 py-1"
                        >
                          <span className="font-mono text-gray-600 truncate w-24">
                            {d.itemId.slice(0, 12)}
                          </span>
                          <span className="flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            {d.expected}
                          </span>
                          <span className="text-gray-400">→</span>
                          <span className="flex items-center gap-1 text-red-700">
                            <XCircle className="h-3 w-3" />
                            {d.current}
                          </span>
                        </div>
                      ))}
                      {s.details.length > 10 && (
                        <div className="text-xs text-gray-500 pl-2">
                          ...и ещё {s.details.length - 10} несовпадений
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Golden sets list by type */}
      {(Object.entries(groupedByType) as [string, any[]][]).map(([type, sessions]) => {
        if (sessions.length === 0) return null;
        const Icon = TYPE_ICONS[type] ?? FileText;

        return (
          <div key={type} className="mb-6">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Icon className="h-4 w-4" />
              {TYPE_LABELS[type]}
              <span className="text-gray-400 font-normal">({sessions.length})</span>
            </h3>
            <div className="space-y-2">
              {sessions.map((session: any) => (
                <div
                  key={session.id}
                  className="flex items-center gap-4 rounded-lg border border-yellow-200 bg-yellow-50/50 p-3"
                >
                  <Award className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                  <Link
                    href={getSessionUrl(session)}
                    className="flex-1 min-w-0 hover:underline"
                  >
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {session.docVersion?.document?.title ?? "—"}
                    </div>
                    <div className="text-xs text-gray-500">
                      {session.docVersion?.versionLabel ??
                        `v${session.docVersion?.versionNumber}`}{" "}
                      | {new Date(session.createdAt).toLocaleDateString("ru-RU")}
                    </div>
                  </Link>
                  <div className="text-xs text-gray-500">
                    {session.stats && typeof session.stats === "object"
                      ? `${(session.stats as any).reviewed ?? 0}/${(session.stats as any).total ?? 0}`
                      : "—"}
                  </div>
                  <button
                    onClick={() => toggleMutation.mutate({ sessionId: session.id })}
                    disabled={toggleMutation.isPending}
                    className="rounded p-1 text-gray-400 hover:bg-yellow-100 hover:text-red-500"
                    title="Убрать из золотого набора"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {goldenSets.length === 0 && !goldenSetsQuery.isLoading && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-16 text-center">
          <Award className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">Нет золотых наборов</p>
          <p className="mt-1 text-sm text-gray-400">
            Завершите сессию тюнинга и отметьте её как золотой набор
          </p>
        </div>
      )}
    </div>
  );
}
