"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  ListChecks,
  RotateCcw,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type {
  ExpectedFinding,
  GoldenIntraAuditExpected,
  AnnotationDecision,
  CandidateFindingRaw,
  ExpectedSeverity,
  IntraAuditDraft,
} from "./types";
import { SectionContextPanel, type SectionForContext } from "./SectionContextPanel";
import { AddMissingForm } from "./AddMissingForm";

/* ═══════════════ Constants ═══════════════ */

const SEVERITY_LABELS: Record<ExpectedSeverity, string> = {
  critical: "Критическое",
  high: "Высокое",
  medium: "Среднее",
  low: "Низкое",
  info: "Инфо",
};

const SEVERITY_BADGES: Record<ExpectedSeverity, string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-blue-100 text-blue-800",
  info: "bg-gray-100 text-gray-700",
};

const AUTOSAVE_DEBOUNCE_MS = 1500;

/* ═══════════════ Helpers ═══════════════ */

function findingToExpected(f: CandidateFindingRaw): ExpectedFinding {
  const src = (f.sourceRef ?? {}) as { anchorQuote?: string; targetQuote?: string };
  return {
    id: f.id,
    issueFamily: f.issueFamily ?? "UNKNOWN",
    issueType: f.issueType ?? "",
    severity: (f.severity ?? "medium") as ExpectedSeverity,
    anchorZone: f.anchorZone ?? "",
    targetZone: f.targetZone ?? undefined,
    anchorQuote: src.anchorQuote ?? "",
    targetQuote: src.targetQuote,
    description: f.description,
    mustDetect: true,
  };
}

function parseExpected(raw: unknown): GoldenIntraAuditExpected {
  const obj = (raw ?? {}) as Partial<GoldenIntraAuditExpected>;
  return {
    findings: Array.isArray(obj.findings) ? obj.findings : [],
    problems: Array.isArray(obj.problems) ? obj.problems : [],
    coverage: obj.coverage === "partial_by_family" ? "partial_by_family" : "complete",
    mustDetectFamilies: obj.mustDetectFamilies,
    draft: obj.draft && typeof obj.draft === "object" ? obj.draft : { annotations: {} },
  };
}

/** Из CandidateFindingRaw достать severity для UI (либо из колонки, либо из extraAttributes). */
function getSeverity(f: CandidateFindingRaw): ExpectedSeverity {
  const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
  const fromExtra = typeof extra.severity === "string" ? extra.severity : null;
  const value = f.severity ?? fromExtra ?? "medium";
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "info"
  ) {
    return value;
  }
  return "medium";
}

function isDeterministicOrPlaceholder(f: CandidateFindingRaw): boolean {
  const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;
  if (extra.method === "deterministic") return true;
  const fam = (f.issueFamily ?? "").toUpperCase();
  return fam === "PLACEHOLDER" || fam === "EDITORIAL";
}

/* ═══════════════ Main viewer ═══════════════ */

interface Props {
  versionId: string;
  goldenSampleId: string;
  expectedResults?: unknown;
  currentStatus: string;
}

