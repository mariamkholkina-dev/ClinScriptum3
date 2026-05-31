"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  RefreshCw,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  Shield,
  RotateCcw,
  FileText,
} from "lucide-react";
import { openInWord } from "@/lib/open-in-word";
import { DocumentVersionHeader } from "@/components/document-version-header";
import {
  SEVERITY_BORDER,
  SEVERITY_OPTIONS,
  STATUS_ORDER,
  STATUS_LABELS,
  TYPE_LABELS,
  extractFindingMeta,
  selectTestedSections,
  FindingBadges,
  FindingCardBody,
  FindingDetailBody,
} from "@/components/finding-display";

/* ──────────────────── Main Page ──────────────────── */

export default function IntraAuditPage() {
  const { docVersionId } = useParams<{ docVersionId: string }>();
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [auditStarted, setAuditStarted] = useState(false);

  // Ширина левой панели (список находок) — перетаскиваемый разделитель.
  const [leftWidth, setLeftWidth] = useState(480);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !contentRef.current) return;
      const left = contentRef.current.getBoundingClientRect().left;
      const max = contentRef.current.clientWidth - 360;
      const w = Math.min(Math.max(e.clientX - left, 300), Math.max(max, 300));
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

  const statusQuery = trpc.audit.getAuditStatus.useQuery(
    { docVersionId },
    { refetchInterval: (data) => (data?.state?.data?.isRunning ? 3000 : false) }
  );

  // NB: severity/type фильтруются КЛИЕНТСКИ (ниже), не на бэке. Колонка
  // Finding.severity у intra-audit находок не заполняется (серьёзность лежит
  // в extraAttributes.severity), поэтому серверный where.severity обнулял
  // список. auditCategory тоже не пишется. Фильтруем по extractFindingMeta —
  // тем же значениям, что показаны на карточках.
  const findingsQuery = trpc.audit.getAuditFindings.useQuery(
    { docVersionId },
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
  // Опции фильтра по типу строим из РЕАЛЬНО присутствующих в находках значений
  // (editorial / semantic / intra_audit / ...). Фиксированный список опций
  // пропускал типы вроде intra_audit → выбор обнулял список, а сам тип нельзя
  // было выбрать.
  const availableTypes = Array.from(
    new Set(allFindings.map((f) => extractFindingMeta(f).type).filter((t): t is string => !!t)),
  ).sort();
  const findings = allFindings.filter((f) => {
    const m = extractFindingMeta(f);
    // Писатель не видит ложноположительные находки (страховка к серверной
    // фильтрации — на случай закэшированных данных).
    if (f.status === "false_positive") return false;
    if (severityFilter !== "all" && m.severity !== severityFilter) return false;
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    return true;
  });
  const docTitle = findingsQuery.data?.documentTitle ?? "Документ";
  const versionLabel = findingsQuery.data?.versionLabel ?? "";
  const studyTitle = (findingsQuery.data as any)?.studyTitle ?? null;
  const studyId = (findingsQuery.data as any)?.studyId ?? null;
  const isRunning = statusQuery.data?.isRunning ?? false;
  const operatorReviewEnabled = statusQuery.data?.operatorReviewEnabled ?? false;
  const reviewPending = operatorReviewEnabled && (findingsQuery.data as any)?.reviewPending === true;

  const selectedFinding = findings.find((f) => f.id === selectedFindingId);

  // Только разделы, которые реально тестируются находкой (содержат цитату),
  // а не вся зона целиком.
  const relevantSections = selectedFinding
    ? selectTestedSections(extractFindingMeta(selectedFinding), sectionsQuery.data ?? [])
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <DocumentVersionHeader
        studyTitle={studyTitle}
        studyId={studyId}
        documentTitle={docTitle}
        versionLabel={versionLabel}
        stageLabel="Внутридокументный аудит"
        actions={
          <>
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
          </>
        }
      />

      {/* Loading state */}
      {isRunning && (
        <div className="flex-none bg-blue-50 border-b border-blue-200 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Выполняется анализ документа... Результаты появятся автоматически.
          </div>
        </div>
      )}

      {/* Обработка ещё не завершена. Этап ревью оператором — внутренний и
          скрыт от медицинского писателя: показываем нейтральный статус «идёт
          обработка», не раскрывая, что находки на проверке у специалиста. */}
      {reviewPending && !isRunning && (
        <div className="flex-none bg-blue-50 border-b border-blue-200 px-6 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Обработка документа ещё не завершена. Результаты появятся автоматически.
          </div>
        </div>
      )}

      {/* Main content */}
      <div ref={contentRef} className="flex-1 flex min-h-0">
        {/* Left Panel: Findings (ширина регулируется разделителем) */}
        <div
          className="flex-none border-r flex flex-col bg-gray-50"
          style={{ width: leftWidth }}
        >
          {/* Filters */}
          <div className="flex-none p-4 space-y-2 border-b bg-white">
            {/* grid-cols-2: фильтры переносятся (2+1) и не вылезают за ширину
                узкой панели списка — раньше 3 select c flex-1 не сжимались и
                последний обрезался. min-w-0 разрешает select сжиматься в ячейке. */}
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
              {/* Статус-фильтр показывает ВСЕ возможные статусы валидации,
                  даже если в текущем наборе находок их нет. */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                <option value="all">Все статусы</option>
                {/* Без «Ложное срабатывание» — писатель такие находки не видит. */}
                {STATUS_ORDER.filter((s) => s !== "false_positive").map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                ))}
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

        {/* Перетаскиваемый разделитель ширины панелей */}
        <div
          onMouseDown={startDragDivider}
          className="w-1.5 flex-none cursor-col-resize bg-gray-200 hover:bg-brand-400 transition-colors"
          title="Потяните, чтобы изменить ширину панелей"
        />

        {/* Right Panel: Document sections */}
        <div className="flex-1 min-w-0 overflow-y-auto bg-white p-6">
          {!selectedFinding ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <Eye className="h-16 w-16 mb-4" />
              <p className="text-lg">Выберите находку для просмотра контекста</p>
              <p className="text-sm mt-1">Нажмите на карточку находки в левой панели</p>
            </div>
          ) : (
            <div className="max-w-3xl">
              <FindingDetailBody finding={selectedFinding} sections={relevantSections} />
            </div>
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
      <FindingBadges finding={finding} showStatus />
      <FindingCardBody finding={finding} />

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
