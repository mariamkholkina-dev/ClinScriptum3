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
  Edit3,
} from "lucide-react";

function confidenceColor(conf: number) {
  if (conf >= 0.8) return "bg-green-100 text-green-700";
  if (conf >= 0.5) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

export default function FactTuningPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const sessionQuery = trpc.tuning.getSession.useQuery({ sessionId });
  const verdictsQuery = trpc.tuning.getFactVerdicts.useQuery({ sessionId });
  const completeMutation = trpc.tuning.completeSession.useMutation({
    onSuccess: () => router.push("/tuning"),
  });

  const saveMutation = trpc.tuning.saveFactVerdict.useMutation({
    onSuccess: () => verdictsQuery.refetch(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localChoices, setLocalChoices] = useState<
    Record<string, { isCorrect: boolean | null; auditorValue: string; comment: string }>
  >({});

  const session = sessionQuery.data;
  const verdicts = verdictsQuery.data ?? [];

  const reviewedCount = verdicts.filter((v: any) => v.reviewedAt).length;
  const totalCount = verdicts.length;

  function getLocal(verdict: any) {
    if (localChoices[verdict.id]) return localChoices[verdict.id];
    if (verdict.isCorrect !== null) {
      return {
        isCorrect: verdict.isCorrect,
        auditorValue: verdict.auditorValue ?? "",
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
        auditorValue: prev[verdictId]?.auditorValue ?? "",
        comment: prev[verdictId]?.comment ?? "",
      },
    }));
  }

  function setAuditorValue(verdictId: string, val: string) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        isCorrect: false,
        auditorValue: val,
        comment: prev[verdictId]?.comment ?? "",
      },
    }));
  }

  function setComment(verdictId: string, comment: string) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        isCorrect: prev[verdictId]?.isCorrect ?? null,
        auditorValue: prev[verdictId]?.auditorValue ?? "",
        comment,
      },
    }));
  }

  function handleSave(verdictId: string) {
    const local = localChoices[verdictId];
    if (!local || local.isCorrect === null) return;
    saveMutation.mutate({
      verdictId,
      isCorrect: local.isCorrect,
      auditorValue: local.auditorValue || undefined,
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
            Тюнинг фактов: {session?.docVersion?.document?.title}
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

      {/* List */}
      <div className="space-y-2">
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
              {/* Row */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : verdict.id)}
              >
                <div className="w-8 text-sm text-gray-400">{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {verdict.factKey}
                  </div>
                  <div className="text-xs text-gray-500 truncate">
                    {verdict.factCategory} — {verdict.factDescription}
                  </div>
                </div>
                <div className="w-48">
                  {verdict.llmValue ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-700 truncate max-w-[120px]">
                        {verdict.llmValue}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceColor(
                          verdict.llmConfidence
                        )}`}
                      >
                        {(verdict.llmConfidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">не найден</span>
                  )}
                </div>
                <div className="w-24 text-center">
                  {local?.isCorrect === true && (
                    <span className="text-xs font-medium text-green-600">Верно</span>
                  )}
                  {local?.isCorrect === false && (
                    <span className="text-xs font-medium text-red-600">Неверно</span>
                  )}
                  {local?.isCorrect === null || local?.isCorrect === undefined ? (
                    !isReviewed && (
                      <span className="text-xs text-gray-400 italic">—</span>
                    )
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  {isReviewed && <Check className="h-4 w-4 text-green-500" />}
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                  <div className="mb-3 rounded-lg bg-white p-3 border border-gray-200">
                    <div className="text-xs font-medium text-gray-500 mb-1">
                      Значение LLM:
                    </div>
                    <div className="text-sm text-gray-800">
                      {verdict.llmValue || "—"}
                    </div>
                  </div>

                  <div className="mb-3 flex gap-2">
                    <button
                      onClick={() => setCorrect(verdict.id, true)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        local?.isCorrect === true
                          ? "border-green-500 bg-green-50 text-green-700"
                          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      Верно
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
                      Неверно
                    </button>
                  </div>

                  {local?.isCorrect === false && (
                    <div className="mb-3 flex items-center gap-2">
                      <Edit3 className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={local?.auditorValue ?? ""}
                        onChange={(e) =>
                          setAuditorValue(verdict.id, e.target.value)
                        }
                        placeholder="Правильное значение..."
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
                      />
                    </div>
                  )}

                  <div className="mb-3 flex items-start gap-2">
                    <MessageSquare className="mt-2 h-4 w-4 text-gray-400 flex-shrink-0" />
                    <textarea
                      value={local?.comment ?? verdict.comment ?? ""}
                      onChange={(e) =>
                        setComment(verdict.id, e.target.value)
                      }
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
    </div>
  );
}
