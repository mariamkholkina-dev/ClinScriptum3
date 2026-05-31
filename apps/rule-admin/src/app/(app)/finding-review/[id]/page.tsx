"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Send,
  Shield,
  Loader2,
  MessageSquare,
  AlertTriangle,
  Star,
  RotateCcw,
  FileText,
} from "lucide-react";
import { openInWord } from "@/lib/open-in-word";
import {
  SEVERITY_BORDER,
  SEVERITY_LABELS,
  SEVERITY_STYLES,
  SEVERITY_OPTIONS,
  STATUS_ORDER,
  STATUS_LABELS,
  TYPE_LABELS,
  extractFindingMeta,
  effectiveSeverity,
  selectTestedSections,
  FindingBadges,
  FindingCardBody,
  FindingDetailBody,
} from "@/components/finding-display";
import { PromoteToGoldenModal } from "@/components/promote-to-golden-modal";

/* ──────────────────── Constants ──────────────────── */

const AUDIT_TYPE_LABELS: Record<string, string> = {
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
};

// Фильтр по «ложному срабатыванию» — в ревью оно означает «скрыт ревьюером»
// (hiddenByReviewer), а не Finding.status. Показываем все опции всегда.
const VISIBILITY_OPTIONS = [
  { value: "all", label: "Все находки" },
  { value: "visible", label: "Не ложные (видимые)" },
  { value: "hidden", label: "Ложное срабатывание" },
] as const;

type DocSection = { id: string; title: string; standardSection: string | null; content: string };

/* ──────────────────── Main Page ──────────────────── */

