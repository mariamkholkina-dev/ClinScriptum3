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

function FindingCard({
  f,
  disabled,
  onToggleHidden,
  onChangeSeverity,
  onAddNote,
}: {
  f: ReviewFinding;
  disabled: boolean;
  onToggleHidden: () => void;
  onChangeSeverity: (s: Severity) => void;
  onAddNote: (note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(f.reviewerNote ?? "");
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
        </div>
      </div>

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
