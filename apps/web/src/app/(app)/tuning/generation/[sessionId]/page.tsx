"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  Loader2,
  Save,
  CheckCircle2,
  Star,
  MessageSquare,
  ChevronDown,
  FileText,
} from "lucide-react";

const RATING_LABELS: Record<number, string> = {
  1: "Ужасно",
  2: "Плохо",
  3: "Удовлетворительно",
  4: "Хорошо",
  5: "Отлично",
};

const RATING_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-yellow-500",
  4: "bg-lime-500",
  5: "bg-green-500",
};

const RATING_RING_COLORS: Record<number, string> = {
  1: "ring-red-300 bg-red-50 text-red-700",
  2: "ring-orange-300 bg-orange-50 text-orange-700",
  3: "ring-yellow-300 bg-yellow-50 text-yellow-700",
  4: "ring-lime-300 bg-lime-50 text-lime-700",
  5: "ring-green-300 bg-green-50 text-green-700",
};

export default function GenerationTuningPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const sessionQuery = trpc.tuning.getSession.useQuery({ sessionId });
  const verdictsQuery = trpc.tuning.getGenerationVerdicts.useQuery({ sessionId });
  const completeMutation = trpc.tuning.completeSession.useMutation({
    onSuccess: () => router.push("/tuning"),
  });

  const saveMutation = trpc.tuning.saveGenerationVerdict.useMutation({
    onSuccess: () => verdictsQuery.refetch(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localState, setLocalState] = useState<
    Record<string, { rating: number; comment: string }>
  >({});

  const session = sessionQuery.data;
  const verdicts = (verdictsQuery.data ?? []).sort((a: any, b: any) => a.order - b.order);
  const reviewedCount = verdicts.filter((v: any) => v.reviewedAt).length;
  const totalCount = verdicts.length;

  const ratings = verdicts.filter((v: any) => v.rating > 0).map((v: any) => v.rating);
  const avgRating =
    ratings.length > 0 ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length : 0;

  function getLocal(id: string, verdict: any) {
    return (
      localState[id] ?? {
        rating: verdict.rating || 0,
        comment: verdict.comment || "",
      }
    );
  }

  function setLocal(id: string, patch: Partial<{ rating: number; comment: string }>) {
    setLocalState((prev) => ({
      ...prev,
      [id]: { ...getLocal(id, {}), ...prev[id], ...patch },
    }));
  }

  function handleSave(verdictId: string) {
    const local = localState[verdictId];
    if (!local || local.rating === 0) return;
    saveMutation.mutate({
      verdictId,
      rating: local.rating,
      comment: local.comment || undefined,
    });
  }

  const isLoading = sessionQuery.isLoading || verdictsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Заголовок */}
      <div className="mb-6">
        <Link
          href="/tuning"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к тюнингу
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Тюнинг качества генерации ICF
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {session?.docVersion?.document?.title ?? "—"}{" "}
              <span className="text-gray-400">
                {session?.docVersion?.versionLabel ??
                  `v${session?.docVersion?.versionNumber}`}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Средний рейтинг */}
            {ratings.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                <Star className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium text-gray-700">
                  {avgRating.toFixed(1)} / 5
                </span>
              </div>
            )}

            {/* Прогресс */}
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-gray-700">
                {reviewedCount} / {totalCount}
              </span>
            </div>

            {session?.status !== "completed" && (
              <button
                onClick={() => completeMutation.mutate({ sessionId })}
                disabled={completeMutation.isPending || reviewedCount === 0}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
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
      </div>

      {/* Список секций */}
      <div className="space-y-3">
        {verdicts.map((verdict: any) => {
          const isExpanded = expandedId === verdict.id;
          const local = getLocal(verdict.id, verdict);
          const currentRating = local.rating || verdict.rating || 0;
          const hasChanges =
            localState[verdict.id] &&
            (localState[verdict.id].rating !== (verdict.rating || 0) ||
              localState[verdict.id].comment !== (verdict.comment || ""));

          return (
            <div
              key={verdict.id}
              className={`rounded-xl border transition-all ${
                verdict.reviewedAt
                  ? "border-green-200 bg-green-50/30"
                  : "border-gray-200 bg-white"
              }`}
            >
              {/* Заголовок строки */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : verdict.id)}
                className="flex w-full items-center gap-4 px-5 py-4 text-left"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-sm font-mono text-gray-500">
                  {verdict.order + 1}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">
                      {verdict.sectionTitle}
                    </span>
                    {verdict.standardSection && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-mono text-blue-700">
                        {verdict.standardSection}
                      </span>
                    )}
                  </div>
                </div>

                {/* Рейтинг-звёзды (компактный) */}
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`h-4 w-4 ${
                        star <= currentRating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-gray-300"
                      }`}
                    />
                  ))}
                </div>

                {verdict.reviewedAt && (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                )}

                {verdict.comment && (
                  <MessageSquare className="h-4 w-4 text-blue-400 flex-shrink-0" />
                )}

                <ChevronDown
                  className={`h-4 w-4 text-gray-400 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Развёрнутое содержимое */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-5 py-5">
                  {/* Контент секции */}
                  <div className="mb-6">
                    <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                      <FileText className="h-4 w-4" />
                      Сгенерированный контент
                    </h4>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {verdict.content || (
                        <span className="italic text-gray-400">Контент отсутствует</span>
                      )}
                    </div>
                  </div>

                  {/* QA-замечания (если есть) */}
                  {Array.isArray(verdict.qaFindings) &&
                    verdict.qaFindings.length > 0 && (
                      <div className="mb-6">
                        <h4 className="mb-2 text-sm font-medium text-gray-700">
                          QA-замечания автоматической проверки
                        </h4>
                        <div className="space-y-1">
                          {(verdict.qaFindings as any[]).map((f: any, i: number) => (
                            <div
                              key={i}
                              className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                            >
                              {typeof f === "string" ? f : f.message ?? JSON.stringify(f)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Оценка качества */}
                  <div className="mb-5">
                    <h4 className="mb-3 text-sm font-medium text-gray-700">
                      Оценка качества генерации
                    </h4>
                    <div className="flex items-center gap-3">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const isActive = star <= (localState[verdict.id]?.rating ?? verdict.rating ?? 0);
                        return (
                          <button
                            key={star}
                            onClick={() => setLocal(verdict.id, { rating: star })}
                            className={`group flex flex-col items-center gap-1 rounded-xl px-3 py-2 ring-2 transition-all ${
                              isActive
                                ? RATING_RING_COLORS[star]
                                : "ring-transparent hover:ring-gray-200 bg-white"
                            }`}
                          >
                            <Star
                              className={`h-6 w-6 transition-colors ${
                                isActive
                                  ? "fill-current"
                                  : "text-gray-300 group-hover:text-gray-400"
                              }`}
                            />
                            <span className={`text-[10px] font-medium ${isActive ? "" : "text-gray-400"}`}>
                              {RATING_LABELS[star]}
                            </span>
                          </button>
                        );
                      })}

                      {currentRating > 0 && (
                        <div className="ml-3 flex items-center gap-1.5">
                          <div
                            className={`h-2.5 w-2.5 rounded-full ${RATING_COLORS[currentRating]}`}
                          />
                          <span className="text-sm font-medium text-gray-600">
                            {currentRating}/5 — {RATING_LABELS[currentRating]}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Комментарий */}
                  <div className="mb-4">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Комментарий (что не понравилось / что улучшить)
                    </label>
                    <textarea
                      value={localState[verdict.id]?.comment ?? verdict.comment ?? ""}
                      onChange={(e) => setLocal(verdict.id, { comment: e.target.value })}
                      rows={3}
                      placeholder="Опишите недостатки этой секции для последующей коррекции промптов генерации..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>

                  {/* Кнопка сохранения */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSave(verdict.id)}
                      disabled={
                        saveMutation.isPending ||
                        (localState[verdict.id]?.rating ?? verdict.rating ?? 0) === 0 ||
                        !hasChanges
                      }
                      className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Сохранить оценку
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {verdicts.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-16 text-center">
          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">Нет секций для оценки</p>
        </div>
      )}
    </div>
  );
}