export default function FindingReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const reviewId = params.id;
  const router = useRouter();

  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [noteText, setNoteText] = useState("");
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [promoteTarget, setPromoteTarget] = useState<string[] | null>(null);

  // Ширина левой панели (список находок) — перетаскиваемый разделитель.
  const [leftWidth, setLeftWidth] = useState(440);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !contentRef.current) return;
      const left = contentRef.current.getBoundingClientRect().left;
      // Ограничиваем: список не уже 280 и оставляем ≥360 правой панели.
      const max = contentRef.current.clientWidth - 360;
      const w = Math.min(Math.max(e.clientX - left, 280), Math.max(max, 280));
      setLeftWidth(w);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDragDivider = () => {
    draggingRef.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.findingReview.getReview.useQuery(
    { reviewId },
    { enabled: !!reviewId }
  );

  const refetch = () => {
    void utils.findingReview.getReview.invalidate({ reviewId });
    void utils.findingReview.dashboard.invalidate();
  };

  const startReview = trpc.findingReview.startReview.useMutation({ onSuccess: refetch });
  const toggleHidden = trpc.findingReview.toggleHidden.useMutation({ onSuccess: refetch });
  const changeSeverity = trpc.findingReview.changeSeverity.useMutation({ onSuccess: refetch });
  const addNote = trpc.findingReview.addNote.useMutation({
    onSuccess: () => { refetch(); setNoteText(""); },
  });
  const publish = trpc.findingReview.publish.useMutation({
    onSuccess: () => { refetch(); setShowPublishConfirm(false); },
  });

  const clearSelection = () => setSelectedIds(new Set());
  const bulkSetHidden = trpc.findingReview.bulkSetHidden.useMutation({
    onSuccess: () => { refetch(); clearSelection(); },
  });
  const bulkChangeSeverity = trpc.findingReview.bulkChangeSeverity.useMutation({
    onSuccess: () => { refetch(); clearSelection(); },
  });
  const restoreFromFP = trpc.findingReview.restoreFromFalsePositive.useMutation({
    onSuccess: () => { refetch(); clearSelection(); },
  });

  useEffect(() => {
    if (data?.review.status === "pending") {
      startReview.mutate({ reviewId });
    }
  }, [data?.review.status]);

  const review = data?.review;
  const findings = data?.findings ?? [];
  const sections = ((data as any)?.sections ?? []) as DocSection[];

  const availableTypes = Array.from(
    new Set(findings.map((f: any) => extractFindingMeta(f).type).filter(Boolean)),
  ).sort() as string[];

  const q = searchText.trim().toLowerCase();
  const filteredFindings = findings.filter((f: any) => {
    // «Ложное срабатывание» — это И скрытое ревьюером (hiddenByReviewer), И
    // помеченное конвейером/LLM (status=false_positive): на карточках обе пометки
    // подписаны «Ложное срабатывание», поэтому фильтр должен ловить оба случая.
    const isFalsePositive = f.hiddenByReviewer || f.status === "false_positive";
    if (severityFilter !== "all" && effectiveSeverity(f) !== severityFilter) return false;
    if (typeFilter !== "all" && extractFindingMeta(f).type !== typeFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (visibilityFilter === "hidden" && !isFalsePositive) return false;
    if (visibilityFilter === "visible" && isFalsePositive) return false;
    if (q) {
      const m = extractFindingMeta(f);
      const hay = [m.description, m.suggestion, m.textSnippet, m.referenceQuote, m.anchorQuote, m.targetQuote, f.reviewerNote]
        .filter((x): x is string => typeof x === "string")
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
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

  const testedSections = selectedFinding
    ? selectTestedSections(extractFindingMeta(selectedFinding), sections)
    : [];

  // ── Множественный выбор для массовых операций ──
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const filteredIds = filteredFindings.map((f: any) => f.id);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...filteredIds]);
    });
  const selectedArray = Array.from(selectedIds);
  const bulkBusy = bulkSetHidden.isPending || bulkChangeSeverity.isPending;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header (стиль rule-admin) */}
      <div className="flex-none border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/finding-review")}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-900 truncate">
                {data.documentTitle}
                <span className="ml-2 text-xs font-normal text-gray-500">{data.versionLabel}</span>
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {(data as any).studyTitle ? `${(data as any).studyTitle} · ` : ""}
                {AUDIT_TYPE_LABELS[review.auditType] ?? review.auditType} · статус: {review.status}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-none">
            <div className="text-right text-xs text-gray-500">
              <div>Видимые: <span className="font-semibold text-gray-900">{visibleCount}</span></div>
              <div>Скрытые: <span className="font-semibold text-red-600">{hiddenCount}</span></div>
            </div>
            <button
              onClick={() =>
                openInWord({
                  mode: "finding_review",
                  reviewId,
                  docVersionId: review.docVersionId,
                }).catch((e) => alert(e instanceof Error ? e.message : String(e)))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              title="Открыть это ревью находок в Word"
            >
              <FileText className="h-4 w-4" />
              Открыть в Word
            </button>
            {isPublished ? (
              <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700">
                Опубликовано
              </span>
            ) : showPublishConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Завершить ревью и опубликовать писателю?</span>
                <button
                  onClick={() => publish.mutate({ reviewId })}
                  disabled={publish.isPending}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {publish.isPending ? "..." : "Да, завершить"}
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
                title="Завершить ревью и опубликовать находки писателю"
              >
                <Send className="h-4 w-4" />
                Завершить ревью
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 flex min-h-0">
        {/* Left: Findings list (ширина регулируется разделителем) */}
        <div
          className="flex-none border-r flex flex-col bg-gray-50"
          style={{ width: leftWidth }}
        >
          <div className="flex-none p-4 border-b bg-white">
            {/* Поиск по тексту находки (описание/рекомендация/цитаты/заметка) */}
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Поиск по тексту находки…"
              className="w-full mb-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все серьёзности</option>
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все типы</option>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все статусы</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
              </select>
              <select
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {!isPublished && filteredFindings.length > 0 && (
              <div className="mt-2 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                  Выбрать все ({filteredFindings.length})
                </label>
                {selectedIds.size > 0 && (
                  <button onClick={clearSelection} className="text-xs text-gray-400 hover:text-gray-600">
                    Снять выделение ({selectedIds.size})
                  </button>
                )}
              </div>
            )}
          </div>

          {!isPublished && selectedIds.size > 0 && (
            <div className="flex-none border-b bg-amber-50 px-3 py-2 space-y-2">
              <div className="text-xs font-medium text-amber-800">Выбрано: {selectedIds.size}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => bulkSetHidden.mutate({ reviewId, findingIds: selectedArray, hidden: true })}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  <EyeOff className="h-3 w-3" /> Скрыть (FP)
                </button>
                <button
                  onClick={() => bulkSetHidden.mutate({ reviewId, findingIds: selectedArray, hidden: false })}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Eye className="h-3 w-3" /> Показать
                </button>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      bulkChangeSeverity.mutate({ reviewId, findingIds: selectedArray, severity: e.target.value as any });
                    }
                  }}
                  disabled={bulkBusy}
                  className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                >
                  <option value="">Серьёзность…</option>
                  {SEVERITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => setPromoteTarget(selectedArray)}
                  disabled={bulkBusy}
                  className="inline-flex items-center gap-1 rounded border border-yellow-300 bg-yellow-50 px-2 py-1 text-xs text-yellow-800 hover:bg-yellow-100 disabled:opacity-50"
                >
                  <Star className="h-3 w-3" /> В эталон
                </button>
                <button
                  onClick={() => restoreFromFP.mutate({ reviewId, findingIds: selectedArray })}
                  disabled={bulkBusy || restoreFromFP.isPending}
                  className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  title="Вернуть выбранные ложноположительные находки на валидацию"
                >
                  <RotateCcw className="h-3 w-3" /> Вернуть на валидацию
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredFindings.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Shield className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Нет findings</p>
              </div>
            )}

            {filteredFindings.map((finding: any) => {
              const severity = effectiveSeverity(finding);
              const isSelected = finding.id === selectedFinding?.id;
              const showOriginal = finding.originalSeverity && finding.originalSeverity !== severity;
              const isChecked = selectedIds.has(finding.id);

              return (
                <div
                  key={finding.id}
                  onClick={() => setSelectedFindingId(finding.id)}
                  className={cn(
                    "rounded-lg border bg-white p-3 cursor-pointer transition-all border-l-4",
                    SEVERITY_BORDER[severity] ?? "border-l-gray-300",
                    finding.hiddenByReviewer && "opacity-50",
                    isChecked && "ring-1 ring-amber-300",
                    isSelected ? "ring-2 ring-brand-400 shadow-md" : "hover:shadow-sm"
                  )}
                >
                  {!isPublished && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(finding.id)}
                      className="float-right ml-2 mt-0.5 rounded border-gray-300"
                    />
                  )}
                  <FindingBadges finding={finding} showStatus />
                  {(finding.hiddenByReviewer || showOriginal) && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      {finding.hiddenByReviewer && (
                        <span className="rounded-full bg-red-100 text-red-600 px-1.5 py-0.5 text-[10px] font-medium flex items-center gap-0.5">
                          <EyeOff className="h-2.5 w-2.5" />
                          Ложное срабатывание
                        </span>
                      )}
                      {showOriginal && (
                        <span className="text-[10px] text-gray-400">
                          Алгоритм:{" "}
                          <span className="line-through">{SEVERITY_LABELS[finding.originalSeverity] ?? finding.originalSeverity}</span>
                        </span>
                      )}
                    </div>
                  )}
                  <FindingCardBody finding={finding} />
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

        {/* Перетаскиваемый разделитель ширины панелей */}
        <div
          onMouseDown={startDragDivider}
          className="w-1.5 flex-none cursor-col-resize bg-gray-200 hover:bg-brand-400 transition-colors"
          title="Потяните, чтобы изменить ширину панелей"
        />

        {/* Right: Finding detail + actions */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-white p-6">
          {!selectedFinding ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Eye className="h-16 w-16 mb-4" />
              <p className="text-lg">Выберите finding для проверки</p>
            </div>
          ) : (
            <ReviewDetail
              finding={selectedFinding}
              sections={testedSections}
              isPublished={isPublished}
              noteText={noteText}
              onNoteChange={setNoteText}
              onToggleHidden={() => toggleHidden.mutate({ reviewId, findingId: selectedFinding.id })}
              onChangeSeverity={(severity: string) =>
                changeSeverity.mutate({ reviewId, findingId: selectedFinding.id, severity: severity as any })
              }
              onSaveNote={() => addNote.mutate({ reviewId, findingId: selectedFinding.id, note: noteText })}
              onPromote={() => setPromoteTarget([selectedFinding.id])}
              onRestore={() => restoreFromFP.mutate({ reviewId, findingIds: [selectedFinding.id] })}
              isToggling={toggleHidden.isPending}
              isChangingSeverity={changeSeverity.isPending}
              isSavingNote={addNote.isPending}
              isRestoring={restoreFromFP.isPending}
            />
          )}
        </div>
      </div>

      {promoteTarget && (
        <PromoteToGoldenModal
          reviewId={reviewId}
          findingIds={promoteTarget}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  );
}

/* ──────────────────── Review Detail ──────────────────── */

function ReviewDetail({
  finding,
  sections,
  isPublished,
  noteText,
  onNoteChange,
  onToggleHidden,
  onChangeSeverity,
  onSaveNote,
  onPromote,
  onRestore,
  isToggling,
  isChangingSeverity,
  isSavingNote,
  isRestoring,
}: {
  finding: any;
  sections: DocSection[];
  isPublished: boolean;
  noteText: string;
  onNoteChange: (v: string) => void;
  onToggleHidden: () => void;
  onChangeSeverity: (severity: string) => void;
  onSaveNote: () => void;
  onPromote: () => void;
  onRestore: () => void;
  isToggling: boolean;
  isChangingSeverity: boolean;
  isSavingNote: boolean;
  isRestoring: boolean;
}) {
  const severity = effectiveSeverity(finding);
  const showOriginal = finding.originalSeverity && finding.originalSeverity !== severity;
  const isFalsePositive = finding.status === "false_positive";

  return (
    <div className="space-y-6 w-full">
      <div className="flex justify-end gap-2">
        {isFalsePositive && (
          <button
            onClick={onRestore}
            disabled={isRestoring}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            title="Находка помечена ложноположительной ошибочно — вернуть на валидацию"
          >
            <RotateCcw className="h-4 w-4" />
            Вернуть на валидацию
          </button>
        )}
        <button
          onClick={onPromote}
          className="inline-flex items-center gap-1.5 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
          title="Перенести находку в эталонный набор"
        >
          <Star className="h-4 w-4" />
          В эталон
        </button>
      </div>

      {(showOriginal || finding.hiddenByReviewer) && (
        <div className="flex items-center gap-2 flex-wrap">
          {showOriginal && (
            <span className="text-xs text-gray-400">
              Алгоритм:{" "}
              <span className="line-through">{SEVERITY_LABELS[finding.originalSeverity] ?? finding.originalSeverity}</span>
            </span>
          )}
          {finding.hiddenByReviewer && (
            <span className="rounded-full bg-red-100 text-red-600 px-2 py-0.5 text-xs font-medium flex items-center gap-1">
              <EyeOff className="h-3 w-3" />
              Скрыт от пользователя (ложное срабатывание)
            </span>
          )}
        </div>
      )}

      <FindingDetailBody finding={finding} sections={sections} />

      {!isPublished && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-5">
          <h3 className="text-sm font-semibold text-gray-700">Действия ревьюера</h3>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Скрыть от конечного пользователя</p>
              <p className="text-xs text-gray-500">Ложноположительный finding не будет показан</p>
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

      {isPublished && finding.reviewerNote && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <p className="text-xs font-semibold text-purple-700 uppercase mb-1">Заметка ревьюера</p>
          <p className="text-sm text-gray-700">{finding.reviewerNote}</p>
        </div>
      )}
    </div>
  );
}
