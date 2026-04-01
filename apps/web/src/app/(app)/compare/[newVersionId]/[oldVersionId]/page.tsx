"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Minus,
  Edit3,
  FileText,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

export default function ProtocolComparisonPage() {
  const { newVersionId, oldVersionId } = useParams<{
    newVersionId: string;
    oldVersionId: string;
  }>();

  const compareMutation = trpc.comparison.compare.useMutation();
  const oldVersionQuery = trpc.document.getVersion.useQuery({ versionId: oldVersionId });
  const newVersionQuery = trpc.document.getVersion.useQuery({ versionId: newVersionId });

  const oldVersion = oldVersionQuery.data;
  const newVersion = newVersionQuery.data;
  const startedRef = useRef(false);

  useEffect(() => {
    if (oldVersion && newVersion && !startedRef.current) {
      startedRef.current = true;
      compareMutation.mutate({ oldVersionId, newVersionId });
    }
  }, [oldVersion, newVersion]);

  const result = compareMutation.data;
  const isLoading =
    oldVersionQuery.isLoading ||
    newVersionQuery.isLoading ||
    compareMutation.isPending;

  const oldLabel = oldVersion
    ? oldVersion.versionLabel ?? `v${oldVersion.versionNumber}`
    : "...";
  const newLabel = newVersion
    ? newVersion.versionLabel ?? `v${newVersion.versionNumber}`
    : "...";
  const docTitle = newVersion?.document?.title ?? "Протокол";
  const studyTitle =
    (newVersion?.document as any)?.study?.title ??
    (newVersion?.document as any)?.study?.code ??
    "";
  const studyId = (newVersion?.document as any)?.study?.id ?? "";

  const changes = result?.sectionDiffs.filter(
    (d) => d.changeType !== "unchanged"
  );
  const changesCount = changes?.length ?? 0;

  const handleDownloadReport = async () => {
    const { useAuthStore } = await import("@/lib/auth-store");
    const token = useAuthStore.getState().accessToken;
    const apiUrl = (
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc"
    ).replace("/trpc", "");
    const res = await fetch(
      `${apiUrl}/api/comparison-report/${oldVersionId}/${newVersionId}`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Перечень_изменений_${docTitle}_${oldLabel}_${newLabel}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const [selectedChangeIdx, setSelectedChangeIdx] = useState<number | null>(null);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
        <Link href="/dashboard" className="hover:text-gray-600">
          Главная
        </Link>
        <ChevronRight className="h-3 w-3" />
        {studyId ? (
          <Link href={`/studies/${studyId}`} className="hover:text-gray-600">
            {studyTitle}
          </Link>
        ) : (
          <span>{studyTitle}</span>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="text-gray-600">
          {docTitle} {newLabel}
        </span>
        <ChevronRight className="h-3 w-3" />
        <span className="text-gray-600">
          Сравнение с {docTitle.toLowerCase().includes("протокол") ? "протоколом" : docTitle} {oldLabel}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          {studyId && (
            <Link
              href={`/studies/${studyId}`}
              className="text-gray-400 hover:text-gray-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )}
          <h1 className="text-2xl font-bold text-gray-900">
            Сравнение версий протокола
          </h1>
        </div>
        {result && (
          <button
            onClick={handleDownloadReport}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 shadow-sm"
          >
            <FileText className="h-4 w-4" />
            Выгрузить &laquo;Перечень изменений&raquo; в DOCX
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-600" />
            <p className="mt-3 text-sm text-gray-500">
              Сравнение версий — это может занять несколько секунд...
            </p>
          </div>
        </div>
      )}

      {/* Error state */}
      {compareMutation.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">
            Ошибка при сравнении версий. Попробуйте ещё раз.
          </p>
          <button
            onClick={() =>
              compareMutation.mutate({ oldVersionId, newVersionId })
            }
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
          {/* Left panel: List of changes */}
          <div className="col-span-5 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-lg font-semibold text-gray-900">
                Перечень изменений
              </h2>
              <span className="inline-flex items-center justify-center rounded-full bg-brand-100 text-brand-700 px-2.5 py-0.5 text-xs font-bold">
                {changesCount}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {changes && changes.length > 0 ? (
                changes.map((diff, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedChangeIdx(i)}
                    className={cn(
                      "w-full text-left rounded-lg border bg-white p-4 shadow-sm transition-all hover:shadow-md",
                      selectedChangeIdx === i &&
                        "ring-2 ring-brand-400 border-brand-300"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-gray-400">
                        {i + 1}.
                      </span>
                      <span className="font-semibold text-gray-900 text-sm">
                        {diff.sectionTitle}
                      </span>
                    </div>
                    {diff.changeType === "modified" && (
                      <div className="space-y-1.5">
                        <div className="text-xs">
                          <span className="font-medium text-gray-500">
                            Было:
                          </span>
                          <br />
                          <span className="text-red-600 line-through">
                            {extractOldText(diff.textChanges)}
                          </span>
                        </div>
                        <div className="text-xs">
                          <span className="font-medium text-gray-500">
                            Стало:
                          </span>
                          <br />
                          <span className="text-green-700">
                            {extractNewText(diff.textChanges)}
                          </span>
                        </div>
                      </div>
                    )}
                    {diff.changeType === "added" && (
                      <div className="text-xs">
                        <span className="font-medium text-gray-500">
                          Было:
                        </span>{" "}
                        <span className="text-gray-400">—</span>
                        <br />
                        <span className="font-medium text-gray-500">
                          Стало:
                        </span>
                        <br />
                        <span className="text-green-700">
                          {(diff.newContent ?? "").slice(0, 200)}
                        </span>
                      </div>
                    )}
                    {diff.changeType === "removed" && (
                      <div className="text-xs">
                        <span className="font-medium text-gray-500">
                          Было:
                        </span>
                        <br />
                        <span className="text-red-600 line-through">
                          {(diff.oldContent ?? "").slice(0, 200)}
                        </span>
                        <br />
                        <span className="font-medium text-gray-500">
                          Стало:
                        </span>{" "}
                        <span className="text-gray-400">—</span>
                      </div>
                    )}
                  </button>
                ))
              ) : (
                <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
                  <p className="text-sm text-gray-500">
                    Изменений в секциях не обнаружено
                  </p>
                </div>
              )}

              {/* Fact changes at the bottom */}
              {result.factChanges.filter((f) => f.changeType !== "unchanged")
                .length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Изменения фактов
                  </h3>
                  {result.factChanges
                    .filter((f) => f.changeType !== "unchanged")
                    .map((fc, i) => (
                      <div
                        key={i}
                        className="rounded-lg border bg-white p-3 shadow-sm mb-2"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              fc.changeType === "added" &&
                                "bg-green-100 text-green-700",
                              fc.changeType === "removed" &&
                                "bg-red-100 text-red-700",
                              fc.changeType === "modified" &&
                                "bg-amber-100 text-amber-700"
                            )}
                          >
                            {fc.changeType === "added"
                              ? "Добавлен"
                              : fc.changeType === "removed"
                                ? "Удалён"
                                : "Изменён"}
                          </span>
                          <span className="font-medium text-sm text-gray-900">
                            {fc.factKey}
                          </span>
                        </div>
                        <div className="text-xs space-y-0.5">
                          <div>
                            <span className="text-gray-500">Было:</span>{" "}
                            <span className="text-red-600">
                              {fc.oldValue ?? "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">Стало:</span>{" "}
                            <span className="text-green-700">
                              {fc.newValue ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Document with inline changes */}
          <div className="col-span-7 flex flex-col min-h-0">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              {docTitle} {newLabel}{" "}
              <span className="text-sm font-normal text-gray-500">
                (с изменениями)
              </span>
            </h2>
            <div className="flex-1 overflow-y-auto rounded-lg border bg-white shadow-sm">
              <div className="p-6 space-y-6">
                {result.sectionDiffs.map((diff, i) => (
                  <div
                    key={i}
                    id={`section-${i}`}
                    className={cn(
                      "scroll-mt-4",
                      selectedChangeIdx !== null &&
                        changes &&
                        changes[selectedChangeIdx] === diff &&
                        "ring-2 ring-brand-300 rounded-lg p-3 -m-3 bg-brand-50/30"
                    )}
                  >
                    <h3
                      className={cn(
                        "text-base font-bold text-gray-900 mb-2",
                        diff.changeType === "added" && "text-green-700",
                        diff.changeType === "removed" &&
                          "text-red-700 line-through"
                      )}
                    >
                      {diff.sectionTitle}
                    </h3>

                    {diff.changeType === "unchanged" && (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {(diff.newContent ?? diff.oldContent ?? "").slice(
                          0,
                          1000
                        )}
                        {(diff.newContent ?? diff.oldContent ?? "").length >
                          1000 && (
                          <span className="text-gray-400">...</span>
                        )}
                      </p>
                    )}

                    {diff.changeType === "modified" && (
                      <div className="text-sm leading-relaxed">
                        {diff.textChanges.map((change, j) => (
                          <span
                            key={j}
                            className={cn(
                              change.type === "add" &&
                                "text-green-700 underline decoration-green-500",
                              change.type === "remove" &&
                                "text-red-600 line-through bg-red-50"
                            )}
                          >
                            {change.value}
                          </span>
                        ))}
                      </div>
                    )}

                    {diff.changeType === "added" && (
                      <p className="text-sm text-green-700 whitespace-pre-wrap leading-relaxed underline decoration-green-400">
                        {diff.newContent?.slice(0, 1000)}
                      </p>
                    )}

                    {diff.changeType === "removed" && (
                      <p className="text-sm text-red-600 whitespace-pre-wrap leading-relaxed line-through bg-red-50 rounded px-2 py-1">
                        {diff.oldContent?.slice(0, 1000)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function extractOldText(
  textChanges: { type: string; value: string }[]
): string {
  const parts = textChanges
    .filter((c) => c.type === "remove" || c.type === "equal")
    .map((c) => c.value);
  const text = parts.join("");
  return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

function extractNewText(
  textChanges: { type: string; value: string }[]
): string {
  const parts = textChanges
    .filter((c) => c.type === "add" || c.type === "equal")
    .map((c) => c.value);
  const text = parts.join("");
  return text.length > 200 ? text.slice(0, 200) + "..." : text;
}
