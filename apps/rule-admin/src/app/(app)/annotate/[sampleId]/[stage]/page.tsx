"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Send,
  Keyboard,
  CheckCircle2,
  CircleSlash,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ZoneSelector } from "./ZoneSelector";

/* ═══════════════ Types ═══════════════ */

interface Section {
  id: string;
  title: string;
  standardSection: string | null;
  confidence: number | null;
  classifiedBy: string | null;
  level: number;
  order: number;
  isFalseHeading?: boolean;
}

type AnnotationStatusUI = "pending" | "accepted" | "changed" | "question" | "answered";

/* ═══════════════ Helpers ═══════════════ */

// sectionKey формат должен совпадать с тем что ожидает annotation service.
// Для classification stage сейчас используется (title.lower().trim()).
// Для других стадий — оставляем тот же формат (title) чтобы не усложнять.
function sectionKeyFor(_stage: string, section: Section): string {
  return section.title.trim().toLowerCase();
}

function formatConfidence(c: number | null) {
  if (c === null || c === undefined) return "—";
  return `${(c * 100).toFixed(0)}%`;
}

const CONFIDENCE_COLOR = (c: number | null) =>
  c === null ? "text-gray-500"
    : c >= 0.85 ? "text-green-700"
    : c >= 0.6 ? "text-blue-700"
    : c >= 0.3 ? "text-amber-700"
    : "text-red-700";

const STATUS_BADGE: Record<AnnotationStatusUI, { bg: string; text: string; label: string; icon: LucideIcon }> = {
  pending: { bg: "bg-gray-100", text: "text-gray-600", label: "Ожидает", icon: CircleSlash },
  accepted: { bg: "bg-green-50", text: "text-green-700", label: "Принято", icon: CheckCircle2 },
  changed: { bg: "bg-blue-50", text: "text-blue-700", label: "Изменено", icon: Check },
  question: { bg: "bg-amber-50", text: "text-amber-700", label: "Вопрос", icon: HelpCircle },
  answered: { bg: "bg-purple-50", text: "text-purple-700", label: "Решено", icon: CheckCircle2 },
};

/* ═══════════════ Page ═══════════════ */

