"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  PenLine,
  Lightbulb,
  Filter,
  Check,
  X,
  Loader2,
  ArrowRight,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const STAGES = [
  { value: "", label: "Все этапы" },
  { value: "section_classification", label: "Классификация разделов" },
  { value: "fact_extraction", label: "Извлечение фактов" },
  { value: "contradiction_detection", label: "Обнаружение противоречий" },
  { value: "soa_detection", label: "Обнаружение SOA" },
  { value: "icf_generation", label: "Генерация ICF" },
  { value: "csr_generation", label: "Генерация CSR" },
];

const REC_STATUSES = [
  { value: "", label: "Все статусы" },
  { value: "pending", label: "Ожидание" },
  { value: "accepted", label: "Принято" },
  { value: "rejected", label: "Отклонено" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  implemented: "bg-blue-100 text-blue-700",
};

/* ═══════════════ Component ═══════════════ */

export default function CorrectionsPage() {
  const [tab, setTab] = useState<"corrections" | "recommendations">("corrections");
  const [stageFilter, setStageFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const utils = trpc.useUtils();

  const correctionsQuery = trpc.quality.listCorrections.useQuery(
    { stage: (stageFilter || undefined) as any },
    { enabled: tab === "corrections" },
  );

  const recommendationsQuery = trpc.quality.listRecommendations.useQuery(
    {
      stage: (stageFilter || undefined) as any,
      status: (statusFilter || undefined) as any,
    },
    { enabled: tab === "recommendations" },
  );

  const reviewMut = trpc.quality.reviewRecommendation.useMutation({
    onSuccess: () => {
      utils.quality.listRecommendations.invalidate();
    },
  });

  const handleReview = useCallback(
    (id: string, status: "accepted" | "rejected") => {
      reviewMut.mutate({ id, status });
    },
    [reviewMut],
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Корректировки</h1>
        <p className="mt-1 text-sm text-gray-500">Обработка пользовательских корректировок и проверка автоматических рекомендаций.</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        <button
          onClick={() => setTab("corrections")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "corrections" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <PenLine size={14} /> Корректировки
        </button>
        <button
          onClick={() => setTab("recommendations")}
          className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "recommendations" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          <Lightbulb size={14} /> Рекомендации
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <Filter size={14} className="text-gray-400" />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {tab === "recommendations" && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {REC_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Corrections Tab */}
      {tab === "corrections" && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          {correctionsQuery.isLoading && (
            <div className="flex items-center justify-center p-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}
          {correctionsQuery.isError && (
            <div className="p-4 text-sm text-red-600">Не удалось загрузить корректировки.</div>
          )}
          {correctionsQuery.data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Пользователь</th>
                    <th className="px-4 py-3">Роль</th>
                    <th className="px-4 py-3">Этап</th>
                    <th className="px-4 py-3">Тип сущности</th>
                    <th className="px-4 py-3">Исходное</th>
                    <th className="px-4 py-3"></th>
                    <th className="px-4 py-3">Исправленное</th>
                    <th className="px-4 py-3">Дата</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(correctionsQuery.data as any[]).length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                        Корректировки не найдены.
                      </td>
                    </tr>
                  )}
                  {(correctionsQuery.data as any[]).map((c: any) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{c.user?.name ?? "Неизвестно"}</div>
                        <div className="text-xs text-gray-400">{c.user?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.userRole}</td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {c.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.entityType}</td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-600">
                        {typeof c.originalValue === "object" ? JSON.stringify(c.originalValue) : String(c.originalValue)}
                      </td>
                      <td className="px-2 py-3 text-gray-300">
                        <ArrowRight size={14} />
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-green-700">
                        {typeof c.correctedValue === "object" ? JSON.stringify(c.correctedValue) : String(c.correctedValue)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recommendations Tab */}
      {tab === "recommendations" && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          {recommendationsQuery.isLoading && (
            <div className="flex items-center justify-center p-12">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}
          {recommendationsQuery.isError && (
            <div className="p-4 text-sm text-red-600">Не удалось загрузить рекомендации.</div>
          )}
          {recommendationsQuery.data && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Паттерн</th>
                    <th className="px-4 py-3">Этап</th>
                    <th className="px-4 py-3">Частота</th>
                    <th className="px-4 py-3">Предложенное изменение</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Проверил</th>
                    <th className="px-4 py-3">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(recommendationsQuery.data as any[]).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                        Рекомендации не найдены.
                      </td>
                    </tr>
                  )}
                  {(recommendationsQuery.data as any[]).map((rec: any) => (
                    <tr key={rec.id} className="hover:bg-gray-50">
                      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-700">
                        {rec.pattern}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {rec.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-gray-900">{rec.frequency}</td>
                      <td className="max-w-[250px] truncate px-4 py-3 text-gray-600">{rec.suggestedChange}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[rec.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {rec.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {rec.reviewedBy?.name ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        {rec.status === "pending" && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleReview(rec.id, "accepted")}
                              disabled={reviewMut.isPending}
                              className="rounded p-1.5 text-green-600 hover:bg-green-50"
                              title="Принять"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => handleReview(rec.id, "rejected")}
                              disabled={reviewMut.isPending}
                              className="rounded p-1.5 text-red-600 hover:bg-red-50"
                              title="Отклонить"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
