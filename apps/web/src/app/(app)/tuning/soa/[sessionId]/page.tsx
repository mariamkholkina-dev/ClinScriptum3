"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Save,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  Table2,
} from "lucide-react";

export default function SoaTuningPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const sessionQuery = trpc.tuning.getSession.useQuery({ sessionId });
  const verdictsQuery = trpc.tuning.getSoaVerdicts.useQuery({ sessionId });
  const completeMutation = trpc.tuning.completeSession.useMutation({
    onSuccess: () => router.push("/tuning"),
  });

  const saveMutation = trpc.tuning.saveSoaVerdict.useMutation({
    onSuccess: () => verdictsQuery.refetch(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localChoices, setLocalChoices] = useState<
    Record<string, { isCorrect: boolean | null; comment: string }>
  >({});

  const session = sessionQuery.data;
  const verdicts = verdictsQuery.data ?? [];

  const reviewedCount = verdicts.filter((v: any) => v.reviewedAt).length;
  const totalCount = verdicts.length;

  function getLocal(verdict: any) {
    if (localChoices[verdict.id]) return localChoices[verdict.id];
    if (verdict.isCorrectDetection !== null) {
      return {
        isCorrect: verdict.isCorrectDetection,
        comment: verdict.comment ?? "",
      };
    }
    return null;
  }

  function setCorrect(verdictId: string, isCorrect: boolean) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        isCorrect,
        comment: prev[verdictId]?.comment ?? "",
      },
    }));
  }

  function setComment(verdictId: string, comment: string) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        isCorrect: prev[verdictId]?.isCorrect ?? null,
        comment,
      },
    }));
  }

  function handleSave(verdictId: string) {
    const local = localChoices[verdictId];
    if (!local || local.isCorrect === null) return;
    saveMutation.mutate({
      verdictId,
      isCorrectDetection: local.isCorrect,
      comment: local.comment || undefined,
    });
  }

  if (sessionQuery.isLoading || verdictsQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/tuning"
          className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            Тюнинг SOA: {session?.docVersion?.document?.title}
          </h1>
          <p className="text-sm text-gray-500">
            {session?.docVersion?.versionLabel ??
              `v${session?.docVersion?.versionNumber}`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-500">
            <span className="font-medium text-gray-900">{reviewedCount}</span> /{" "}
            {totalCount} проверено
          </div>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{
                width: `${totalCount > 0 ? (reviewedCount / totalCount) * 100 : 0}%`,
              }}
            />
          </div>
          {reviewedCount === totalCount && totalCount > 0 && (
            <button
              onClick={() => completeMutation.mutate({ sessionId })}
              disabled={completeMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {completeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Завершить сессию
            </button>
          )}
        </div>
      </div>

      {/* SOA tables list */}
      {verdicts.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-16 text-center">
          <Table2 className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">Таблицы SOA не обнаружены</p>
          <p className="mt-1 text-sm text-gray-400">
            В документе не найдено кандидатов на Schedule of Activities
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {verdicts.map((verdict: any, idx: number) => {
            const local = getLocal(verdict);
            const isExpanded = expandedId === verdict.id;
            const isReviewed = !!verdict.reviewedAt;

            return (
              <div
                key={verdict.id}
                className={`rounded-lg border bg-white ${
                  isReviewed ? "border-green-200 bg-green-50/30" : "border-gray-200"
                }`}
              >
                <div
                  className="flex items-center gap-4 px-4 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : verdict.id)
                  }
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                    <Table2 className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">
                      {verdict.tableTitle || `Таблица SOA #${idx + 1}`}
                    </div>
                    <div className="text-xs text-gray-500">
                      Скор обнаружения: {(verdict.soaScore * 100).toFixed(0)}% | {verdict.cellCount} ячеек
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {local?.isCorrect === true && (
                      <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        Корректно
                      </span>
                    )}
                    {local?.isCorrect === false && (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Ложное срабатывание
                      </span>
                    )}
                    {isReviewed && <Check className="h-4 w-4 text-green-500" />}
                    <ChevronDown
                      className={`h-4 w-4 text-gray-400 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                    <div className="mb-4 rounded-lg bg-white p-3 border border-gray-200">
                      <div className="text-xs font-medium text-gray-500 mb-2">
                        Информация о таблице:
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-xs">
                        <div>
                          <span className="text-gray-500">Заголовок:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {verdict.tableTitle || "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Скор:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {(verdict.soaScore * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">Ячеек:</span>{" "}
                          <span className="font-medium text-gray-900">
                            {verdict.cellCount}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3">
                      <div className="text-xs font-medium text-gray-600 mb-2">
                        Это действительно таблица SOA (Schedule of Activities)?
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCorrect(verdict.id, true)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            local?.isCorrect === true
                              ? "border-green-500 bg-green-50 text-green-700"
                              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <ThumbsUp className="h-3.5 w-3.5" />
                          Да, SOA корректно определена
                        </button>
                        <button
                          onClick={() => setCorrect(verdict.id, false)}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            local?.isCorrect === false
                              ? "border-red-500 bg-red-50 text-red-700"
                              : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                          Нет, ложное срабатывание
                        </button>
                      </div>
                    </div>

                    <div className="mb-3 flex items-start gap-2">
                      <MessageSquare className="mt-2 h-4 w-4 text-gray-400 flex-shrink-0" />
                      <textarea
                        value={local?.comment ?? verdict.comment ?? ""}
                        onChange={(e) => setComment(verdict.id, e.target.value)}
                        placeholder="Комментарий (опционально)..."
                        rows={2}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs resize-none"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        onClick={() => handleSave(verdict.id)}
                        disabled={
                          localChoices[verdict.id]?.isCorrect === null ||
                          localChoices[verdict.id]?.isCorrect === undefined ||
                          saveMutation.isPending
                        }
                        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {saveMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Сохранить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
