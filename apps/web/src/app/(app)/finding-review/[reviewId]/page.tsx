"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Send,
  Shield,
  Loader2,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";

/* ──────────────────── Constants ──────────────────── */

const SEVERITY_LABELS: Record<string, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-400 text-yellow-900",
  low: "bg-blue-100 text-blue-700",
  info: "bg-gray-100 text-gray-600",
};

const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-red-600",
  high: "border-l-orange-500",
  medium: "border-l-yellow-400",
  low: "border-l-blue-400",
  info: "border-l-gray-300",
};

const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "info", label: "Info" },
];

const AUDIT_TYPE_LABELS: Record<string, string> = {
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
};

/* ──────────────────── Main Page ──────────────────── */

export default function FindingReviewPage() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const router = useRouter();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [noteText, setNoteText] = useState("");
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.findingReview.getReview.useQuery(
    { reviewId },
    { enabled: !!reviewId }
  );

  const startReview = trpc.findingReview.startReview.useMutation({
    onSuccess: () => utils.findingReview.getReview.invalidate({ reviewId }),
  });

  const toggleHidden = trpc.findingReview.toggleHidden.useMutation({
    onSuccess: () => utils.findingReview.getReview.invalidate({ reviewId }),
  });

  const changeSeverity = trpc.findingReview.changeSeverity.useMutation({
    onSuccess: () => utils.findingReview.getReview.invalidate({ reviewId }),
  });

  const addNote = trpc.findingReview.addNote.useMutation({
    onSuccess: () => {
      utils.findingReview.getReview.invalidate({ reviewId });
      setNoteText("");
    },
  });

  const publish = trpc.findingReview.publish.useMutation({
    onSuccess: () => {
      utils.findingReview.getReview.invalidate({ reviewId });
      setShowPublishConfirm(false);
    },
  });

  useEffect(() => {
    if (data?.review.status === "pending") {
      startReview.mutate({ reviewId });
    }
  }, [data?.review.status]);

  const review = data?.review;
  const findings = data?.findings ?? [];

  const filteredFindings = findings.filter((f: any) => {
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    return true;
  });

  const selectedFinding = filteredFindings.find((f: any) => f.id === selectedFindingId)
    ?? (filteredFindings.length > 0 ? filteredFindings[0] : null);

  const hiddenCount = findings.filter((f: any) => f.hiddenByReviewer).length;
  const visibleCount = findings.length - hiddenCount;

  useEffect(() => {
    if (selectedFinding) {
      setNoteText(selectedFinding.reviewerNote ?? "");
    }
  }, [selectedFinding?.id]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data || !review) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertTriangle className="h-12 w-12 text-gray-300 mb-3" />
        <p className="text-gray-500">Ревью не найдено</p>
      </div>
    );
  }

  const isPublished = review.status === "published";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex-none border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/finding-review" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-1.5 text-sm text-gray-400">
                <span>Ревью findings</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-gray-600 font-medium">
                  {data.documentTitle} {data.versionLabel}
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">
                {AUDIT_TYPE_LABELS[review.auditType] ?? review.auditType}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-xs text-gray-500">
              <div>Видимые: <span className="font-semibold text-gray-900">{visibleCount}</span></div>
              <div>Скрытые: <span className="font-semibold text-red-600">{hiddenCount}</span></div>
            </div>

            {isPublished ? (
              <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700">
                Опубликовано
              </span>
            ) : (
              <>
                {showPublishConfirm ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Опубликовать?</span>
                    <button
                      onClick={() => publish.mutate({ reviewId })}
                      disabled={publish.isPending}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {publish.isPending ? "..." : "Да, опубликовать"}
                    </button>
                    <button
                      onClick={() => setShowPublishConfirm(false)}
                      className="rounded-lg border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowPublishConfirm(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    <Send className="h-4 w-4" />
                    Опубликовать
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Findings list */}
        <div className="w-[440px] flex-none border-r flex flex-col bg-gray-50">
          <div className="flex-none p-4 border-b bg-white space-y-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="all">Все серьёзности ({findings.length})</option>
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({findings.filter((f: any) => f.severity === o.value).length})
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredFindings.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Shield className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Нет findings</p>
              </div>
            )}

            {filteredFindings.map((finding: any) => {
              const severity = finding.severity ?? "info";
              const isSelected = finding.id === selectedFinding?.id;

              return (
                <div
                  key={finding.id}
                  onClick={() => setSelectedFindingId(finding.id)}
                  className={cn(
                    "rounded-lg border bg-white p-3 cursor-pointer transition-all border-l-4",
                    SEVERITY_BORDER[severity] ?? "border-l-gray-300",
                    finding.hiddenByReviewer && "opacity-50",
                    isSelected
                      ? "ring-2 ring-brand-400 shadow-md"
                      : "hover:shadow-sm"
                  )}
                >
                  <div className="flex items-start gap-2 mb-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase shrink-0",
                        SEVERITY_STYLES[severity]
                      )}
                    >
                      {SEVERITY_LABELS[severity]}
                    </span>
                    {finding.hiddenByReviewer && (
                      <span className="rounded-full bg-red-100 text-red-600 px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-0.5">
                        <EyeOff className="h-2.5 w-2.5" />
                        Скрыт
                      </span>
                    )}
                    {finding.originalSeverity && finding.originalSeverity !== finding.severity && (
                      <span className="text-[10px] text-gray-400 line-through">
                        {SEVERITY_LABELS[finding.originalSeverity]}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-900 line-clamp-2">
                    {finding.description}
                  </p>
                  {finding.reviewerNote && (
                    <div className="flex items-center gap-1 mt-1.5 text-[10px] text-purple-600">
                      <MessageSquare className="h-2.5 w-2.5" />
                      Есть заметка
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Finding detail + actions */}
        <div className="flex-1 overflow-y-auto bg-white p-6">
          {!selectedFinding ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Eye className="h-16 w-16 mb-4" />
              <p className="text-lg">Выберите finding для проверки</p>
            </div>
          ) : (
            <ReviewDetail
              finding={selectedFinding}
              reviewId={reviewId}
              isPublished={isPublished}
              noteText={noteText}
              onNoteChange={setNoteText}
              onToggleHidden={() =>
                toggleHidden.mutate({ reviewId, findingId: selectedFinding.id })
              }
              onChangeSeverity={(severity: string) =>
                changeSeverity.mutate({
                  reviewId,
                  findingId: selectedFinding.id,
                  severity: severity as any,
                })
              }
              onSaveNote={() =>
                addNote.mutate({
                  reviewId,
                  findingId: selectedFinding.id,
                  note: noteText,
                })
              }
              isToggling={toggleHidden.isPending}
              isChangingSeverity={changeSeverity.isPending}
              isSavingNote={addNote.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Review Detail ──────────────────── */

function ReviewDetail({
  finding,
  reviewId,
  isPublished,
  noteText,
  onNoteChange,
  onToggleHidden,
  onChangeSeverity,
  onSaveNote,
  isToggling,
  isChangingSeverity,
  isSavingNote,
}: {
  finding: any;
  reviewId: string;
  isPublished: boolean;
  noteText: string;
  onNoteChange: (v: string) => void;
  onToggleHidden: () => void;
  onChangeSeverity: (severity: string) => void;
  onSaveNote: () => void;
  isToggling: boolean;
  isChangingSeverity: boolean;
  isSavingNote: boolean;
}) {
  const ref = finding.sourceRef as any;
  const severity = finding.severity ?? "info";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Finding info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-bold uppercase",
              SEVERITY_STYLES[severity]
            )}
          >
            {SEVERITY_LABELS[severity]}
          </span>
          {finding.originalSeverity && finding.originalSeverity !== finding.severity && (
            <span className="text-xs text-gray-400">
              Алгоритм: <span className="line-through">{SEVERITY_LABELS[finding.originalSeverity]}</span>
            </span>
          )}
          {finding.hiddenByReviewer && (
            <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-xs font-medium flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              Скрыт от пользователя
            </span>
          )}
        </div>

        <h2 className="text-lg font-semibold text-gray-900">{finding.description}</h2>

        {finding.suggestion && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-3">
            <p className="text-sm text-green-800">
              <span className="font-medium">Рекомендация:</span> {finding.suggestion}
            </p>
          </div>
        )}
      </div>

      {/* Source refs */}
      {(ref?.anchorQuote || ref?.targetQuote || ref?.textSnippet || ref?.protocolQuote || ref?.checkedDocQuote) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Цитаты</h3>
          {ref.anchorQuote && (
            <blockquote className="border-l-4 border-brand-300 bg-brand-50 pl-4 py-2 text-sm text-gray-700 italic">
              {ref.anchorQuote}
            </blockquote>
          )}
          {ref.targetQuote && (
            <blockquote className="border-l-4 border-orange-300 bg-orange-50 pl-4 py-2 text-sm text-gray-700 italic">
              {ref.targetQuote}
            </blockquote>
          )}
          {ref.protocolQuote && (
            <blockquote className="border-l-4 border-brand-300 bg-brand-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="text-[10px] font-semibold uppercase text-brand-500 block mb-1">Протокол</span>
              {ref.protocolQuote}
            </blockquote>
          )}
          {ref.checkedDocQuote && (
            <blockquote className="border-l-4 border-orange-300 bg-orange-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="text-[10px] font-semibold uppercase text-orange-500 block mb-1">Проверяемый документ</span>
              {ref.checkedDocQuote}
            </blockquote>
          )}
          {ref.textSnippet && !ref.anchorQuote && !ref.protocolQuote && (
            <blockquote className="border-l-4 border-gray-300 bg-gray-50 pl-4 py-2 text-sm text-gray-700 italic">
              {ref.textSnippet}
            </blockquote>
          )}
        </div>
      )}

      {/* Reviewer actions */}
      {!isPublished && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-5">
          <h3 className="text-sm font-semibold text-gray-700">Действия ревьюера</h3>

          {/* Toggle hidden */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Скрыть от конечного пользователя</p>
              <p className="text-xs text-gray-500">
                Ложноположительный finding не будет показан
              </p>
            </div>
            <button
              onClick={onToggleHidden}
              disabled={isToggling}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                finding.hiddenByReviewer ? "bg-red-500" : "bg-gray-300"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                  finding.hiddenByReviewer ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Change severity */}
          <div>
            <p className="text-sm font-medium text-gray-900 mb-2">Уровень критичности</p>
            <div className="flex gap-1.5">
              {SEVERITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onChangeSeverity(opt.value)}
                  disabled={isChangingSeverity}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
                    severity === opt.value
                      ? cn(SEVERITY_STYLES[opt.value], "ring-2 ring-offset-1 ring-gray-300")
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <p className="text-sm font-medium text-gray-900 mb-2">Заметка</p>
            <textarea
              value={noteText}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Комментарий к finding (сохраняется для обучения алгоритма)..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              rows={3}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={onSaveNote}
                disabled={isSavingNote || noteText === (finding.reviewerNote ?? "")}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40"
              >
                <MessageSquare className="h-3 w-3" />
                Сохранить заметку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Published readonly note */}
      {isPublished && finding.reviewerNote && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <p className="text-xs font-semibold text-purple-700 uppercase mb-1">Заметка ревьюера</p>
          <p className="text-sm text-gray-700">{finding.reviewerNote}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-gray-400 space-y-0.5">
        {finding.auditCategory && <p>Категория: {finding.auditCategory}</p>}
        {finding.issueType && <p>Тип: {finding.issueType}</p>}
        {finding.issueFamily && <p>Семейство: {finding.issueFamily}</p>}
        {finding.anchorZone && <p>Зона (anchor): {finding.anchorZone}</p>}
        {finding.targetZone && <p>Зона (target): {finding.targetZone}</p>}
      </div>
    </div>
  );
}
