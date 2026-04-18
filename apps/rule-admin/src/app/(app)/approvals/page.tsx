"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  ShieldCheck,
  Clock,
  CheckCircle,
  XCircle,
  Filter,
  Loader2,
  ArrowLeft,
  History,
  ChevronRight,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "pending", label: "Ожидание" },
  { value: "approved", label: "Утверждено" },
  { value: "rejected", label: "Отклонено" },
];

const TYPE_OPTIONS = [
  { value: "", label: "Все типы" },
  { value: "rule_activation", label: "Активация правила" },
  { value: "llm_config_change", label: "Изменение конфигурации LLM" },
  { value: "golden_dataset_approval", label: "Золотой набор данных" },
];

const STATUS_BADGE: Record<string, { color: string; icon: typeof Clock }> = {
  pending: { color: "bg-amber-100 text-amber-700", icon: Clock },
  approved: { color: "bg-green-100 text-green-700", icon: CheckCircle },
  rejected: { color: "bg-red-100 text-red-700", icon: XCircle },
};

/* ═══════════════ Component ═══════════════ */

export default function ApprovalsPage() {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");

  const utils = trpc.useUtils();

  const pendingCountQuery = trpc.quality.getPendingApprovalCount.useQuery();

  const listQuery = trpc.quality.listApprovalRequests.useQuery({
    status: tab === "pending" ? "pending" : (statusFilter || undefined) as any,
    type: (typeFilter || undefined) as any,
  });

  const detailQuery = trpc.quality.getApprovalRequest.useQuery(
    { id: selectedId! },
    { enabled: !!selectedId },
  );

  const reviewMut = trpc.quality.reviewApprovalRequest.useMutation({
    onSuccess: () => {
      utils.quality.listApprovalRequests.invalidate();
      utils.quality.getPendingApprovalCount.invalidate();
      utils.quality.getApprovalRequest.invalidate();
      setSelectedId(null);
      setReviewComment("");
    },
  });

  const handleReview = useCallback(
    (status: "approved" | "rejected") => {
      if (!selectedId) return;
      reviewMut.mutate({
        id: selectedId,
        status,
        comment: reviewComment || undefined,
      });
    },
    [selectedId, reviewComment, reviewMut],
  );

  /* ═══════════════ Detail View ═══════════════ */

  if (selectedId) {
    return (
      <div>
        <button
          onClick={() => { setSelectedId(null); setReviewComment(""); }}
          className="mb-4 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={14} /> Назад к списку
        </button>

        {detailQuery.isLoading && (
          <div className="flex items-center justify-center p-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}

        {detailQuery.isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Не удалось загрузить запрос на согласование.
          </div>
        )}

        {detailQuery.data && (() => {
          const req = detailQuery.data as any;
          const badge = STATUS_BADGE[req.status] ?? STATUS_BADGE.pending;
          const BadgeIcon = badge.icon;

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">{req.title}</h1>
                    <p className="mt-1 text-sm text-gray-500">{req.description}</p>
                  </div>
                  <span className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${badge.color}`}>
                    <BadgeIcon size={12} /> {req.status}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
                  <div>
                    <span className="font-medium text-gray-700">Тип: </span>
                    {req.type}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Запросил: </span>
                    {req.requestedBy?.name ?? "Неизвестно"}
                  </div>
                  <div>
                    <span className="font-medium text-gray-700">Дата: </span>
                    {new Date(req.requestedAt).toLocaleString()}
                  </div>
                  {req.reviewedBy && (
                    <div>
                      <span className="font-medium text-gray-700">Проверил: </span>
                      {req.reviewedBy.name}
                    </div>
                  )}
                </div>
              </div>

              {/* Entity Info */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">Информация о сущности</h2>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-xs text-gray-500">Тип сущности</span>
                    <div className="font-medium text-gray-700">{req.entityType}</div>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">ID сущности</span>
                    <div className="font-mono text-xs text-gray-600">{req.entityId}</div>
                  </div>
                </div>
              </div>

              {/* Context */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">Контекст</h2>
                <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-4 font-mono text-xs text-gray-700 whitespace-pre-wrap">
                  {JSON.stringify(req.context, null, 2)}
                </pre>
              </div>

              {/* Review Comment */}
              {req.comment && (
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-2 text-sm font-semibold text-gray-900">Комментарий проверки</h2>
                  <p className="text-sm text-gray-700">{req.comment}</p>
                </div>
              )}

              {/* Actions */}
              {req.status === "pending" && (
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-3 text-sm font-semibold text-gray-900">Проверка</h2>
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-gray-700">Комментарий (необязательно)</label>
                    <textarea
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      placeholder="Добавьте комментарий..."
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleReview("approved")}
                      disabled={reviewMut.isPending}
                      className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {reviewMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      Утвердить
                    </button>
                    <button
                      onClick={() => handleReview("rejected")}
                      disabled={reviewMut.isPending}
                      className="flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {reviewMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                      Отклонить
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  /* ═══════════════ List View ═══════════════ */

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Согласования</h1>
        <p className="mt-1 text-sm text-gray-500">Проверка и утверждение ожидающих изменений правил и промптов.</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => setTab("pending")}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === "pending" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <ShieldCheck size={14} /> Ожидание
            {pendingCountQuery.data != null && pendingCountQuery.data > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {pendingCountQuery.data}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === "history" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <History size={14} /> История
          </button>
        </div>

        {/* Filters (history only) */}
        {tab === "history" && (
          <div className="flex items-center gap-3">
            <Filter size={14} className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {TYPE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {listQuery.isLoading && (
          <div className="flex items-center justify-center p-12">
            <Loader2 size={24} className="animate-spin text-gray-400" />
          </div>
        )}
        {listQuery.isError && (
          <div className="p-4 text-sm text-red-600">Не удалось загрузить запросы на согласование.</div>
        )}
        {listQuery.data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Название</th>
                  <th className="px-4 py-3">Тип</th>
                  <th className="px-4 py-3">Запросил</th>
                  <th className="px-4 py-3">Дата</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(listQuery.data as any[]).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      {tab === "pending" ? "Нет ожидающих запросов на согласование." : "История согласований пуста."}
                    </td>
                  </tr>
                )}
                {(listQuery.data as any[]).map((req: any) => {
                  const badge = STATUS_BADGE[req.status] ?? STATUS_BADGE.pending;
                  const BadgeIcon = badge.icon;

                  return (
                    <tr
                      key={req.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setSelectedId(req.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{req.title}</div>
                        <div className="max-w-[300px] truncate text-xs text-gray-400">{req.description}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {req.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {req.requestedBy?.name ?? "Неизвестно"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                        {new Date(req.requestedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`flex w-fit items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${badge.color}`}>
                          <BadgeIcon size={10} /> {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <ChevronRight size={14} />
                      </td>
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
