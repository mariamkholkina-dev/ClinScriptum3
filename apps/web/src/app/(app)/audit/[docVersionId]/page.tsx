"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  RefreshCw,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Eye,
  Shield,
  RotateCcw,
  FileText,
  Clock,
} from "lucide-react";
import { openInWord } from "@/lib/open-in-word";

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

const STATUS_LABELS: Record<string, string> = {
  pending: "К валидации",
  false_positive: "Ложное срабатывание",
  resolved: "Исправлено",
  rejected: "Игнорировать",
  confirmed: "Подтверждено",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  false_positive: "bg-purple-100 text-purple-700",
  resolved: "bg-green-100 text-green-700",
  rejected: "bg-gray-100 text-gray-500",
  confirmed: "bg-blue-100 text-blue-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  consistency: "Согласованность",
  logic: "Логика",
  terminology: "Терминология",
  compliance: "Соответствие",
  grammar: "Редакторское",
};

const TYPE_LABELS: Record<string, string> = {
  editorial: "Редакторская",
  semantic: "Семантическая",
  intra_audit: "Внутренний аудит",
  inter_audit: "Межд. аудит",
};

const TASK_KIND_LABELS: Record<string, string> = {
  self_check: "Внутренняя проверка",
  cross_check: "Перекрёстная проверка",
  self_editorial: "Редакторская проверка",
};

const CONFIDENCE_LABELS: Record<string, { label: string; cls: string }> = {
  High: { label: "Высокая", cls: "text-green-700" },
  Medium: { label: "Средняя", cls: "text-amber-600" },
  Low: { label: "Низкая", cls: "text-red-500" },
};

const QA_VERDICT_LABELS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "Подтверждено QA", cls: "bg-green-100 text-green-800" },
  dismissed: { label: "Отклонено QA", cls: "bg-red-100 text-red-700" },
  adjusted: { label: "Скорректировано QA", cls: "bg-amber-100 text-amber-800" },
  deduplicated: { label: "Дубликат", cls: "bg-gray-200 text-gray-600" },
};

const ZONE_LABELS: Record<string, string> = {
  synopsis: "Синопсис",
  study_design: "Дизайн исследования",
  study_objectives: "Цели исследования",
  study_population: "Популяция",
  treatments: "Лечение / ИП",
  efficacy_assessments: "Оценка эффективности",
  safety_assessments: "Оценка безопасности",
  statistics: "Статистика",
  schedule_of_assessments: "График процедур (SoA)",
  ethics: "Этика",
  appendices: "Приложения",
  __unclassified__: "Без классификации",
};

function getZoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone;
}

const METHOD_LABELS: Record<string, string> = {
  deterministic: "Детерм.",
  llm: "LLM",
};

