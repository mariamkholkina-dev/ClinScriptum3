"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Filter,
  Loader2,
  X,
  CheckCircle,
  BarChart3,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const STAGE_OPTIONS = [
  { value: "", label: "Все этапы" },
  { value: "section_classification", label: "Классификация разделов" },
  { value: "fact_extraction", label: "Извлечение фактов" },
  { value: "contradiction_detection", label: "Обнаружение противоречий" },
  { value: "soa_detection", label: "Обнаружение SOA" },
];

const DOC_TYPE_OPTIONS = [
  { value: "", label: "Все типы" },
  { value: "protocol", label: "Протокол" },
  { value: "icf", label: "ICF" },
  { value: "ib", label: "IB" },
  { value: "csr", label: "CSR" },
];

/* ═══════════════ Component ═══════════════ */

export default function DisagreementsPage() {
  const [stageFilter, setStageFilter] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [resolution, setResolution] = useState<"algo" | "llm" | "custom">("algo");
  const [customValue, setCustomValue] = useState("");
  const [comment, setComment] = useState("");

  const utils = trpc.useUtils();

  const statsQuery = trpc.quality.getDisagreementStats.useQuery();

  const disagreementsQuery = trpc.quality.listDisagreements.useQuery({
    stage: (stageFilter || undefined) as any,
    documentType: (docTypeFilter || undefined) as any,
  });

  const resolveMut = trpc.quality.resolveDisagreement.useMutation({
    onSuccess: () => {
      utils.quality.listDisagreements.invalidate();
      utils.quality.getDisagreementStats.invalidate();
      setResolveTarget(null);
      setResolution("algo");
      setCustomValue("");
      setComment("");
    },
  });

  const handleResolve = useCallback(() => {
    if (!resolveTarget) return;
    resolveMut.mutate({
      entityId: resolveTarget.entityId,
      stage: resolveTarget.stage as any,
      resolution,
      customValue: resolution === "custom" ? customValue : undefined,
      comment: comment || undefined,
    });
  }, [resolveTarget, resolution, customValue, comment, resolveMut]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Расхождения</h1>
        <p className="mt-1 text-sm text-gray-500">
          Проверка случаев расхождения между детерминистическими и LLM-результатами.
        </p>
      </div>

      {/* Stats Cards */}
      {statsQuery.data && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2.5 text-amber-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Классификация</p>
                <p className="text-xl font-semibold text-gray-900">{statsQuery.data.classification.total}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-50 p-2.5 text-green-600">
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Классификация разрешена</p>
                <p className="text-xl font-semibold text-gray-900">{statsQuery.data.classification.resolved}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2.5 text-purple-600">
                <AlertTriangle size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Извлечение</p>
                <p className="text-xl font-semibold text-gray-900">{statsQuery.data.extraction.total}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2.5 text-blue-600">
                <BarChart3 size={20} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Процент классификации</p>
                <p className="text-xl font-semibold text-gray-900">
                  {(statsQuery.data.classification.resolutionRate * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {statsQuery.isLoading && (
        <div className="mb-6 flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" /> Загрузка статистики...
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <Filter size={14} className="text-gray-400" />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {STAGE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          {DOC_TYPE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Resolve Modal */}
      {resolveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Разрешить расхождение</h2>
              <button onClick={() => setResolveTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4 rounded-lg bg-gray-50 p-3 text-sm">
              <div className="mb-1 text-xs font-medium text-gray-500">Документ</div>
              <div className="text-gray-900">{resolveTarget.documentContext?.documentTitle}</div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-medium text-gray-500">Результат алгоритма</div>
                  <div className="mt-0.5 rounded bg-white px-2 py-1 font-mono text-xs">
                    {resolveTarget.algoResult ?? "-"}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    Уверенность: {(resolveTarget.algoConfidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-gray-500">Результат LLM</div>
                  <div className="mt-0.5 rounded bg-white px-2 py-1 font-mono text-xs">
                    {resolveTarget.llmResult ?? "-"}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-400">
                    Уверенность: {(resolveTarget.llmConfidence * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-4 space-y-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Решение</label>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                <input
                  type="radio"
                  name="resolution"
                  value="algo"
                  checked={resolution === "algo"}
                  onChange={() => setResolution("algo")}
                  className="text-brand-600"
                />
                Использовать результат алгоритма
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                <input
                  type="radio"
                  name="resolution"
                  value="llm"
                  checked={resolution === "llm"}
                  onChange={() => setResolution("llm")}
                  className="text-brand-600"
                />
                Использовать результат LLM
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">
                <input
                  type="radio"
                  name="resolution"
                  value="custom"
                  checked={resolution === "custom"}
                  onChange={() => setResolution("custom")}
                  className="text-brand-600"
                />
                Своё значение
              </label>
              {resolution === "custom" && (
                <input
                  type="text"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder="Введите своё значение..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">Комментарий (необязательно)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="Причина данного решения..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setResolveTarget(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                onClick={handleResolve}
                disabled={resolveMut.isPending || (resolution === "custom" && !customValue)}
                className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {resolveMut.isPending && <Loader2 size={14} className="animate-spin" />}
                Разрешить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disagreements Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {disagreementsQuery.isLoading && (
          <div className="flex items-center justify-center p-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}
        {disagreementsQuery.isError && (
          <div className="p-4 text-sm text-red-600">Не удалось загрузить расхождения.</div>
        )}
        {disagreementsQuery.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Документ</th>
                  <th className="px-4 py-3">Этап</th>
                  <th className="px-4 py-3">Результат алгоритма</th>
                  <th className="px-4 py-3">Результат LLM</th>
                  <th className="px-4 py-3">Уверенность алг.</th>
                  <th className="px-4 py-3">Уверенность LLM</th>
                  <th className="px-4 py-3">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(disagreementsQuery.data as any[]).length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                      Расхождения не найдены.
                    </td>
                  </tr>
                )}
                {(disagreementsQuery.data as any[]).map((d: any) => (
                  <tr key={`${d.entityId}-${d.stage}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {d.documentContext?.documentTitle ?? "Неизвестно"}
                      </div>
                      <div className="text-xs text-gray-400">
                        {d.documentContext?.documentType} / {d.documentContext?.versionLabel}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {d.stage}
                      </span>
                    </td>
                    <td className="max-w-[150px] truncate px-4 py-3 font-mono text-xs text-gray-700">
                      {d.algoResult ?? "-"}
                    </td>
                    <td className="max-w-[150px] truncate px-4 py-3 font-mono text-xs text-gray-700">
                      {d.llmResult ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block min-w-[40px] rounded px-1.5 py-0.5 text-xs font-medium ${
                        d.algoConfidence >= 0.8 ? "bg-green-100 text-green-700" : d.algoConfidence >= 0.5 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                      }`}>
                        {(d.algoConfidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block min-w-[40px] rounded px-1.5 py-0.5 text-xs font-medium ${
                        d.llmConfidence >= 0.8 ? "bg-green-100 text-green-700" : d.llmConfidence >= 0.5 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                      }`}>
                        {(d.llmConfidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          setResolveTarget(d);
                          setResolution("algo");
                          setCustomValue("");
                          setComment("");
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Разрешить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