export default function AnnotatePage() {
  const params = useParams<{ sampleId: string; stage: string }>();
  const router = useRouter();
  const sampleId = params.sampleId;
  const stage = params.stage;

  /* ───── Data ───── */
  const sampleQuery = trpc.goldenDataset.getSample.useQuery(
    { id: sampleId },
    { enabled: Boolean(sampleId) },
  );
  const versionId = sampleQuery.data?.documents?.[0]?.documentVersion?.id;
  const versionQuery = trpc.document.getVersion.useQuery(
    { versionId: versionId as string },
    { enabled: Boolean(versionId) },
  );
  const taxonomyQuery = trpc.document.getTaxonomy.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
  });
  const annotationsQuery = trpc.annotation.list.useQuery(
    { goldenSampleId: sampleId, stage },
    { enabled: Boolean(sampleId) },
  );
  const progressQuery = trpc.annotation.progress.useQuery(
    { goldenSampleId: sampleId, stage },
    { enabled: Boolean(sampleId) },
  );

  /* ───── Mutations ───── */
  const utils = trpc.useUtils();
  const submitMut = trpc.annotation.submit.useMutation({
    onSuccess: () => {
      utils.annotation.list.invalidate({ goldenSampleId: sampleId, stage });
      utils.annotation.progress.invalidate({ goldenSampleId: sampleId, stage });
    },
  });
  const finalizeMut = trpc.annotation.finalizeForReview.useMutation({
    onSuccess: () => {
      utils.annotation.list.invalidate({ goldenSampleId: sampleId, stage });
      utils.annotation.progress.invalidate({ goldenSampleId: sampleId, stage });
      utils.goldenDataset.getSample.invalidate({ id: sampleId });
    },
  });

  /* ───── Local UI state ───── */
  const [activeIndex, setActiveIndex] = useState(0);
  const [zoneOverride, setZoneOverride] = useState<string>("");
  const [questionMode, setQuestionMode] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [filterMode, setFilterMode] = useState<"all" | "pending" | "questions">("all");

  // Skip sections marked isFalseHeading=true at parsing stage — они не часть
  // структуры документа и не должны попадать в annotation workflow.
  const sections: Section[] = useMemo(() => {
    const all = (versionQuery.data?.sections ?? []) as Section[];
    return all.filter((s) => !s.isFalseHeading);
  }, [versionQuery.data?.sections]);

  /* ───── Annotation map by sectionKey ───── */
  const annotationMap = useMemo(() => {
    const m = new Map<string, {
      id: string;
      proposedZone: string | null;
      isQuestion: boolean;
      questionText: string | null;
      status: string;
      decision: { finalZone: string; rationale: string | null } | null;
    }>();
    for (const a of annotationsQuery.data ?? []) {
      m.set(a.sectionKey, {
        id: a.id,
        proposedZone: a.proposedZone,
        isQuestion: a.isQuestion,
        questionText: a.questionText,
        status: a.status,
        decision: a.decision
          ? { finalZone: a.decision.finalZone, rationale: a.decision.rationale }
          : null,
      });
    }
    return m;
  }, [annotationsQuery.data]);

  function uiStatusForSection(s: Section): AnnotationStatusUI {
    const key = sectionKeyFor(stage, s);
    const a = annotationMap.get(key);
    if (!a) return "pending";
    if (a.isQuestion) return a.decision ? "answered" : "question";
    if (a.proposedZone === s.standardSection) return "accepted";
    return "changed";
  }

  /* ───── Filtered sections ───── */
  const filteredSections = useMemo(() => {
    if (filterMode === "all") return sections;
    if (filterMode === "pending") {
      return sections.filter((s) => uiStatusForSection(s) === "pending");
    }
    if (filterMode === "questions") {
      return sections.filter((s) => {
        const st = uiStatusForSection(s);
        return st === "question" || st === "answered";
      });
    }
    return sections;
  }, [sections, filterMode, annotationMap]);

  // Keep activeIndex within bounds when filtered list changes.
  useEffect(() => {
    if (activeIndex >= filteredSections.length) setActiveIndex(0);
  }, [filteredSections.length, activeIndex]);

  const activeSection = filteredSections[activeIndex];
  const activeKey = activeSection ? sectionKeyFor(stage, activeSection) : null;
  const activeAnnotation = activeKey ? annotationMap.get(activeKey) : null;

  /* ───── Reset question / override on section change ─────
   *
   * Триггерим по activeSection.id (не activeAnnotation?.id — он undefined для
   * непрорезюмированных секций, и тогда переход между такими секциями не
   * приводил к ре-инициализации zoneOverride). Также перечитываем при изменении
   * standardSection и proposedZone, чтобы свежие данные с server подтянулись. */
  useEffect(() => {
    if (!activeSection) return;
    setQuestionMode(false);
    setQuestionText(activeAnnotation?.questionText ?? "");
    setZoneOverride(activeAnnotation?.proposedZone ?? activeSection.standardSection ?? "");
  }, [
    activeSection?.id,
    activeSection?.standardSection,
    activeAnnotation?.proposedZone,
    activeAnnotation?.questionText,
  ]);

  /* ───── Action handlers ───── */
  const submit = useCallback(
    async (overrides: { zone?: string; question?: boolean; questionText?: string }) => {
      if (!activeSection) return;
      const isQ = overrides.question ?? questionMode;
      const zone = overrides.zone ?? zoneOverride;
      const qText = overrides.questionText ?? questionText;
      try {
        await submitMut.mutateAsync({
          goldenSampleId: sampleId,
          stage,
          sectionKey: sectionKeyFor(stage, activeSection),
          proposedZone: isQ ? undefined : zone,
          isQuestion: isQ,
          questionText: isQ ? qText : undefined,
        });
        // Auto-advance to next section
        if (activeIndex < filteredSections.length - 1) {
          setActiveIndex((i) => i + 1);
        }
      } catch (err) {
        // toast uses centralized error handler — для MVP просто alert
         
        alert(`Ошибка сохранения: ${(err as Error).message}`);
      }
    },
    [
      activeSection,
      sampleId,
      stage,
      zoneOverride,
      questionMode,
      questionText,
      submitMut,
      activeIndex,
      filteredSections.length,
    ],
  );

  const handleAccept = () => {
    if (!activeSection?.standardSection) return;
    submit({ zone: activeSection.standardSection, question: false });
  };

  const handleChange = () => {
    if (!zoneOverride) return;
    submit({ zone: zoneOverride, question: false });
  };

  const handleAskQuestion = () => {
    if (!questionText.trim()) {
      setQuestionMode(true);
      return;
    }
    submit({ question: true, questionText });
  };

  /* ───── Hotkeys ───── */
  const hotkeyHandler = useRef<(e: KeyboardEvent) => void>();
  hotkeyHandler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      return;
    }
    if (e.key === "y" || e.key === "Y") {
      e.preventDefault();
      handleAccept();
    } else if (e.key === "q" || e.key === "Q") {
      e.preventDefault();
      setQuestionMode((v) => !v);
    } else if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredSections.length - 1));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "?") {
      e.preventDefault();
      setShowHotkeys((v) => !v);
    }
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => hotkeyHandler.current?.(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  /* ───── Finalize ───── */
  const handleFinalize = async () => {
    if (!confirm("Отправить разметку на проверку эксперту? После этого редактирование станет ограниченным.")) return;
    try {
      const res = await finalizeMut.mutateAsync({ goldenSampleId: sampleId, stage });
      alert(`Готово. Финализировано: ${res.finalizedCount}, осталось вопросов: ${res.pendingQuestionsCount}`);
    } catch (err) {
      alert(`Ошибка: ${(err as Error).message}`);
    }
  };

  /* ───── Loading / error ───── */
  if (sampleQuery.isLoading || versionQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (sampleQuery.error || versionQuery.error) {
    return (
      <div className="flex h-screen items-center justify-center text-red-600">
        <AlertCircle className="mr-2" />
        Ошибка загрузки sample
      </div>
    );
  }
  if (!versionId) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-600">
        Sample не имеет привязанного документа
      </div>
    );
  }

  const progress = progressQuery.data ?? { open: 0, answered: 0, finalized: 0, openQuestions: 0 };
  const totalAnnotated = (progress.open ?? 0) + (progress.answered ?? 0) + (progress.finalized ?? 0);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/golden-dataset/${sampleId}`)}
            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} /> К sample
          </button>
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {sampleQuery.data?.name}
            </div>
            <div className="text-xs text-gray-500">
              Этап: <span className="font-medium">{stage}</span> · Размечено {totalAnnotated} из {sections.length} ·
              Вопросов: {progress.openQuestions}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHotkeys(true)}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100"
            title="Горячие клавиши"
          >
            <Keyboard size={16} />
          </button>
          <button
            onClick={handleFinalize}
            disabled={finalizeMut.isPending || totalAnnotated === 0}
            className="flex items-center gap-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {finalizeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Отправить на проверку
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: section list */}
        <aside className="flex w-80 flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center gap-1 border-b border-gray-200 p-2 text-xs">
            {(["all", "pending", "questions"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setFilterMode(m)}
                className={`rounded px-2 py-1 ${
                  filterMode === m ? "bg-brand-100 text-brand-700" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {m === "all" ? "Все" : m === "pending" ? "Ожидают" : "Вопросы"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredSections.map((s, idx) => {
              const status = uiStatusForSection(s);
              const badge = STATUS_BADGE[status];
              const Icon = badge.icon;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveIndex(idx)}
                  className={`flex w-full items-start gap-2 border-b border-gray-100 px-3 py-2 text-left text-xs hover:bg-gray-50 ${
                    isActive ? "bg-brand-50" : ""
                  }`}
                  style={{ paddingLeft: 8 + Math.max(0, s.level - 1) * 12 }}
                >
                  <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 ${badge.bg} ${badge.text}`}>
                    <Icon size={10} />
                  </span>
                  <span className="line-clamp-2 flex-1 text-gray-800">{s.title}</span>
                </button>
              );
            })}
            {filteredSections.length === 0 && (
              <div className="p-6 text-center text-xs text-gray-400">Нет секций</div>
            )}
          </div>
        </aside>

        {/* Right: section detail + actions */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          {!activeSection ? (
            <div className="flex flex-1 items-center justify-center text-gray-400">
              Выбери секцию слева
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl p-6">
              <div className="mb-4 flex items-center justify-between text-xs text-gray-500">
                <span>Секция {activeIndex + 1} из {filteredSections.length}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setActiveIndex((i) => Math.max(i - 1, 0))}
                    disabled={activeIndex === 0}
                    className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => setActiveIndex((i) => Math.min(i + 1, filteredSections.length - 1))}
                    disabled={activeIndex >= filteredSections.length - 1}
                    className="rounded p-1 hover:bg-gray-100 disabled:opacity-30"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>

              <h1 className="text-lg font-semibold text-gray-900">{activeSection.title}</h1>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                <span>Level {activeSection.level}</span>
                <span>·</span>
                <span>Order {activeSection.order}</span>
              </div>

              {/* Predicted zone */}
              <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Предсказание алгоритма
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <code className="rounded bg-gray-100 px-2 py-1 font-mono text-sm">
                    {activeSection.standardSection ?? "—"}
                  </code>
                  <span className={`text-xs ${CONFIDENCE_COLOR(activeSection.confidence)}`}>
                    confidence: {formatConfidence(activeSection.confidence)}
                  </span>
                  {activeSection.classifiedBy && (
                    <span className="text-xs text-gray-400">via {activeSection.classifiedBy}</span>
                  )}
                </div>
              </div>

              {/* Existing annotation indicator */}
              {activeAnnotation && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  Уже размечено: {activeAnnotation.isQuestion
                    ? <>вопрос — «{activeAnnotation.questionText}»</>
                    : <>зона <code className="rounded bg-white px-1">{activeAnnotation.proposedZone}</code></>}
                  {activeAnnotation.decision && (
                    <div className="mt-1">
                      Решение эксперта: <code className="rounded bg-white px-1">{activeAnnotation.decision.finalZone}</code>
                      {activeAnnotation.decision.rationale && (
                        <div className="mt-1 italic">«{activeAnnotation.decision.rationale}»</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Action panel */}
              {!questionMode ? (
                <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Твоя зона
                  </div>
                  <ZoneSelector
                    rules={taxonomyQuery.data ?? []}
                    value={zoneOverride}
                    onChange={setZoneOverride}
                    placeholder="— выбери зону —"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={handleAccept}
                      disabled={!activeSection.standardSection || submitMut.isPending}
                      className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
                    >
                      <Check size={14} /> Принять предсказание (Y)
                    </button>
                    <button
                      onClick={handleChange}
                      disabled={!zoneOverride || zoneOverride === activeSection.standardSection || submitMut.isPending}
                      className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      <X size={14} /> Изменить
                    </button>
                    <button
                      onClick={() => setQuestionMode(true)}
                      className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                    >
                      <HelpCircle size={14} /> Вопрос эксперту (Q)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-800">
                    Вопрос эксперту
                  </div>
                  <textarea
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                    rows={3}
                    placeholder="Опиши, что именно непонятно. Эксперт даст финальное решение."
                    className="w-full rounded border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={handleAskQuestion}
                      disabled={!questionText.trim() || submitMut.isPending}
                      className="flex items-center gap-1 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                    >
                      <Send size={14} /> Отправить вопрос
                    </button>
                    <button
                      onClick={() => setQuestionMode(false)}
                      className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Hotkeys modal */}
      {showHotkeys && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowHotkeys(false)}
        >
          <div className="w-96 rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Горячие клавиши</h3>
              <button onClick={() => setShowHotkeys(false)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
            <ul className="space-y-1 text-sm">
              <li><kbd className="rounded border bg-gray-100 px-1">Y</kbd> — принять предсказание</li>
              <li><kbd className="rounded border bg-gray-100 px-1">Q</kbd> — переключить режим «вопрос»</li>
              <li><kbd className="rounded border bg-gray-100 px-1">↑/k</kbd> — предыдущая секция</li>
              <li><kbd className="rounded border bg-gray-100 px-1">↓/j</kbd> — следующая секция</li>
              <li><kbd className="rounded border bg-gray-100 px-1">?</kbd> — это окно</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