function parseJsonDescription(desc: string): Record<string, unknown> | null {
  if (!desc || !desc.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(desc);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  return null;
}

const ISSUE_FAMILY_LABELS: Record<string, string> = {
  PLACEHOLDER: "Плейсхолдер",
  NUMERIC: "Числовое",
  MISSINGNESS: "Пропуск",
  RANGE_CONSISTENCY: "Диапазон",
  EDITORIAL: "Редакторское",
  TIMING_SCHEDULE: "Расписание",
  IP_DOSING: "Дозирование",
  POPULATION_ELIGIBILITY: "Популяция",
  ENDPOINTS_ANALYSIS: "Конечные точки",
  SAFETY_REPORTING: "Безопасность",
  RANDOMIZATION: "Рандомизация",
  BLINDING_UNBLINDING: "Ослепление",
  CROSSREF: "Перекр. ссылка",
  DUPLICATION_CONFLICT: "Дублирование",
  TEXT_CONTRADICTION: "Противоречие",
};

function extractFindingMeta(finding: any) {
  const extra = (finding.extraAttributes ?? {}) as Record<string, unknown>;
  const ref = (finding.sourceRef ?? {}) as Record<string, unknown>;
  const jsonDesc = parseJsonDescription(finding.description ?? "");

  const description = jsonDesc
    ? (jsonDesc.description as string) ?? finding.description
    : finding.description;

  return {
    description,
    severity: (extra.severity as string) ?? (jsonDesc?.severity as string) ?? (finding.severity as string) ?? "info",
    issueType: (extra.issueType as string) ?? (jsonDesc?.issue_type as string) ?? (finding.issueType as string) ?? null,
    issueFamily: (extra.issueFamily as string) ?? (finding.issueFamily as string) ?? null,
    auditCategory: (extra.auditCategory as string) ?? (finding.auditCategory as string) ?? null,
    taskKind: (extra.taskKind as string) ?? (ref.taskKind as string) ?? (jsonDesc?.mode as string) ?? null,
    method: (extra.method as string) ?? null,
    confidence: (extra.confidence as string) ?? (jsonDesc?.confidence as string) ?? undefined,
    contextStatus: (extra.contextStatus as string) ?? (jsonDesc?.context_status as string) ?? undefined,
    qaVerdict: extra.qaVerdict as string | undefined,
    qaReason: extra.qaReason as string | undefined,
    editorialFix: (extra.editorialFix as string) ?? (jsonDesc?.editorial_fix_suggestion as string) ?? undefined,
    block: (extra.block as string) ?? (jsonDesc?.block as string) ?? undefined,
    field: (extra.field as string) ?? (jsonDesc?.field as string) ?? undefined,
    suggestion: (finding.suggestion as string) ?? (jsonDesc?.recommendation as string) ?? (jsonDesc?.suggestion as string) ?? null,
    textSnippet: (ref.textSnippet as string) ?? (jsonDesc?.target_quote as string) ?? (jsonDesc?.source as string) ?? undefined,
    referenceQuote: (ref.referenceQuote as string) ?? (jsonDesc?.reference_quote as string) ?? undefined,
    anchorQuote: ref.anchorQuote as string | undefined,
    targetQuote: ref.targetQuote as string | undefined,
    sectionTitle: ref.sectionTitle as string | undefined,
    zone: (ref.zone as string) ?? (finding.targetZone as string) ?? null,
    anchorZone: (ref.anchorZone as string) ?? (finding.anchorZone as string) ?? null,
    type: finding.type as string,
  };
}

/* ──────────────────── Main Page ──────────────────── */

export default function IntraAuditPage() {
  const { docVersionId } = useParams<{ docVersionId: string }>();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [auditStarted, setAuditStarted] = useState(false);

  const statusQuery = trpc.audit.getAuditStatus.useQuery(
    { docVersionId },
    { refetchInterval: (data) => (data?.state?.data?.isRunning ? 3000 : false) }
  );

  const findingsQuery = trpc.audit.getAuditFindings.useQuery(
    {
      docVersionId,
      severity: severityFilter !== "all" ? (severityFilter as any) : undefined,
    },
    { enabled: !statusQuery.data?.isRunning }
  );

  const sectionsQuery = trpc.audit.getDocumentSections.useQuery({ docVersionId });

  const startAudit = trpc.audit.startIntraAudit.useMutation({
    onSuccess: () => {
      setAuditStarted(true);
      statusQuery.refetch();
    },
  });

  const updateStatus = trpc.audit.updateAuditFindingStatus.useMutation({
    onSuccess: () => findingsQuery.refetch(),
  });

  const validateAll = trpc.audit.validateAllAuditFindings.useMutation({
    onSuccess: () => findingsQuery.refetch(),
  });

  useEffect(() => {
    if (
      statusQuery.data &&
      !statusQuery.data.isRunning &&
      statusQuery.data.totalFindings === 0 &&
      statusQuery.data.runStatus !== "completed" &&
      statusQuery.data.runStatus !== "failed" &&
      !auditStarted
    ) {
      startAudit.mutate({ docVersionId });
    }
  }, [statusQuery.data?.isRunning, statusQuery.data?.totalFindings, statusQuery.data?.runStatus]);

  useEffect(() => {
    if (statusQuery.data && !statusQuery.data.isRunning && auditStarted) {
      findingsQuery.refetch();
    }
  }, [statusQuery.data?.isRunning]);

  const handleRerunAudit = () => {
    setAuditStarted(true);
    startAudit.mutate({ docVersionId });
  };

  const handleExport = async () => {
    const { useAuthStore } = await import("@/lib/auth-store");
    const token = useAuthStore.getState().accessToken;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace("/trpc", "");
    const res = await fetch(`${apiUrl}/api/audit-report/${docVersionId}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)/)?.[1]
      ? decodeURIComponent(res.headers.get("content-disposition")!.match(/filename\*=UTF-8''(.+)/)![1])
      : "audit-report.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const allFindings = findingsQuery.data?.findings ?? [];
  const findings = categoryFilter === "all"
    ? allFindings
    : allFindings.filter((f) => {
        const extra = (f.extraAttributes as Record<string, unknown>) ?? {};
        const cat = (extra.auditCategory as string) ?? (f as any).auditCategory ?? "";
        return cat === categoryFilter;
      });
  const docTitle = findingsQuery.data?.documentTitle ?? "Документ";
  const versionLabel = findingsQuery.data?.versionLabel ?? "";
  const isRunning = statusQuery.data?.isRunning ?? false;
  const operatorReviewEnabled = statusQuery.data?.operatorReviewEnabled ?? false;
  const reviewPending = operatorReviewEnabled && (findingsQuery.data as any)?.reviewPending === true;
  const reviewStatus = statusQuery.data?.reviewStatus ?? null;

  const selectedFinding = findings.find((f) => f.id === selectedFindingId);

  const relevantSections = selectedFinding
    ? (sectionsQuery.data ?? []).filter((s) => {
        const ref = (selectedFinding.sourceRef ?? {}) as Record<string, unknown>;
        const zones = [
          selectedFinding.anchorZone,
          selectedFinding.targetZone,
          ref.zone,
          ref.anchorZone,
        ].filter((z): z is string => typeof z === "string" && z.length > 0);
        if (zones.length > 0) {
          return zones.some((z) => s.standardSection?.startsWith(z));
        }
        if (ref.sectionTitle) {
          return s.title.toLowerCase().includes(String(ref.sectionTitle).toLowerCase());
        }
        return false;
      })
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex-none border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/studies" className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <div className="flex items-center gap-1.5 text-sm text-gray-400">
                <span>ClinNexus</span>
                <ChevronRight className="h-3 w-3" />
                <span>{docTitle} {versionLabel}</span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-gray-600 font-medium">Внутридокументный аудит</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">Внутридокументный аудит</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRerunAudit}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", isRunning && "animate-spin")} />
              Запустить повторный аудит
            </button>
            <button
              onClick={() => openInWord({ docVersionId, mode: "intra_audit" })}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              Открыть в Word
            </button>
            <button
              onClick={handleExport}
              disabled={isRunning || findings.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Выгрузить отчёт
            </button>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isRunning && (
        <div className="flex-none bg-blue-50 border-b border-blue-200 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Выполняется анализ документа... Результаты появятся автоматически.
          </div>
        </div>
      )}

      {/* Review pending banner */}
      {reviewPending && !isRunning && (
        <div className="flex-none bg-amber-50 border-b border-amber-200 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-700">
            <Clock className="h-4 w-4" />
            Результаты аудита на проверке у специалиста. Findings будут доступны после публикации.
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel: Findings */}
        <div className="w-[480px] flex-none border-r flex flex-col bg-gray-50">
          {/* Filters */}
          <div className="flex-none p-4 space-y-2 border-b bg-white">
            <div className="flex gap-2">
              <select
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все серьёзности</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="info">Info</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все категории</option>
                <option value="consistency">Согласованность</option>
                <option value="logic">Логика</option>
                <option value="terminology">Терминология</option>
                <option value="compliance">Соответствие</option>
                <option value="grammar">Редакторское</option>
              </select>
            </div>
            {findings.length > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{findings.length} находок</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => validateAll.mutate({ docVersionId, action: "resolve" })}
                    className="text-xs text-green-600 hover:underline"
                  >
                    Всё исправлено
                  </button>
                  <span className="text-xs text-gray-300">|</span>
                  <button
                    onClick={() => validateAll.mutate({ docVersionId, action: "reject" })}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    Всё игнорировать
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Findings list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {findings.length === 0 && !isRunning && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Shield className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Нет находок</p>
              </div>
            )}

            {findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                isSelected={finding.id === selectedFindingId}
                onSelect={() => setSelectedFindingId(finding.id === selectedFindingId ? null : finding.id)}
                onUpdateStatus={(status: "pending" | "confirmed" | "rejected" | "resolved" | "false_positive") =>
                  updateStatus.mutate({ findingId: finding.id, status })
                }
              />
            ))}
          </div>
        </div>

        {/* Right Panel: Document sections */}
        <div className="flex-1 overflow-y-auto bg-white p-6">
          {!selectedFinding ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Eye className="h-16 w-16 mb-4" />
              <p className="text-lg">Выберите находку для просмотра контекста</p>
              <p className="text-sm mt-1">Нажмите на карточку находки в левой панели</p>
            </div>
          ) : (
            <FindingDetail
              finding={selectedFinding}
              sections={relevantSections}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Finding Card ──────────────────── */

type AuditStatus = "pending" | "confirmed" | "rejected" | "resolved" | "false_positive";

function FindingCard({
  finding,
  isSelected,
  onSelect,
  onUpdateStatus,
}: {
  finding: any;
  isSelected: boolean;
  onSelect: () => void;
  onUpdateStatus: (status: AuditStatus) => void;
}) {
  const m = extractFindingMeta(finding);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-lg border bg-white p-3 cursor-pointer transition-all border-l-4",
        SEVERITY_BORDER[m.severity] ?? "border-l-gray-300",
        isSelected
          ? "ring-2 ring-brand-400 shadow-md"
          : "hover:shadow-sm"
      )}
    >
      {/* Row 1: badges */}
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase shrink-0", SEVERITY_STYLES[m.severity])}>
          {SEVERITY_LABELS[m.severity]}
        </span>
        {m.method && (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0",
            m.method === "deterministic" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
          )}>
            {METHOD_LABELS[m.method] ?? m.method}
          </span>
        )}
        {m.taskKind && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {TASK_KIND_LABELS[m.taskKind] ?? m.taskKind}
          </span>
        )}
        {m.issueFamily && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shrink-0">
            {ISSUE_FAMILY_LABELS[m.issueFamily] ?? m.issueFamily}
          </span>
        )}
        {m.qaVerdict && QA_VERDICT_LABELS[m.qaVerdict] && (
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", QA_VERDICT_LABELS[m.qaVerdict].cls)}>
            {QA_VERDICT_LABELS[m.qaVerdict].label}
          </span>
        )}
        <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0", STATUS_STYLES[finding.status] ?? "bg-gray-100 text-gray-500")}>
          {STATUS_LABELS[finding.status] ?? finding.status}
        </span>
      </div>

      {/* Row 2: description */}
      <p className="text-sm font-medium text-gray-900 line-clamp-3">{m.description}</p>

      {/* Row 3: suggestion preview */}
      {m.suggestion && (
        <p className="mt-1 text-xs text-green-700 line-clamp-2">
          <span className="font-medium">→</span> {m.suggestion}
        </p>
      )}

      {/* Row 4: zones */}
      {(m.zone || m.anchorZone) && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
          {m.anchorZone && <span className="font-medium">{getZoneLabel(m.anchorZone)}</span>}
          {m.anchorZone && m.zone && <span>→</span>}
          {m.zone && <span className="font-medium">{getZoneLabel(m.zone)}</span>}
        </div>
      )}

      {/* Row 5: quote preview */}
      {m.textSnippet && (
        <p className="mt-1 text-[11px] text-gray-400 italic line-clamp-1">
          «{m.textSnippet}»
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
        {finding.status === "false_positive" && (
          <button onClick={() => onUpdateStatus("pending")} className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
            <RotateCcw className="h-3 w-3" /> К валидации
          </button>
        )}
        {finding.status === "pending" && (
          <>
            <button onClick={() => onUpdateStatus("resolved")} className="text-xs text-green-600 hover:underline flex items-center gap-0.5">
              <CheckCircle2 className="h-3 w-3" /> Исправлено
            </button>
            <button onClick={() => onUpdateStatus("rejected")} className="text-xs text-gray-500 hover:underline flex items-center gap-0.5">
              <XCircle className="h-3 w-3" /> Игнорировать
            </button>
          </>
        )}
        {(finding.status === "resolved" || finding.status === "rejected") && (
          <button onClick={() => onUpdateStatus("pending")} className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
            <RotateCcw className="h-3 w-3" /> Вернуть к валидации
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Finding Detail (Right Panel) ──────────────────── */

function FindingDetail({
  finding,
  sections,
}: {
  finding: any;
  sections: { id: string; title: string; standardSection: string | null; content: string }[];
}) {
  const m = extractFindingMeta(finding);

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("rounded px-2 py-0.5 text-xs font-bold uppercase", SEVERITY_STYLES[m.severity])}>
          {SEVERITY_LABELS[m.severity]}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[finding.status])}>
          {STATUS_LABELS[finding.status]}
        </span>
        {m.method && (
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium",
            m.method === "deterministic" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
          )}>
            {m.method === "deterministic" ? "Детерминированный" : m.method === "llm" ? "LLM" : m.method}
          </span>
        )}
        {m.type && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {TYPE_LABELS[m.type] ?? m.type}
          </span>
        )}
        {m.taskKind && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {TASK_KIND_LABELS[m.taskKind] ?? m.taskKind}
          </span>
        )}
        {m.confidence && CONFIDENCE_LABELS[m.confidence] && (
          <span className={cn("text-xs font-medium", CONFIDENCE_LABELS[m.confidence].cls)}>
            Уверенность: {CONFIDENCE_LABELS[m.confidence].label}
          </span>
        )}
      </div>

      {/* Issue type + family + category */}
      <div className="flex items-center gap-2 flex-wrap">
        {m.issueType && (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 border border-violet-200 px-2.5 py-1">
            <span className="text-xs text-violet-500">Тип:</span>
            <span className="text-xs font-semibold text-violet-800">{m.issueType}</span>
          </div>
        )}
        {m.issueFamily && (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1">
            <span className="text-xs text-amber-500">Семейство:</span>
            <span className="text-xs font-semibold text-amber-800">{ISSUE_FAMILY_LABELS[m.issueFamily] ?? m.issueFamily}</span>
          </div>
        )}
        {m.auditCategory && (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-cyan-50 border border-cyan-200 px-2.5 py-1">
            <span className="text-xs text-cyan-500">Категория:</span>
            <span className="text-xs font-semibold text-cyan-800">{CATEGORY_LABELS[m.auditCategory] ?? m.auditCategory}</span>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 leading-snug">{m.description}</h2>
      </div>

      {/* Suggestion */}
      {m.suggestion && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1">Рекомендация</div>
          <p className="text-sm text-green-800">{m.suggestion}</p>
        </div>
      )}

      {/* Editorial fix */}
      {m.editorialFix && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-1">Предлагаемая правка</div>
          <p className="text-sm text-blue-800 font-mono">{m.editorialFix}</p>
        </div>
      )}

      {/* Zones */}
      {(m.zone || m.anchorZone) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400 text-xs">Зоны:</span>
          {m.anchorZone && (
            <span className="rounded bg-brand-50 border border-brand-200 px-2 py-0.5 text-xs font-medium text-brand-800">
              {getZoneLabel(m.anchorZone)}
            </span>
          )}
          {m.anchorZone && m.zone && <span className="text-gray-400">→</span>}
          {m.zone && (
            <span className="rounded bg-orange-50 border border-orange-200 px-2 py-0.5 text-xs font-medium text-orange-800">
              {getZoneLabel(m.zone)}
            </span>
          )}
        </div>
      )}

      {/* Quotes */}
      {(m.textSnippet || m.referenceQuote || m.anchorQuote || m.targetQuote) && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Цитаты из документа</div>
          {m.textSnippet && (
            <blockquote className="border-l-4 border-gray-300 bg-gray-50 pl-4 py-2 text-sm text-gray-700 italic">
              {m.sectionTitle && <span className="not-italic text-[10px] text-gray-400 block mb-0.5">{m.sectionTitle}</span>}
              {m.textSnippet}
            </blockquote>
          )}
          {m.referenceQuote && (
            <blockquote className="border-l-4 border-blue-300 bg-blue-50 pl-4 py-2 text-sm text-blue-800 italic">
              <span className="not-italic text-[10px] text-blue-400 block mb-0.5">Референсная цитата</span>
              {m.referenceQuote}
            </blockquote>
          )}
          {m.anchorQuote && (
            <blockquote className="border-l-4 border-brand-300 bg-brand-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="not-italic text-[10px] text-brand-400 block mb-0.5">Якорная зона</span>
              {m.anchorQuote}
            </blockquote>
          )}
          {m.targetQuote && (
            <blockquote className="border-l-4 border-orange-300 bg-orange-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="not-italic text-[10px] text-orange-400 block mb-0.5">Проверяемая зона</span>
              {m.targetQuote}
            </blockquote>
          )}
        </div>
      )}

      {/* QA Verdict */}
      {m.qaVerdict && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">QA верификация</div>
          <div className="flex items-center gap-2 mb-1">
            {QA_VERDICT_LABELS[m.qaVerdict] && (
              <span className={cn("rounded px-2 py-0.5 text-xs font-medium", QA_VERDICT_LABELS[m.qaVerdict].cls)}>
                {QA_VERDICT_LABELS[m.qaVerdict].label}
              </span>
            )}
          </div>
          {m.qaReason && <p className="text-sm text-gray-700">{m.qaReason}</p>}
        </div>
      )}

      {/* Context status warning */}
      {m.contextStatus && m.contextStatus !== "ok" && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">Недостаточный контекст — результат может быть неточным</p>
        </div>
      )}

      {/* Meta info */}
      {(m.block || m.field) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
          {m.block && <span>Блок: <span className="text-gray-600">{m.block}</span></span>}
          {m.field && <span>Поле: <span className="text-gray-600">{m.field}</span></span>}
        </div>
      )}

      {/* Related document sections */}
      {sections.length > 0 && (
        <div className="space-y-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Разделы документа</div>
          {sections.map((section) => (
            <SectionPanel
              key={section.id}
              section={section}
              highlightQuotes={[m.textSnippet, m.referenceQuote, m.anchorQuote, m.targetQuote].filter((x): x is string => !!x)}
            />
          ))}
        </div>
      )}

      {sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-400">
            Разделы документа, связанные с этой находкой, не определены
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Section Panel ──────────────────── */

function SectionPanel({
  section,
  highlightQuotes,
}: {
  section: { title: string; standardSection: string | null; content: string };
  highlightQuotes: string[];
}) {
  const [expanded, setExpanded] = useState(true);

  const highlightText = useCallback(
    (text: string) => {
      if (highlightQuotes.length === 0) return text;

      let result = text;
      for (const quote of highlightQuotes) {
        if (!quote || quote.length < 10) continue;
        const clean = quote.replace(/\.\.\./g, "").trim();
        if (clean.length < 10) continue;
        const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        try {
          result = result.replace(
            new RegExp(`(${escaped.slice(0, 80)})`, "gi"),
            "%%HL_START%%$1%%HL_END%%"
          );
        } catch {
          // ignore regex errors
        }
      }
      return result;
    },
    [highlightQuotes]
  );

  const rendered = highlightText(section.content);
  const parts = rendered.split(/(%%HL_START%%|%%HL_END%%)/);
  let inHighlight = false;

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <span className="text-sm font-semibold text-gray-900">
            Раздел «{section.title}»
          </span>
          {section.standardSection && (
            <span className="ml-2 text-xs text-gray-400">[{section.standardSection}]</span>
          )}
        </div>
        <ChevronRight className={cn("h-4 w-4 text-gray-400 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
          {parts.map((part, idx) => {
            if (part === "%%HL_START%%") {
              inHighlight = true;
              return null;
            }
            if (part === "%%HL_END%%") {
              inHighlight = false;
              return null;
            }
            if (inHighlight) {
              return (
                <span key={idx} className="bg-yellow-200 underline decoration-red-500 decoration-2 underline-offset-2">
                  {part}
                </span>
              );
            }
            return <span key={idx}>{part}</span>;
          })}
        </div>
      )}
    </div>
  );
}
