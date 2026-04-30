"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  Loader2,
  Download,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Eye,
  Filter,
  FileText,
  Clock,
} from "lucide-react";
import { openInWord } from "@/lib/open-in-word";

/* ═══════════════════════ Constants ═══════════════════════ */

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "Критический", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  high: { label: "Существенный", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
  medium: { label: "Средний", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  low: { label: "Незначительный", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  info: { label: "Информационный", color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "К валидации", color: "text-amber-700", bg: "bg-amber-100" },
  false_positive: { label: "Ложное срабатывание", color: "text-gray-500", bg: "bg-gray-100" },
  resolved: { label: "Исправлено", color: "text-green-700", bg: "bg-green-100" },
  rejected: { label: "Игнорировать", color: "text-gray-500", bg: "bg-gray-200" },
  confirmed: { label: "Подтверждено", color: "text-blue-700", bg: "bg-blue-100" },
};

const FAMILY_LABELS: Record<string, string> = {
  IDENTIFIERS_VERSIONING: "Идентификаторы и версии",
  DESIGN_EXECUTION: "Дизайн и исполнение",
  POPULATION_ELIGIBILITY: "Популяция и критерии",
  IP_TREATMENT: "Препарат и лечение",
  ENDPOINT_ASSESSMENT: "Конечные точки",
  SAFETY_MONITORING: "Безопасность",
  STATISTICAL_INTERPRETATION: "Статистика",
  SUBJECT_BURDEN_DISCLOSURE: "Нагрузка на субъекта",
  PRIVACY_DATA_SAMPLES: "Конфиденциальность и данные",
  SPECIAL_CONSENT_PATHWAYS: "Специальные процедуры согласия",
  TRACEABILITY: "Трассируемость",
  OVERCLAIMING_UNDERDISCLOSURE: "Завышение/недораскрытие",
};

/* ═══════════════════════ Page ═══════════════════════ */

export default function CrossAuditPage() {
  const params = useParams<{ protocolVersionId: string; checkedVersionId: string }>();
  const { protocolVersionId, checkedVersionId } = params;

  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  const startAudit = trpc.audit.startInterAudit.useMutation();
  const statusQuery = trpc.audit.getInterAuditStatus.useQuery(
    { protocolVersionId, checkedVersionId },
    { refetchInterval: (data) => (data?.state?.data?.isRunning ? 3000 : false) }
  );
  const findingsQuery = trpc.audit.getInterAuditFindings.useQuery(
    { protocolVersionId, checkedVersionId },
    { enabled: !statusQuery.data?.isRunning }
  );
  const updateStatus = trpc.audit.updateAuditFindingStatus.useMutation({
    onSuccess: () => findingsQuery.refetch(),
  });
  const validateAll = trpc.audit.validateAllInterAuditFindings.useMutation({
    onSuccess: () => findingsQuery.refetch(),
  });

  const auditData = findingsQuery.data;
  const isRunning = statusQuery.data?.isRunning ?? false;
  const reviewPending = (auditData as any)?.reviewPending === true;

  // Auto-start on first visit if no findings
  useEffect(() => {
    if (
      statusQuery.data &&
      !statusQuery.data.isRunning &&
      statusQuery.data.totalFindings === 0 &&
      statusQuery.data.runStatus === null
    ) {
      startAudit.mutate({ protocolVersionId, checkedVersionId });
    }
  }, [statusQuery.data]);

  const handleRerun = useCallback(() => {
    startAudit.mutate(
      { protocolVersionId, checkedVersionId },
      { onSuccess: () => { statusQuery.refetch(); } }
    );
  }, [protocolVersionId, checkedVersionId, startAudit, statusQuery]);

  const handleDownloadReport = useCallback(async () => {
    const { useAuthStore } = await import("@/lib/auth-store");
    const token = useAuthStore.getState().accessToken;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace("/trpc", "");
    const res = await fetch(
      `${apiUrl}/api/inter-audit-report/${protocolVersionId}/${checkedVersionId}`,
      { headers: token ? { authorization: `Bearer ${token}` } : {} }
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)/)?.[1]
      ? decodeURIComponent(res.headers.get("content-disposition")!.match(/filename\*=UTF-8''(.+)/)![1])
      : "inter-audit-report.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [protocolVersionId, checkedVersionId]);

  const findings = (auditData?.findings ?? []).filter((f: any) => {
    if (severityFilter !== "all" && f.severity !== severityFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    return true;
  });

  const selectedFinding = findings.find((f: any) => f.id === selectedFindingId) ?? findings[0];

  const docTypeLabel = auditData?.checkedDocType === "icf"
    ? "ИС"
    : auditData?.checkedDocType === "csr"
      ? "CSR"
      : "документ";

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex-none border-b bg-white px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
          <Link href="/studies" className="hover:text-gray-600">Исследования</Link>
          <span>/</span>
          {auditData && (
            <>
              <span className="text-gray-600">{auditData.studyTitle}</span>
              <span>/</span>
            </>
          )}
          <span className="text-gray-600">
            Аудит {docTypeLabel} {auditData?.checkedDocLabel}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            Аудит: {auditData?.protocolTitle} {auditData?.protocolLabel} vs{" "}
            {docTypeLabel} {auditData?.checkedDocLabel}
          </h1>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRerun}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", isRunning && "animate-spin")} />
              {isRunning ? "Выполняется..." : "Запустить повторный аудит"}
            </button>
            <button
              onClick={() => openInWord({ docVersionId: checkedVersionId, mode: "inter_audit", protocolVersionId })}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              Открыть в Word
            </button>
            <button
              onClick={handleDownloadReport}
              disabled={isRunning || findings.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Выгрузить отчёт
            </button>
          </div>
        </div>
      </div>

      {/* Running state */}
      {isRunning && (
        <div className="flex-none bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-amber-600" />
          <p className="text-sm text-amber-700">
            Выполняется междокументный аудит... Результаты появятся автоматически.
          </p>
        </div>
      )}

      {/* Review pending banner */}
      {reviewPending && !isRunning && (
        <div className="flex-none bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
          <Clock className="h-5 w-5 text-amber-600" />
          <p className="text-sm text-amber-700">
            Результаты аудита на проверке у специалиста. Findings будут доступны после публикации.
          </p>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
        {/* Left: Findings list */}
        <div className="col-span-4 border-r flex flex-col overflow-hidden bg-gray-50">
          <div className="flex-none p-4 border-b bg-white">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Найденные несоответствия
              </h2>
              <span className="text-xs text-gray-500">
                Найдено: {findings.length} из {auditData?.findings?.length ?? 0}
              </span>
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Уровень</label>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="all">Все уровни</option>
                  <option value="critical">Критический</option>
                  <option value="high">Существенный</option>
                  <option value="medium">Средний</option>
                  <option value="low">Незначительный</option>
                  <option value="info">Информационный</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Категория</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                >
                  <option value="all">Все статусы</option>
                  <option value="pending">К валидации</option>
                  <option value="false_positive">Ложное срабатывание</option>
                  <option value="resolved">Исправлено</option>
                  <option value="rejected">Игнорировать</option>
                </select>
              </div>
            </div>

            {/* Bulk actions */}
            {findings.some((f: any) => f.status === "pending") && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => validateAll.mutate({ checkedVersionId, action: "resolve" })}
                  className="flex-1 rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100"
                >
                  Все «Исправлено»
                </button>
                <button
                  onClick={() => validateAll.mutate({ checkedVersionId, action: "reject" })}
                  className="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  Все «Игнорировать»
                </button>
              </div>
            )}
          </div>

          {/* Findings list */}
          <div className="flex-1 overflow-y-auto">
            {findings.length === 0 && !isRunning ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <AlertTriangle className="h-8 w-8 mb-2" />
                <p className="text-sm">Несоответствий не найдено</p>
              </div>
            ) : (
              <div className="divide-y">
                {findings.map((finding: any) => {
                  const sev = SEVERITY_CONFIG[finding.severity ?? "info"] ?? SEVERITY_CONFIG.info;
                  const isSelected = finding.id === (selectedFinding as any)?.id;

                  return (
                    <button
                      key={finding.id}
                      onClick={() => setSelectedFindingId(finding.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 hover:bg-white transition-colors",
                        isSelected && "bg-white shadow-sm ring-1 ring-brand-200"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className={cn(
                          "flex-none mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          sev.bg, sev.color, sev.border, "border"
                        )}>
                          {sev.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 line-clamp-2">{finding.description}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-400">
                              Протокол: {finding.anchorZone ?? "—"}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {docTypeLabel}: {finding.targetZone ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Middle: Source document (Protocol) */}
        <div className="col-span-4 border-r flex flex-col overflow-hidden">
          <div className="flex-none px-4 py-3 border-b bg-white">
            <h2 className="text-sm font-semibold text-gray-900">
              Источник: {auditData?.protocolTitle} {auditData?.protocolLabel}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedFinding ? (
              <SourcePanel finding={selectedFinding} type="protocol" />
            ) : (
              <EmptyDocPanel label="Выберите находку для просмотра контекста" />
            )}
          </div>
        </div>

        {/* Right: Checked document */}
        <div className="col-span-4 flex flex-col overflow-hidden">
          <div className="flex-none px-4 py-3 border-b bg-white">
            <h2 className="text-sm font-semibold text-gray-900">
              Проверяемый документ: {auditData?.checkedDocTitle} {auditData?.checkedDocLabel}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedFinding ? (
              <CheckedDocPanel
                finding={selectedFinding}
                docTypeLabel={docTypeLabel}
                onStatusChange={(findingId, status) =>
                  updateStatus.mutate({ findingId, status })
                }
              />
            ) : (
              <EmptyDocPanel label="Выберите находку для просмотра контекста" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════ Panels ═══════════════════════ */

function SourcePanel({ finding, type }: { finding: any; type: "protocol" | "checked" }) {
  const ref = finding.sourceRef as any;
  const sev = SEVERITY_CONFIG[finding.severity ?? "info"] ?? SEVERITY_CONFIG.info;
  const section = ref?.protocolSection ?? finding.anchorZone ?? "—";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {section}
        </p>
        {ref?.protocolQuote ? (
          <p className="text-sm text-gray-900 leading-relaxed">
            {highlightText(ref.protocolQuote)}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic">
            Цитата из протокола не предоставлена
          </p>
        )}
      </div>

      {finding.description && (
        <div className={cn("rounded-lg border p-3", sev.bg, sev.border)}>
          <p className={cn("text-xs font-semibold uppercase mb-1", sev.color)}>
            {sev.label}
          </p>
          <p className="text-sm text-gray-900">{finding.description}</p>
        </div>
      )}
    </div>
  );
}

function CheckedDocPanel({
  finding,
  docTypeLabel,
  onStatusChange,
}: {
  finding: any;
  docTypeLabel: string;
  onStatusChange: (findingId: string, status: "pending" | "rejected" | "confirmed" | "resolved" | "false_positive") => void;
}) {
  const ref = finding.sourceRef as any;
  const section = ref?.checkedDocSection ?? finding.targetZone ?? "—";
  const status = STATUS_CONFIG[finding.status] ?? STATUS_CONFIG.pending;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-gray-50 p-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
          {section}
        </p>
        {ref?.checkedDocQuote ? (
          <p className="text-sm text-gray-900 leading-relaxed">
            {highlightText(ref.checkedDocQuote)}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic">
            Цитата из проверяемого документа не предоставлена
          </p>
        )}
      </div>

      {finding.suggestion && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-xs font-semibold text-green-700 uppercase mb-1">Рекомендация</p>
          <p className="text-sm text-green-900">{finding.suggestion}</p>
        </div>
      )}

      {/* Status & Actions */}
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Статус:</span>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", status.bg, status.color)}>
            {status.label}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Проверка: {finding.issueType ?? "—"}</span>
          <span>|</span>
          <span>{FAMILY_LABELS[finding.issueFamily] ?? finding.issueFamily ?? "—"}</span>
        </div>

        {finding.status === "false_positive" && (
          <button
            onClick={() => onStatusChange(finding.id, "pending")}
            className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100"
          >
            Вернуть к валидации
          </button>
        )}

        {finding.status === "pending" && (
          <div className="flex gap-2">
            <button
              onClick={() => onStatusChange(finding.id, "resolved")}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Исправлено
            </button>
            <button
              onClick={() => onStatusChange(finding.id, "rejected")}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Игнорировать
            </button>
          </div>
        )}

        {(finding.status === "resolved" || finding.status === "rejected") && (
          <button
            onClick={() => onStatusChange(finding.id, "pending")}
            className="w-full rounded-lg border px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
          >
            Вернуть к валидации
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyDocPanel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      <Eye className="h-8 w-8 mb-2" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/* ═══════════════════════ Helpers ═══════════════════════ */

function highlightText(text: string) {
  return text;
}
