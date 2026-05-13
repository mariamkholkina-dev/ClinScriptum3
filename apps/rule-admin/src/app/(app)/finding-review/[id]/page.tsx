"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  MessageSquare,
  Send,
  CheckCircle2,
  Star,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITY_OPTIONS)[number];

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Критическое",
  high: "Высокое",
  medium: "Среднее",
  low: "Низкое",
  info: "Инфо",
};

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
  info: "bg-gray-100 text-gray-700",
};

interface ReviewFinding {
  id: string;
  description: string;
  suggestion?: string | null;
  severity: Severity | null;
  originalSeverity?: Severity | null;
  issueFamily?: string | null;
  issueType?: string | null;
  anchorZone?: string | null;
  status: string;
  hiddenByReviewer: boolean;
  reviewerNote?: string | null;
  sourceRef?: unknown;
}

interface ReviewView {
  id: string;
  docVersionId: string;
  auditType: "intra_audit" | "inter_audit";
  status: "pending" | "in_review" | "published";
  reviewerId: string | null;
  documentTitle?: string | null;
  versionLabel?: string | null;
  findings: ReviewFinding[];
}

export default function FindingReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reviewId = params.id;
  const utils = trpc.useUtils();

  const reviewQuery = trpc.findingReview.getReview.useQuery(
    { reviewId },
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const refetch = useCallback(() => {
    void utils.findingReview.getReview.invalidate({ reviewId });
    void utils.findingReview.dashboard.invalidate();
  }, [utils, reviewId]);

  const startReview = trpc.findingReview.startReview.useMutation({ onSuccess: refetch });
  const toggleHidden = trpc.findingReview.toggleHidden.useMutation({ onSuccess: refetch });
  const changeSeverity = trpc.findingReview.changeSeverity.useMutation({ onSuccess: refetch });
  const addNote = trpc.findingReview.addNote.useMutation({ onSuccess: refetch });
  const publish = trpc.findingReview.publish.useMutation({
    onSuccess: () => {
      refetch();
      router.push("/finding-review");
    },
  });

  if (reviewQuery.isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Loader2 size={20} className="mx-auto animate-spin" />
      </div>
    );
  }
  if (reviewQuery.error) {
    return (
      <div className="m-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle size={16} /> {reviewQuery.error.message}
      </div>
    );
  }

  const review = reviewQuery.data as ReviewView | undefined;
  if (!review) return null;

  const findings = review.findings;
  const hiddenCount = findings.filter((f) => f.hiddenByReviewer).length;
  const remainingVisible = findings.length - hiddenCount;
  const isPublished = review.status === "published";

  return (
    <div className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/finding-review")}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {review.documentTitle ?? `Документ ${review.docVersionId.slice(0, 8)}`}
              {review.versionLabel && (
                <span className="ml-2 text-xs text-gray-500">· {review.versionLabel}</span>
              )}
            </h1>
            <p className="text-xs text-gray-500">
              {review.auditType === "intra_audit"
                ? "Внутридокументный аудит"
                : "Межд. сравнение"}{" "}
              · статус: <span className="font-medium">{review.status}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Видны writer&apos;у после публикации: <b>{remainingVisible}</b> · скрыты:{" "}
            <b>{hiddenCount}</b>
          </span>
          {review.status === "pending" && (
            <button
              onClick={() => startReview.mutate({ reviewId })}
              disabled={startReview.isPending}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Взять в работу
            </button>
          )}
          {review.status !== "published" && (
            <button
              onClick={() => publish.mutate({ reviewId })}
              disabled={publish.isPending}
              className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Send size={14} />
              Опубликовать writer&apos;у
            </button>
          )}
          {isPublished && (
            <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
              <CheckCircle2 size={12} /> опубликовано
            </span>
          )}
        </div>
      </header>

      <div className="space-y-2">
        {findings.map((f) => (
          <FindingCard
            key={f.id}
            f={f}
            disabled={isPublished}
            reviewId={reviewId}
            onToggleHidden={() => toggleHidden.mutate({ reviewId, findingId: f.id })}
            onChangeSeverity={(severity) =>
              changeSeverity.mutate({ reviewId, findingId: f.id, severity })
            }
            onAddNote={(note) => addNote.mutate({ reviewId, findingId: f.id, note })}
          />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════ Promote-to-golden modal ═══════════════ */

interface GoldenSampleRow {
  id: string;
  name?: string | null;
  sampleType?: string;
}

function PromoteToGoldenModal({
  reviewId,
  findingId,
  onClose,
}: {
  reviewId: string;
  findingId: string;
  onClose: () => void;
}) {
  const samplesQuery = trpc.goldenDataset.listSamples.useQuery(
    {},
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const mutation = trpc.findingReview.promoteFindingToGolden.useMutation({
    onSuccess: (data) => {
      if (data && typeof data === "object" && "promoted" in data) {
        const d = data as { promoted: boolean; reason?: string };
        setResult(
          d.promoted ? "✓ Finding добавлен в эталон" : `Уже присутствует (${d.reason ?? "—"})`,
        );
      } else {
        setResult("✓");
      }
    },
    onError: (err) => {
      setResult("✗ Ошибка: " + err.message);
    },
  });

  const samples = (samplesQuery.data ?? []) as GoldenSampleRow[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Star size={14} className="text-yellow-500" />
            Promote finding в эталонный набор
          </h3>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-gray-600">
            Выберите golden sample. Finding будет конвертирован в ExpectedFinding и добавлен
            в <code>expectedResults.findings</code> stage=&apos;intra_audit&apos;. Если такого
            stage у sample ещё нет — он создаётся как draft.
          </p>

          {samplesQuery.isLoading ? (
            <div className="py-4 text-center text-xs text-gray-500">
              <Loader2 size={14} className="mx-auto animate-spin" />
            </div>
          ) : samples.length === 0 ? (
            <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-700">
              Нет доступных golden samples. Создайте sample в /golden-dataset и повторите.
            </p>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {samples.map((s) => (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                    selected === s.id
                      ? "border-brand-500 bg-brand-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="sample"
                    checked={selected === s.id}
                    onChange={() => setSelected(s.id)}
                  />
                  <span className="flex-1">
                    {s.name ?? `Sample ${s.id.slice(0, 8)}`}
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
              className={`rounded p-2 text-xs ${
                result.startsWith("✗")
                  ? "bg-red-50 text-red-700"
                  : "bg-green-50 text-green-700"
              }`}
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
              onClick={() =>
                selected && mutation.mutate({ reviewId, findingId, goldenSampleId: selected })
              }
              disabled={!selected || mutation.isPending}
              className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
            >
              {mutation.isPending ? "..." : "Promote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FindingCard({
  f,
  disabled,
  reviewId,
  onToggleHidden,
  onChangeSeverity,
  onAddNote,
}: {
  f: ReviewFinding;
  disabled: boolean;
  reviewId: string;
  onToggleHidden: () => void;
  onChangeSeverity: (s: Severity) => void;
  onAddNote: (note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(f.reviewerNote ?? "");
  const [promoteOpen, setPromoteOpen] = useState(false);
  const sev = (f.severity ?? "medium") as Severity;
  const ref = (f.sourceRef ?? {}) as { anchorQuote?: string; targetQuote?: string };

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        f.hiddenByReviewer
          ? "border-gray-200 bg-gray-100/50 opacity-60"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <select
          value={sev}
          onChange={(e) => onChangeSeverity(e.target.value as Severity)}
          disabled={disabled}
          className={`rounded border-0 px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGE[sev]} disabled:cursor-not-allowed`}
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
        {f.originalSeverity && f.originalSeverity !== f.severity && (
          <span className="text-[10px] text-gray-400">
            (исходно: {SEVERITY_LABEL[f.originalSeverity]})
          </span>
        )}
        {f.issueFamily && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
            {f.issueFamily}
          </span>
        )}
        {f.issueType && (
          <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
            {f.issueType}
          </span>
        )}
        {f.anchorZone && (
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
            {f.anchorZone}
          </span>
        )}

        <div className="ml-auto flex shrink-0 gap-1">
          <button
            onClick={onToggleHidden}
            disabled={disabled}
            className={`rounded border px-2 py-0.5 text-xs transition-colors disabled:opacity-30 ${
              f.hiddenByReviewer
                ? "border-gray-400 bg-gray-200 text-gray-700"
                : "border-gray-300 text-gray-600 hover:border-red-300 hover:text-red-600"
            }`}
            title={f.hiddenByReviewer ? "Показать writer'у" : "Скрыть от writer'а (FP)"}
          >
            {f.hiddenByReviewer ? <EyeOff size={12} /> : <Eye size={12} />}
            <span className="ml-1">{f.hiddenByReviewer ? "Скрыто" : "Скрыть"}</span>
          </button>
          <button
            onClick={() => setNoteOpen((v) => !v)}
            disabled={disabled}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            title="Добавить заметку"
          >
            <MessageSquare size={12} /> {f.reviewerNote ? "✎ заметка" : "+ заметка"}
          </button>
          <button
            onClick={() => setPromoteOpen(true)}
            className="rounded border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-xs text-yellow-800 hover:bg-yellow-100"
            title="Перенести этот finding в эталонный набор (Promote-to-golden)"
          >
            <Star size={12} className="inline" /> В эталон
          </button>
        </div>
      </div>

      {promoteOpen && (
        <PromoteToGoldenModal
          reviewId={reviewId}
          findingId={f.id}
          onClose={() => setPromoteOpen(false)}
        />
      )}

      <p className="text-sm text-gray-800">{f.description}</p>

      {ref.anchorQuote && (
        <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">
          «{ref.anchorQuote}»
          {ref.targetQuote && (
            <>
              <br />
              <span className="text-gray-400">→</span> «{ref.targetQuote}»
            </>
          )}
        </blockquote>
      )}

      {f.suggestion && (
        <p className="mt-1 text-xs text-gray-500">
          <span className="font-medium">Suggestion:</span> {f.suggestion}
        </p>
      )}

      {noteOpen && (
        <div className="mt-2 space-y-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Почему скрыли / что не так / решение..."
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
            rows={2}
            maxLength={2000}
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={() => {
                setNoteOpen(false);
                setNote(f.reviewerNote ?? "");
              }}
              className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
            >
              Отмена
            </button>
            <button
              onClick={() => {
                onAddNote(note);
                setNoteOpen(false);
              }}
              disabled={!note.trim()}
              className="rounded bg-brand-600 px-2 py-0.5 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Сохранить
            </button>
          </div>
        </div>
      )}

      {!noteOpen && f.reviewerNote && (
        <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <span className="font-medium">📝 </span>
          {f.reviewerNote}
        </div>
      )}
    </div>
  );
}
