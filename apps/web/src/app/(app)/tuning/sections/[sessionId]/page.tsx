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
  AlertTriangle,
} from "lucide-react";

function confidenceStyle(conf: number) {
  if (conf >= 0.8) return "bg-green-100 text-green-700";
  if (conf >= 0.5) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

function confidenceBar(conf: number) {
  if (conf >= 0.8) return "bg-green-500";
  if (conf >= 0.5) return "bg-yellow-500";
  return "bg-red-500";
}

export default function SectionTuningPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const sessionQuery = trpc.tuning.getSession.useQuery({ sessionId });
  const verdictsQuery = trpc.tuning.getSectionVerdicts.useQuery({ sessionId });
  const taxonomyQuery = trpc.tuning.getTaxonomy.useQuery();
  const completeMutation = trpc.tuning.completeSession.useMutation({
    onSuccess: () => router.push("/tuning"),
  });

  const saveMutation = trpc.tuning.saveSectionVerdict.useMutation({
    onSuccess: () => verdictsQuery.refetch(),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [localChoices, setLocalChoices] = useState<
    Record<string, { choice: string; agreedWith: string; comment: string }>
  >({});

  const session = sessionQuery.data;
  const verdicts = verdictsQuery.data ?? [];
  const taxonomy = taxonomyQuery.data ?? [];

  const reviewedCount = verdicts.filter((v) => v.reviewedAt).length;
  const totalCount = verdicts.length;
  const mismatchCount = verdicts.filter(
    (v: any) => v.algoResult && v.llmResult && v.algoResult !== v.llmResult
  ).length;

  function getLocalOrSaved(verdict: any) {
    if (localChoices[verdict.id]) return localChoices[verdict.id];
    if (verdict.auditorChoice) {
      return {
        choice: verdict.auditorChoice,
        agreedWith: verdict.auditorAgreedWith ?? "custom",
        comment: verdict.comment ?? "",
      };
    }
    return null;
  }

  function setChoice(verdictId: string, choice: string, agreedWith: string) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        choice,
        agreedWith,
        comment: prev[verdictId]?.comment ?? "",
      },
    }));
  }

  function setComment(verdictId: string, comment: string) {
    setLocalChoices((prev) => ({
      ...prev,
      [verdictId]: {
        choice: prev[verdictId]?.choice ?? "",
        agreedWith: prev[verdictId]?.agreedWith ?? "custom",
        comment,
      },
    }));
  }

  function handleSave(verdictId: string) {
    const local = localChoices[verdictId];
    if (!local || !local.choice) return;
    saveMutation.mutate({
      verdictId,
      auditorChoice: local.choice,
      auditorAgreedWith: local.agreedWith as any,
      comment: local.comment || undefined,
    });
  }

  function getTaxonomyLabel(key: string | null | undefined) {
    if (!key) return null;
    const t = taxonomy.find((t: any) => t.key === key);
    return t?.titleRu ?? null;
  }

  if (sessionQuery.isLoading || verdictsQuery.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
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
            Тюнинг секций: {session?.docVersion?.document?.title}
          </h1>
          <p className="text-sm text-gray-500">
            {session?.docVersion?.versionLabel ??
              `v${session?.docVersion?.versionNumber}`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {mismatchCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {mismatchCount} расхождений
            </div>
          )}
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
              disabled={completeMutation.isLoading}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {completeMutation.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Завершить сессию
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="grid grid-cols-[36px_1fr_220px_220px_180px_48px] gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          <div>#</div>
          <div>Заголовок секции</div>
          <div>Алгоритм</div>
          <div>LLM</div>
          <div>Ваш выбор</div>
          <div></div>
        </div>

        {verdicts.map((verdict: any, idx: number) => {
          const local = getLocalOrSaved(verdict);
          const isExpanded = expandedId === verdict.id;
          const isReviewed = !!verdict.reviewedAt;
          const hasMismatch =
            verdict.algoResult &&
            verdict.llmResult &&
            verdict.algoResult !== verdict.llmResult;

          return (
            <div
              key={verdict.id}
              className={`border-b border-gray-100 last:border-0 ${
                isReviewed
                  ? "bg-green-50/30"
                  : hasMismatch
                  ? "bg-orange-50/40"
                  : ""
              }`}
            >
              <div
                className="grid grid-cols-[36px_1fr_220px_220px_180px_48px] gap-2 px-4 py-3 items-center cursor-pointer hover:bg-gray-50/80"
                onClick={() =>
                  setExpandedId(isExpanded ? null : verdict.id)
                }
              >
                {/* # */}
                <div className="text-sm text-gray-400">{idx + 1}</div>

                {/* Title */}
                <div className="min-w-0 flex items-center gap-2">
                  {hasMismatch && (
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                  )}
                  <div className="truncate text-sm font-medium text-gray-900">
                    {"  ".repeat(Math.max(0, verdict.sectionLevel - 1))}
                    {verdict.sectionTitle}
                  </div>
                </div>

                {/* Algo result */}
                <div>
                  {verdict.algoResult ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-xs font-mono ${
                            hasMismatch
                              ? "text-orange-700 font-semibold"
                              : "text-gray-700"
                          }`}
                        >
                          {verdict.algoResult}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className={`h-full rounded-full ${confidenceBar(
                              verdict.algoConfidence
                            )}`}
                            style={{
                              width: `${verdict.algoConfidence * 100}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceStyle(
                            verdict.algoConfidence
                          )}`}
                        >
                          {(verdict.algoConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">
                      не определён
                    </span>
                  )}
                </div>

                {/* LLM result */}
                <div>
                  {verdict.llmResult ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`truncate text-xs font-mono ${
                            hasMismatch
                              ? "text-orange-700 font-semibold"
                              : "text-gray-700"
                          }`}
                        >
                          {verdict.llmResult}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
                          <div
                            className={`h-full rounded-full ${confidenceBar(
                              verdict.llmConfidence
                            )}`}
                            style={{
                              width: `${verdict.llmConfidence * 100}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceStyle(
                            verdict.llmConfidence
                          )}`}
                        >
                          {(verdict.llmConfidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">
                      не вызван
                    </span>
                  )}
                </div>

                {/* Auditor choice */}
                <div>
                  {local ? (
                    <span className="text-xs font-mono font-medium text-brand-700">
                      {local.choice}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 italic">
                      не выбрано
                    </span>
                  )}
                </div>

                {/* Status icons */}
                <div className="flex items-center gap-1">
                  {isReviewed && (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </div>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-4">
                  {/* Comparison cards */}
                  <div className="mb-4 grid grid-cols-2 gap-3">
                    {/* Algo card */}
                    <div
                      className={`rounded-lg border p-3 ${
                        hasMismatch
                          ? "border-orange-200 bg-orange-50/50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Алгоритм
                        </span>
                        {verdict.algoResult && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${confidenceStyle(
                              verdict.algoConfidence
                            )}`}
                          >
                            {(verdict.algoConfidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {verdict.algoResult ? (
                        <>
                          <div className="text-sm font-mono font-medium text-gray-900">
                            {verdict.algoResult}
                          </div>
                          {getTaxonomyLabel(verdict.algoResult) && (
                            <div className="mt-0.5 text-xs text-gray-500">
                              {getTaxonomyLabel(verdict.algoResult)}
                            </div>
                          )}
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className={`h-full rounded-full transition-all ${confidenceBar(
                                verdict.algoConfidence
                              )}`}
                              style={{
                                width: `${verdict.algoConfidence * 100}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400 italic">
                          Не удалось определить секцию
                        </div>
                      )}
                    </div>

                    {/* LLM card */}
                    <div
                      className={`rounded-lg border p-3 ${
                        hasMismatch
                          ? "border-orange-200 bg-orange-50/50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          LLM
                        </span>
                        {verdict.llmResult && (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${confidenceStyle(
                              verdict.llmConfidence
                            )}`}
                          >
                            {(verdict.llmConfidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      {verdict.llmResult ? (
                        <>
                          <div className="text-sm font-mono font-medium text-gray-900">
                            {verdict.llmResult}
                          </div>
                          {getTaxonomyLabel(verdict.llmResult) && (
                            <div className="mt-0.5 text-xs text-gray-500">
                              {getTaxonomyLabel(verdict.llmResult)}
                            </div>
                          )}
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className={`h-full rounded-full transition-all ${confidenceBar(
                                verdict.llmConfidence
                              )}`}
                              style={{
                                width: `${verdict.llmConfidence * 100}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400 italic">
                          LLM не вызывался (уверенность алгоритма достаточна)
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mismatch warning */}
                  {hasMismatch && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      <span className="text-xs text-orange-700">
                        Алгоритм и LLM выбрали разные секции. Требуется ручная проверка.
                      </span>
                    </div>
                  )}

                  {/* Content preview */}
                  {verdict.contentPreview && (
                    <div className="mb-4 rounded-lg bg-white p-3 text-xs text-gray-600 border border-gray-200">
                      <div className="font-medium text-gray-500 mb-1">
                        Превью содержимого:
                      </div>
                      {verdict.contentPreview}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="mb-3 flex flex-wrap gap-2">
                    {verdict.algoResult && (
                      <button
                        onClick={() =>
                          setChoice(verdict.id, verdict.algoResult, "algo")
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          local?.agreedWith === "algo"
                            ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-300"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        Алгоритм: {verdict.algoResult}
                        <span className="ml-1 opacity-60">
                          ({(verdict.algoConfidence * 100).toFixed(0)}%)
                        </span>
                      </button>
                    )}
                    {verdict.llmResult && (
                      <button
                        onClick={() =>
                          setChoice(verdict.id, verdict.llmResult, "llm")
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          local?.agreedWith === "llm"
                            ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-300"
                            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        LLM: {verdict.llmResult}
                        <span className="ml-1 opacity-60">
                          ({(verdict.llmConfidence * 100).toFixed(0)}%)
                        </span>
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Свой вариант:</span>
                      <select
                        value={local?.agreedWith === "custom" ? local?.choice : ""}
                        onChange={(e) => {
                          if (e.target.value) {
                            setChoice(verdict.id, e.target.value, "custom");
                          }
                        }}
                        className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="">Выбрать...</option>
                        {taxonomy.map((t: any) => (
                          <option key={t.key} value={t.key}>
                            {t.key} — {t.titleRu}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Comment */}
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

                  {/* Save */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSave(verdict.id)}
                      disabled={
                        !localChoices[verdict.id]?.choice ||
                        saveMutation.isLoading
                      }
                      className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {saveMutation.isLoading ? (
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
