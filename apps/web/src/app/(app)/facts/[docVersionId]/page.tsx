"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { ArrowLeft, AlertTriangle, Database, EyeOff, AlertCircle, FileX } from "lucide-react";

const statusLabels: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Проверен",
  validated: "Подтверждён",
  rejected: "Отклонён",
};

const LOW_CONFIDENCE_THRESHOLD = 0.5;

function confidenceColor(confidence: number) {
  if (confidence >= 0.8) return "text-green-700";
  if (confidence >= 0.6) return "text-amber-600";
  return "text-red-600";
}

export default function FactsPage() {
  const { docVersionId } = useParams<{ docVersionId: string }>();
  const factsQuery = trpc.processing.listFacts.useQuery({ docVersionId });
  const summaryQuery = trpc.processing.getFactExtractionSummary.useQuery({ docVersionId });
  const [showLowConfidence, setShowLowConfidence] = useState(false);

  const allFacts = factsQuery.data ?? [];

  const { visibleFacts, hiddenCount } = useMemo(() => {
    if (showLowConfidence) {
      return { visibleFacts: allFacts, hiddenCount: 0 };
    }
    const visible = allFacts.filter(
      (f) => (f.confidence ?? 0) >= LOW_CONFIDENCE_THRESHOLD || f.status === "validated",
    );
    return { visibleFacts: visible, hiddenCount: allFacts.length - visible.length };
  }, [allFacts, showLowConfidence]);

  const grouped = new Map<string, typeof factsQuery.data>();
  for (const fact of visibleFacts) {
    const list = grouped.get(fact.factClass) ?? [];
    list.push(fact);
    grouped.set(fact.factClass, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/documents" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Извлечённые факты</h1>
      </div>

      {factsQuery.isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {summaryQuery.data && summaryQuery.data.run && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Сводка извлечения</h3>
            <span className="text-xs text-gray-400">
              run {summaryQuery.data.run.id.slice(0, 8)} ·{" "}
              {new Date(summaryQuery.data.run.createdAt).toLocaleString("ru-RU")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded border border-gray-100 bg-gray-50 px-3 py-2">
              <div className="text-xs text-gray-500">Всего фактов</div>
              <div className="text-lg font-semibold text-gray-900">{summaryQuery.data.facts.total}</div>
            </div>
            <div className="rounded border border-green-100 bg-green-50 px-3 py-2">
              <div className="text-xs text-green-700">Высокая ≥80%</div>
              <div className="text-lg font-semibold text-green-700">{summaryQuery.data.facts.highConfidence}</div>
            </div>
            <div className="rounded border border-amber-100 bg-amber-50 px-3 py-2">
              <div className="text-xs text-amber-700">Средняя 50–80%</div>
              <div className="text-lg font-semibold text-amber-700">{summaryQuery.data.facts.midConfidence}</div>
            </div>
            <div className="rounded border border-red-100 bg-red-50 px-3 py-2">
              <div className="text-xs text-red-700">Низкая &lt;50%</div>
              <div className="text-lg font-semibold text-red-700">{summaryQuery.data.facts.lowConfidence}</div>
            </div>
          </div>
          {(summaryQuery.data.failures.parseErrors > 0 ||
            summaryQuery.data.failures.skippedSections > 0 ||
            summaryQuery.data.failures.stepFailures > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 text-xs">
              {summaryQuery.data.failures.parseErrors > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  LLM JSON parse errors: <span className="font-semibold">{summaryQuery.data.failures.parseErrors}</span>
                </span>
              )}
              {summaryQuery.data.failures.skippedSections > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <FileX className="h-3.5 w-3.5" />
                  Секций пропущено (превышен лимит): <span className="font-semibold">{summaryQuery.data.failures.skippedSections}</span>
                </span>
              )}
              {summaryQuery.data.failures.stepFailures > 0 && (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Шагов pipeline упало: <span className="font-semibold">{summaryQuery.data.failures.stepFailures}</span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!factsQuery.isLoading && allFacts.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <span className="font-medium text-gray-900">{visibleFacts.length}</span>
            <span>из {allFacts.length} фактов показаны</span>
            {hiddenCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                <EyeOff className="h-3.5 w-3.5" />
                скрыто {hiddenCount} с уверенностью &lt; {LOW_CONFIDENCE_THRESHOLD}
              </span>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-gray-600">
            <input
              type="checkbox"
              checked={showLowConfidence}
              onChange={(e) => setShowLowConfidence(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Показывать неуверенные
          </label>
        </div>
      )}

      {Array.from(grouped.entries()).map(([cls, facts]) => (
        <div key={cls} className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 capitalize">Факты: {cls}</h2>
          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Ключ</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Значение</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Уверенность</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Статус</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Противоречия</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {facts!.map((fact) => (
                  <tr key={fact.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{fact.factKey}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-sm truncate">{fact.value}</td>
                    <td
                      className={cn(
                        "px-4 py-3 font-mono text-xs tabular-nums",
                        confidenceColor(fact.confidence ?? 0),
                      )}
                    >
                      {((fact.confidence ?? 0) * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          fact.status === "validated" && "bg-green-100 text-green-700",
                          fact.status === "extracted" && "bg-gray-100 text-gray-600",
                          fact.status === "verified" && "bg-blue-100 text-blue-700",
                          fact.status === "rejected" && "bg-red-100 text-red-700"
                        )}
                      >
                        {statusLabels[fact.status] ?? fact.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {fact.hasContradiction && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Противоречие
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {allFacts.length === 0 && !factsQuery.isLoading && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <Database className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">Факты ещё не извлечены.</p>
        </div>
      )}

      {allFacts.length > 0 && visibleFacts.length === 0 && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <EyeOff className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            Все {allFacts.length} фактов имеют низкую уверенность. Включите
            «Показывать неуверенные», чтобы посмотреть.
          </p>
        </div>
      )}
    </div>
  );
}
