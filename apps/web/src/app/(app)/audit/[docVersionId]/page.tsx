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
      category: categoryFilter !== "all" ? categoryFilter : undefined,
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
      !auditStarted
    ) {
      startAudit.mutate({ docVersionId });
    }
  }, [statusQuery.data?.isRunning, statusQuery.data?.totalFindings]);

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

  const findings = findingsQuery.data?.findings ?? [];
  const docTitle = findingsQuery.data?.documentTitle ?? "Документ";
  const versionLabel = findingsQuery.data?.versionLabel ?? "";
  const isRunning = statusQuery.data?.isRunning ?? false;
  const reviewPending = (findingsQuery.data as any)?.reviewPending === true;
  const reviewStatus = statusQuery.data?.reviewStatus ?? null;

  const selectedFinding = findings.find((f) => f.id === selectedFindingId);

  const relevantSections = selectedFinding
    ? (sectionsQuery.data ?? []).filter((s) => {
        const ref = selectedFinding.sourceRef as any;
        const zones = [selectedFinding.anchorZone, selectedFinding.targetZone].filter(Boolean);
        if (zones.length > 0) {
          return zones.some((z) => s.standardSection?.startsWith(z!));
        }
        if (ref?.sectionTitle) {
          return s.title.toLowerCase().includes(ref.sectionTitle.toLowerCase());
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
  const severity = finding.severity ?? "info";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-lg border bg-white p-3 cursor-pointer transition-all border-l-4",
        SEVERITY_BORDER[severity] ?? "border-l-gray-300",
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
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            STATUS_STYLES[finding.status] ?? "bg-gray-100 text-gray-500"
          )}
        >
          {STATUS_LABELS[finding.status] ?? finding.status}
        </span>
      </div>

      <p className="text-sm font-medium text-gray-900 line-clamp-2">{finding.description}</p>

      {finding.auditCategory && (
        <p className="text-xs text-gray-400 mt-1">
          {CATEGORY_LABELS[finding.auditCategory] ?? finding.auditCategory}
          {finding.issueType ? ` · ${finding.issueType}` : ""}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
        {finding.status === "false_positive" && (
          <button
            onClick={() => onUpdateStatus("pending")}
            className="text-xs text-brand-600 hover:underline flex items-center gap-0.5"
          >
            <RotateCcw className="h-3 w-3" />
            К валидации
          </button>
        )}
        {finding.status === "pending" && (
          <>
            <button
              onClick={() => onUpdateStatus("resolved")}
              className="text-xs text-green-600 hover:underline flex items-center gap-0.5"
            >
              <CheckCircle2 className="h-3 w-3" />
              Исправлено
            </button>
            <button
              onClick={() => onUpdateStatus("rejected")}
              className="text-xs text-gray-500 hover:underline flex items-center gap-0.5"
            >
              <XCircle className="h-3 w-3" />
              Игнорировать
            </button>
          </>
        )}
        {(finding.status === "resolved" || finding.status === "rejected") && (
          <button
            onClick={() => onUpdateStatus("pending")}
            className="text-xs text-brand-600 hover:underline flex items-center gap-0.5"
          >
            <RotateCcw className="h-3 w-3" />
            Вернуть к валидации
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
  const ref = finding.sourceRef as any;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Finding info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-bold uppercase",
              SEVERITY_STYLES[finding.severity ?? "info"]
            )}
          >
            {SEVERITY_LABELS[finding.severity ?? "info"]}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[finding.status]
            )}
          >
            {STATUS_LABELS[finding.status]}
          </span>
          {finding.auditCategory && (
            <span className="text-xs text-gray-400">
              {CATEGORY_LABELS[finding.auditCategory] ?? finding.auditCategory}
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

      {/* Source references */}
      {(ref?.anchorQuote || ref?.targetQuote || ref?.textSnippet) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Цитаты из документа</h3>
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
          {ref.textSnippet && !ref.anchorQuote && (
            <blockquote className="border-l-4 border-gray-300 bg-gray-50 pl-4 py-2 text-sm text-gray-700 italic">
              {ref.textSnippet}
            </blockquote>
          )}
        </div>
      )}

      {/* Related document sections */}
      {sections.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">Разделы документа</h3>
          {sections.map((section) => (
            <SectionPanel
              key={section.id}
              section={section}
              highlightQuotes={[ref?.anchorQuote, ref?.targetQuote, ref?.textSnippet].filter(Boolean)}
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
