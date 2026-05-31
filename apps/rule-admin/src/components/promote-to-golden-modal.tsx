"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { Star, X, Loader2 } from "lucide-react";

/**
 * Модалка «Перенести находку(и) в эталонный набор» (promote-to-golden).
 * Аналог экрана rule-admin, но доступна ревьюеру в web finding-review.
 * Поддерживает одну находку и массовый перенос (findingIds[]).
 */
export function PromoteToGoldenModal({
  reviewId,
  findingIds,
  onClose,
}: {
  reviewId: string;
  findingIds: string[];
  onClose: () => void;
}) {
  const samplesQuery = trpc.findingReview.listGoldenSamples.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const promote = trpc.findingReview.promoteFindingToGolden.useMutation();

  const samples = samplesQuery.data ?? [];

  const handlePromote = async () => {
    if (!selected) return;
    setResult(null);
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const findingId of findingIds) {
      try {
        const res = await promote.mutateAsync({ reviewId, findingId, goldenSampleId: selected });
        if (res && typeof res === "object" && "promoted" in res) {
          if ((res as { promoted: boolean }).promoted) added += 1;
          else skipped += 1;
        } else {
          added += 1;
        }
      } catch {
        failed += 1;
      }
    }
    const parts = [`✓ добавлено: ${added}`];
    if (skipped) parts.push(`уже в эталоне: ${skipped}`);
    if (failed) parts.push(`ошибок: ${failed}`);
    setResult((failed ? "✗ " : "") + parts.join(" · "));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Star size={14} className="text-yellow-500" />
            {findingIds.length > 1
              ? `Перенести в эталон (${findingIds.length})`
              : "Перенести находку в эталон"}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-gray-600">
            Выберите эталонный набор. Находка конвертируется в ExpectedFinding и добавляется
            в <code>expectedResults.findings</code> этапа intra_audit. Если этапа ещё нет — он
            создаётся черновиком.
          </p>

          {samplesQuery.isLoading ? (
            <div className="py-4 text-center text-xs text-gray-500">
              <Loader2 size={14} className="mx-auto animate-spin" />
            </div>
          ) : samples.length === 0 ? (
            <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-700">
              Нет доступных эталонных наборов.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {samples.map((s) => (
                <label
                  key={s.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs",
                    selected === s.id
                      ? "border-brand-500 bg-brand-50"
                      : "border-gray-200 hover:bg-gray-50",
                  )}
                >
                  <input
                    type="radio"
                    name="golden-sample"
                    checked={selected === s.id}
                    onChange={() => setSelected(s.id)}
                  />
                  <span className="flex-1">
                    {s.name ?? `Набор ${s.id.slice(0, 8)}`}
                    {s.sampleType && (
                      <span className="ml-2 text-[10px] text-gray-500">{s.sampleType}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          {result && (
            <div
              className={cn(
                "rounded p-2 text-xs",
                result.startsWith("✗") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700",
              )}
            >
              {result}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
            >
              Закрыть
            </button>
            <button
              onClick={handlePromote}
              disabled={!selected || promote.isPending}
              className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
            >
              {promote.isPending ? "..." : "В эталон"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