export function IntraAuditViewer({
  versionId,
  goldenSampleId,
  expectedResults,
  currentStatus,
}: Props) {
  const utils = trpc.useUtils();
  const findingsQuery = trpc.processing.listFindings.useQuery(
    { docVersionId: versionId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const sectionsQuery = trpc.audit.getDocumentSections.useQuery(
    { docVersionId: versionId },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );
  const sections = (sectionsQuery.data ?? []) as SectionForContext[];

  // Sprint 2b: expand context panel per finding + add-missing form state
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [addMissingOpen, setAddMissingOpen] = useState(false);

  const initialExpected = useMemo(() => parseExpected(expectedResults), [expectedResults]);
  const [annotations, setAnnotations] = useState<Record<string, AnnotationDecision>>(
    () => {
      const out: Record<string, AnnotationDecision> = {};
      for (const [id, v] of Object.entries(initialExpected.draft?.annotations ?? {})) {
        out[id] = v.decision;
      }
      return out;
    },
  );
  // Сбросить локальный state, когда родитель прислал новый expectedResults
  // (после save mutation invalidate'ит query → нам приходит обновлённый объект).
  useEffect(() => {
    const out: Record<string, AnnotationDecision> = {};
    for (const [id, v] of Object.entries(initialExpected.draft?.annotations ?? {})) {
      out[id] = v.decision;
    }
    setAnnotations(out);
  }, [initialExpected]);

  const [severityFilter, setSeverityFilter] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<"" | AnnotationDecision>("");

  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateStageMutation = trpc.goldenDataset.updateStageStatus.useMutation({
    onMutate: () => {
      setIsSaving(true);
      setSaveError(null);
    },
    onSuccess: () => {
      setIsSaving(false);
      setLastSavedAt(Date.now());
      void utils.goldenDataset.getSample.invalidate({ id: goldenSampleId });
    },
    onError: (err) => {
      setIsSaving(false);
      setSaveError(err.message);
    },
  });

  // Auto-save debounced: каждое изменение annotations → через 1.5s pushim в expectedResults.draft.
  const saveDraft = useCallback(
    (nextAnnotations: Record<string, AnnotationDecision>) => {
      const draft: IntraAuditDraft = {
        annotations: Object.fromEntries(
          Object.entries(nextAnnotations).map(([id, decision]) => [id, { decision }]),
        ),
        manualFindings: initialExpected.draft?.manualFindings ?? [],
      };
      const nextExpected: GoldenIntraAuditExpected = {
        ...initialExpected,
        draft,
      };
      updateStageMutation.mutate({
        goldenSampleId,
        stage: "intra_audit",
        status: currentStatus === "approved" ? "approved" : "in_review",
        expectedResults: nextExpected as unknown as Record<string, unknown>,
      });
    },
    [initialExpected, goldenSampleId, currentStatus, updateStageMutation],
  );

  // Debounce mark — отдельный effect, чтобы не сохранять при mount.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const handle = setTimeout(() => {
      saveDraft(annotations);
      setDirty(false);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [annotations, dirty, saveDraft]);

  const setDecision = useCallback((findingId: string, decision: AnnotationDecision) => {
    setAnnotations((prev) => ({ ...prev, [findingId]: decision }));
    setDirty(true);
  }, []);

  const resetAllUnreviewed = useCallback(() => {
    setAnnotations({});
    setDirty(true);
  }, []);

  // Sprint 2b: add-missing finding handlers (manualFindings in draft)
  const addManualFinding = useCallback(
    (f: ExpectedFinding) => {
      const existing = initialExpected.draft?.manualFindings ?? [];
      const nextManual = [...existing, f];
      const nextExpected: GoldenIntraAuditExpected = {
        ...initialExpected,
        draft: {
          annotations: Object.fromEntries(
            Object.entries(annotations).map(([id, decision]) => [id, { decision }]),
          ),
          manualFindings: nextManual,
        },
      };
      updateStageMutation.mutate({
        goldenSampleId,
        stage: "intra_audit",
        status: currentStatus === "approved" ? "approved" : "in_review",
        expectedResults: nextExpected as unknown as Record<string, unknown>,
      });
      setAddMissingOpen(false);
    },
    [initialExpected, annotations, goldenSampleId, currentStatus, updateStageMutation],
  );

  const removeManualFinding = useCallback(
    (id: string) => {
      const existing = initialExpected.draft?.manualFindings ?? [];
      const nextManual = existing.filter((f) => f.id !== id);
      const nextExpected: GoldenIntraAuditExpected = {
        ...initialExpected,
        draft: {
          annotations: Object.fromEntries(
            Object.entries(annotations).map(([id2, decision]) => [id2, { decision }]),
          ),
          manualFindings: nextManual,
        },
      };
      updateStageMutation.mutate({
        goldenSampleId,
        stage: "intra_audit",
        status: currentStatus === "approved" ? "approved" : "in_review",
        expectedResults: nextExpected as unknown as Record<string, unknown>,
      });
    },
    [initialExpected, annotations, goldenSampleId, currentStatus, updateStageMutation],
  );

  /* ─── Loading / Error / Empty ───────────────────────────── */

  if (findingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <Loader2 size={16} className="mr-2 animate-spin" />
        Загрузка кандидатов...
      </div>
    );
  }
  if (findingsQuery.error) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle size={16} /> {findingsQuery.error.message}
      </div>
    );
  }

  const candidatesAll = (findingsQuery.data ?? []) as CandidateFindingRaw[];
  if (candidatesAll.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400 italic">
        Кандидатов нет — intra-audit ещё не запускался для этой версии документа.
      </p>
    );
  }

  /* ─── Метрики (Sprint 2 — счётчики, не реальные TP/FP/FN) ─ */

  const semanticCount = candidatesAll.filter((c) => !isDeterministicOrPlaceholder(c)).length;
  const acceptedCount = Object.values(annotations).filter((d) => d === "accepted").length;
  const rejectedCount = Object.values(annotations).filter((d) => d === "rejected").length;
  const unreviewedCount = semanticCount - acceptedCount - rejectedCount;

  /* ─── Filters ────────────────────────────────────────────── */

  const severities = Array.from(new Set(candidatesAll.map(getSeverity)));
  const families = Array.from(
    new Set(candidatesAll.map((c) => c.issueFamily).filter((x): x is string => !!x)),
  );
  const zoneSuggestions = Array.from(
    new Set([
      ...candidatesAll.map((c) => c.anchorZone).filter((x): x is string => !!x),
      ...sections.map((s) => s.standardSection).filter((x): x is string => !!x),
    ]),
  ).sort();
  const manualFindings = initialExpected.draft?.manualFindings ?? [];

  const candidates = candidatesAll.filter((c) => {
    if (severityFilter && getSeverity(c) !== severityFilter) return false;
    if (familyFilter && c.issueFamily !== familyFilter) return false;
    const decision = annotations[c.id] ?? "unreviewed";
    if (decisionFilter && decision !== decisionFilter) return false;
    return true;
  });

  /* ─── Approve as expected ───────────────────────────────── */

  const handleApprove = () => {
    const accepted = candidatesAll
      .filter((c) => annotations[c.id] === "accepted")
      .map(findingToExpected);
    const finalExpected: GoldenIntraAuditExpected = {
      ...initialExpected,
      findings: [
        ...accepted,
        ...(initialExpected.draft?.manualFindings ?? []),
      ],
      draft: {
        annotations: Object.fromEntries(
          Object.entries(annotations).map(([id, decision]) => [id, { decision }]),
        ),
        manualFindings: initialExpected.draft?.manualFindings ?? [],
      },
    };
    updateStageMutation.mutate({
      goldenSampleId,
      stage: "intra_audit",
      status: "approved",
      expectedResults: finalExpected as unknown as Record<string, unknown>,
    });
  };

  /* ─── Render ──────────────────────────────────────────────── */

  return (
    <div className="space-y-3">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs">
          <ListChecks size={14} className="text-gray-500" />
          <span className="text-gray-500">Кандидатов:</span>
          <span className="font-semibold text-gray-700">{semanticCount}</span>
          {semanticCount !== candidatesAll.length && (
            <span className="text-gray-400">
              (всего {candidatesAll.length}, deterministic скрыты из метрики)
            </span>
          )}
        </div>
        <div className="h-4 w-px bg-gray-300" />
        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
          ✓ {acceptedCount}
        </span>
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
          ✗ {rejectedCount}
        </span>
        <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
          • {unreviewedCount}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {isSaving ? (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> сохранение…
            </span>
          ) : saveError ? (
            <span className="text-xs text-red-600">⚠ {saveError}</span>
          ) : lastSavedAt ? (
            <span className="text-xs text-gray-400">сохранено</span>
          ) : null}

          <button
            onClick={resetAllUnreviewed}
            disabled={Object.keys(annotations).length === 0 || isSaving}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            title="Очистить все отметки"
          >
            <RotateCcw size={12} className="inline mr-1" /> Сбросить
          </button>

          <button
            onClick={() => setAddMissingOpen((v) => !v)}
            disabled={isSaving}
            className="inline-flex items-center gap-1 rounded border border-purple-300 bg-white px-2 py-1 text-xs text-purple-700 hover:bg-purple-50 disabled:opacity-50"
            title="Разметить finding, пропущенный моделью (будущий FN)"
          >
            <Plus size={12} /> Добавить пропущенное
          </button>

          <button
            onClick={handleApprove}
            disabled={(acceptedCount + manualFindings.length) === 0 || isSaving}
            className="rounded bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Утвердить как эталон ({acceptedCount + manualFindings.length})
          </button>
        </div>
      </div>

      {/* Add-missing form */}
      {addMissingOpen && (
        <AddMissingForm
          zoneSuggestions={zoneSuggestions}
          onCancel={() => setAddMissingOpen(false)}
          onSubmit={addManualFinding}
        />
      )}

      {/* Manual findings list (those added via "Добавить пропущенное") */}
      {manualFindings.length > 0 && (
        <div className="rounded-md border border-purple-200 bg-purple-50/40 p-2">
          <p className="mb-1 text-xs font-medium text-purple-900">
            Вручную добавленные ({manualFindings.length}) — пойдут в эталон при approve
          </p>
          <div className="space-y-1">
            {manualFindings.map((f) => (
              <div
                key={f.id}
                className="flex items-start justify-between gap-2 rounded border border-purple-200 bg-white p-1.5 text-xs"
              >
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-700">
                      {f.issueFamily}
                    </span>
                    {f.issueType && (
                      <span className="rounded bg-slate-50 px-1 py-0.5 font-mono text-[10px] text-slate-600">
                        {f.issueType}
                      </span>
                    )}
                    <span className="rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-700">
                      {f.anchorZone}
                    </span>
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-medium ${SEVERITY_BADGES[f.severity]}`}
                    >
                      {SEVERITY_LABELS[f.severity]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-gray-800">{f.description}</p>
                  <blockquote className="border-l-2 border-purple-300 pl-1 italic text-gray-600">
                    «{f.anchorQuote}»
                  </blockquote>
                </div>
                <button
                  onClick={() => removeManualFinding(f.id)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                  title="Удалить из эталона"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="">Все уровни</option>
          {severities.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s as ExpectedSeverity] ?? s}
            </option>
          ))}
        </select>
        <select
          value={familyFilter}
          onChange={(e) => setFamilyFilter(e.target.value)}
          className="rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="">Все семейства</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value as "" | AnnotationDecision)}
          className="rounded border border-gray-200 px-2 py-1 text-xs"
        >
          <option value="">Все статусы</option>
          <option value="unreviewed">Не размечено</option>
          <option value="accepted">Принято</option>
          <option value="rejected">Отклонено</option>
        </select>
        <span className="text-gray-400">{candidates.length} в списке</span>
      </div>

      {/* List */}
      <div className="max-h-[600px] space-y-2 overflow-y-auto">
        {candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            decision={annotations[c.id] ?? "unreviewed"}
            onSetDecision={(d) => setDecision(c.id, d)}
            excludedFromMetric={isDeterministicOrPlaceholder(c)}
            sections={sections}
            sectionsLoading={sectionsQuery.isLoading}
            expanded={expandedFindingId === c.id}
            onToggleExpand={() =>
              setExpandedFindingId(expandedFindingId === c.id ? null : c.id)
            }
          />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════ Candidate card ═══════════════ */

function CandidateCard({
  candidate,
  decision,
  onSetDecision,
  excludedFromMetric,
  sections,
  sectionsLoading,
  expanded,
  onToggleExpand,
}: {
  candidate: CandidateFindingRaw;
  decision: AnnotationDecision;
  onSetDecision: (d: AnnotationDecision) => void;
  excludedFromMetric: boolean;
  sections: SectionForContext[];
  sectionsLoading: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const severity = getSeverity(candidate);
  const src = (candidate.sourceRef ?? {}) as { anchorQuote?: string; targetQuote?: string };
  const accepted = decision === "accepted";
  const rejected = decision === "rejected";

  return (
    <div
      className={`rounded-md border p-3 text-sm transition-colors ${
        accepted
          ? "border-green-300 bg-green-50/60"
          : rejected
            ? "border-red-300 bg-red-50/60"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_BADGES[severity]}`}
          >
            {SEVERITY_LABELS[severity]}
          </span>
          {candidate.issueFamily && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              {candidate.issueFamily}
            </span>
          )}
          {candidate.issueType && (
            <span className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              {candidate.issueType}
            </span>
          )}
          {candidate.anchorZone && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
              {candidate.anchorZone}
              {candidate.targetZone ? ` → ${candidate.targetZone}` : ""}
            </span>
          )}
          {excludedFromMetric && (
            <span
              className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600"
              title="placeholder/deterministic — не учитывается в f1 (вариант A)"
            >
              det/placeholder
            </span>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            onClick={onToggleExpand}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            title={expanded ? "Скрыть контекст" : "Показать секцию с подсветкой quote"}
          >
            {expanded ? <EyeOff size={12} className="inline" /> : <Eye size={12} className="inline" />}
            <span className="ml-1">Контекст</span>
          </button>
          <button
            onClick={() => onSetDecision(accepted ? "unreviewed" : "accepted")}
            disabled={excludedFromMetric}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              accepted
                ? "border-green-500 bg-green-500 text-white"
                : "border-gray-300 text-gray-600 hover:border-green-400 hover:text-green-600"
            } disabled:opacity-30`}
            title={excludedFromMetric ? "Эти findings игнорируются метрикой" : "Принять (TP)"}
          >
            <CheckCircle2 size={12} className="inline mr-0.5" /> Accept
          </button>
          <button
            onClick={() => onSetDecision(rejected ? "unreviewed" : "rejected")}
            disabled={excludedFromMetric}
            className={`rounded border px-2 py-0.5 text-xs transition-colors ${
              rejected
                ? "border-red-500 bg-red-500 text-white"
                : "border-gray-300 text-gray-600 hover:border-red-400 hover:text-red-600"
            } disabled:opacity-30`}
            title={excludedFromMetric ? "Эти findings игнорируются метрикой" : "Отклонить (FP)"}
          >
            <XCircle size={12} className="inline mr-0.5" /> Reject
          </button>
        </div>
      </div>

      <p className="mb-1 text-sm text-gray-800">{candidate.description}</p>

      {src.anchorQuote && (
        <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-xs italic text-gray-600">
          «{src.anchorQuote}»
          {src.targetQuote && (
            <>
              <br />
              <span className="text-gray-400">→</span> «{src.targetQuote}»
            </>
          )}
        </blockquote>
      )}

      {candidate.suggestion && (
        <p className="mt-1 text-xs text-gray-500">
          <span className="font-medium">Suggestion:</span> {candidate.suggestion}
        </p>
      )}

      {expanded && (
        <SectionContextPanel
          sections={sections}
          isLoading={sectionsLoading}
          anchorZone={candidate.anchorZone ?? null}
          anchorQuote={src.anchorQuote ?? null}
          targetZone={candidate.targetZone ?? null}
          targetQuote={src.targetQuote ?? null}
        />
      )}
    </div>
  );
}
