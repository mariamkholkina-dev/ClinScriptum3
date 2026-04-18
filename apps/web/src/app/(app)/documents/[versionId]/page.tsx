"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  AlertTriangle,
  SkipForward,
  Loader2,
  Table2,
  ListOrdered,
  Footprints,
  Edit3,
  Clock,
  CheckCircle2,
  XCircle,
  Search,
  PenLine,
  ExternalLink,
  ChevronUp,
  Info,
} from "lucide-react";

/* ──────────────────────── Constants ──────────────────────── */

type Tab = "sections" | "facts" | "soa";

const CONFIDENCE_THRESHOLD = 0.7;

const VERSION_STATUS_LABELS: Record<string, string> = {
  uploading: "Загрузка",
  parsing: "Разбор структуры",
  classifying_sections: "Присвоение секций",
  extracting_facts: "Выделение фактов",
  detecting_soa: "Поиск таблицы SOA",
  ready: "Готов",
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
  impact_assessment: "Оценка влияния",
  parsed: "Разобран",
  error: "Ошибка",
};

const STRUCTURE_STATUS_LABELS: Record<string, string> = {
  validated: "Структура подтверждена",
  not_validated: "Структура не проверена",
  requires_rework: "Структура: доработка",
};

const CLASSIFICATION_STATUS_LABELS: Record<string, string> = {
  validated: "Классификация подтверждена",
  not_validated: "Классификация не проверена",
  requires_rework: "Классификация: доработка",
};

const CLASSIFIED_BY_LABELS: Record<string, string> = {
  deterministic: "Детерминированный",
  llm_check: "LLM-верификация",
  llm_qa: "LLM QA",
  manual: "Ручной",
};

/* ──────────────────────── Page ──────────────────────── */

export default function DocumentVersionPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("sections");

  const versionQuery = trpc.document.getVersion.useQuery({ versionId });

  if (versionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }
  if (!versionQuery.data) {
    return <p className="text-sm text-red-500">Версия документа не найдена</p>;
  }

  const version = versionQuery.data;
  const isParsed = !["uploading", "error"].includes(version.status);

  const isProtocol = version.document.type === "protocol";
  const hasFacts = isParsed && isProtocol;

  const hasSoa = isParsed && isProtocol;

  const tabs: { key: Tab; label: string; disabled?: boolean }[] = [
    { key: "sections", label: "Секции", disabled: !isParsed },
    { key: "facts", label: "Факты", disabled: !hasFacts },
    { key: "soa", label: "График процедур", disabled: !hasSoa },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 4rem)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <Link
          href={`/studies/${version.document.studyId}`}
          className="text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-sm text-gray-500">
            Исследование {version.document.study.title}
          </p>
          <h1 className="text-2xl font-bold text-gray-900">
            {version.document.title}
          </h1>
          <p className="text-sm text-gray-500">
            Версия {(version as any).versionLabel ?? `v${version.versionNumber}`}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium",
            version.status === "ready" || version.status === "parsed"
              ? "bg-green-100 text-green-700"
              : version.status === "error"
                ? "bg-red-100 text-red-700"
                : "bg-blue-100 text-blue-700"
          )}
        >
          {VERSION_STATUS_LABELS[version.status] ?? version.status}
        </span>
      </div>

      {/* Tabs */}
      <div className="border-b flex-shrink-0 mt-5">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => !tab.disabled && setActiveTab(tab.key)}
              disabled={tab.disabled}
              className={cn(
                "px-5 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.key
                  ? "border-brand-600 text-brand-700 bg-brand-50/50"
                  : tab.disabled
                    ? "border-transparent text-gray-300 cursor-not-allowed"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content — fills remaining height */}
      <div className="flex-1 min-h-0 mt-5">
        {activeTab === "sections" && isParsed && (
          <SectionsTab version={version} onRefetch={versionQuery.refetch} />
        )}
        {activeTab === "facts" && hasFacts && (
          <FactsTab versionId={version.id} />
        )}
        {activeTab === "facts" && !hasFacts && (
          <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
            <FileText className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              Вкладка «Факты» доступна только для документов типа Протокол.
            </p>
          </div>
        )}
        {activeTab === "soa" && isProtocol && isParsed && (
          <SoaTab versionId={version.id} />
        )}
        {activeTab === "soa" && !isProtocol && (
          <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
            <Table2 className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              Вкладка «График процедур» доступна только для документов типа Протокол.
            </p>
          </div>
        )}
        {activeTab === "soa" && isProtocol && !isParsed && (
          <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
            <Loader2 className="mx-auto h-10 w-10 text-gray-300 animate-spin" />
            <p className="mt-2 text-sm text-gray-500">
              Дождитесь завершения обработки документа.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Facts Tab
   ══════════════════════════════════════════════════════════════ */

const FACT_STATUS_LABELS: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Верифицирован",
  validated: "Подтверждён",
  deferred: "Отложен",
  not_found: "Не найден",
  rejected: "Отклонён",
};

const FACT_CATEGORY_LABELS: Record<string, string> = {
  protocol_meta: "Метаданные протокола",
  study: "Характеристики исследования",
  study_design: "Дизайн исследования (доп.)",
  population: "Популяция",
  treatment: "Терапия / Препараты",
  intervention: "Вмешательство",
  endpoints: "Конечные точки",
  statistics: "Статистика",
  bioequivalence: "Биоэквивалентность",
};

type FactFilter = "all" | "found" | "not_found" | "contradiction" | "deferred";

function FactsTab({ versionId }: { versionId: string }) {
  const [filter, setFilter] = useState<FactFilter>("all");
  const [expandedFact, setExpandedFact] = useState<string | null>(null);
  const [editingFactId, setEditingFactId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const factsQuery = trpc.processing.listFacts.useQuery({ docVersionId: versionId });
  const validateAll = trpc.processing.validateAllFacts.useMutation({
    onSuccess: () => factsQuery.refetch(),
  });
  const updateStatus = trpc.processing.updateFactStatus.useMutation({
    onSuccess: () => factsQuery.refetch(),
  });
  const updateValue = trpc.processing.updateFactValue.useMutation({
    onSuccess: () => {
      factsQuery.refetch();
      setEditingFactId(null);
    },
  });

  if (factsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const facts = factsQuery.data ?? [];

  if (facts.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
        <Search className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-2 text-sm text-gray-500">
          Факты ещё не извлечены. Дождитесь завершения обработки документа.
        </p>
      </div>
    );
  }

  const filteredFacts = facts.filter((f: any) => {
    if (filter === "found") return f.status !== "not_found";
    if (filter === "not_found") return f.status === "not_found";
    if (filter === "contradiction") return f.hasContradiction;
    if (filter === "deferred") return f.status === "deferred";
    return true;
  });

  const grouped = filteredFacts.reduce((acc: Record<string, any[]>, f: any) => {
    const cat = f.factCategory ?? "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(f);
    return acc;
  }, {} as Record<string, any[]>);

  const totalFound = facts.filter((f: any) => f.status !== "not_found").length;
  const totalNotFound = facts.filter((f: any) => f.status === "not_found").length;
  const totalContradictions = facts.filter((f: any) => f.hasContradiction).length;
  const totalValidated = facts.filter((f: any) => f.status === "validated").length;
  const totalDeferred = facts.filter((f: any) => f.status === "deferred").length;
  const allValidated = totalFound > 0 && totalFound === totalValidated;

  const filters: { key: FactFilter; label: string; count: number }[] = [
    { key: "all", label: "Все", count: facts.length },
    { key: "found", label: "Найденные", count: totalFound },
    { key: "not_found", label: "Не найденные", count: totalNotFound },
    { key: "contradiction", label: "Противоречия", count: totalContradictions },
    { key: "deferred", label: "Отложенные", count: totalDeferred },
  ];

  return (
    <div className="space-y-4 h-full overflow-auto">
      {/* Stats + Actions bar */}
      <div className="flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {f.label}
              {f.count > 0 && (
                <span className="ml-1 opacity-75">({f.count})</span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={() => validateAll.mutate({ docVersionId: versionId })}
          disabled={allValidated || validateAll.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {validateAll.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Подтвердить все факты
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 flex-shrink-0">
        <StatCard label="Найдено" value={totalFound} color="green" />
        <StatCard label="Подтверждено" value={totalValidated} color="blue" />
        <StatCard label="Противоречий" value={totalContradictions} color="red" />
        <StatCard label="Не найдено" value={totalNotFound} color="gray" />
      </div>

      {/* Grouped facts */}
      <div className="space-y-4 pb-4">
        {Object.entries(grouped).map(([category, catFacts]) => (
          <div key={category} className="rounded-lg border bg-white shadow-sm">
            <div className="px-5 py-3 border-b bg-gray-50/50">
              <h3 className="text-sm font-semibold text-gray-800">
                {FACT_CATEGORY_LABELS[category] ?? category}
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {(catFacts as any[]).length} факт(ов)
              </p>
            </div>

            <div className="divide-y">
              {(catFacts as any[]).map((fact: any) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  isExpanded={expandedFact === fact.id}
                  isEditing={editingFactId === fact.id}
                  editValue={editingFactId === fact.id ? editValue : ""}
                  onToggleExpand={() =>
                    setExpandedFact(expandedFact === fact.id ? null : fact.id)
                  }
                  onStartEdit={() => {
                    setEditingFactId(fact.id);
                    setEditValue(fact.manualValue ?? fact.value ?? "");
                  }}
                  onCancelEdit={() => setEditingFactId(null)}
                  onEditValueChange={setEditValue}
                  onSaveValue={() =>
                    updateValue.mutate({ factId: fact.id, manualValue: editValue })
                  }
                  onValidate={() =>
                    updateStatus.mutate({ factId: fact.id, status: "validated" })
                  }
                  onDefer={() =>
                    updateStatus.mutate({ factId: fact.id, status: "deferred" })
                  }
                  isSaving={updateValue.isPending || updateStatus.isPending}
                />
              ))}
            </div>
          </div>
        ))}

        {Object.keys(grouped).length === 0 && (
          <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
            <Search className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              Нет фактов, соответствующих текущему фильтру.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── Stat Card ──────────── */

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "blue" | "red" | "gray";
}) {
  const colors = {
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    red: "bg-red-50 text-red-700 border-red-200",
    gray: "bg-gray-50 text-gray-600 border-gray-200",
  };

  return (
    <div className={cn("rounded-lg border px-4 py-3", colors[color])}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs opacity-75">{label}</p>
    </div>
  );
}

/* ──────────── Fact Row ──────────── */

function FactRow({
  fact,
  isExpanded,
  isEditing,
  editValue,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onEditValueChange,
  onSaveValue,
  onValidate,
  onDefer,
  isSaving,
}: {
  fact: any;
  isExpanded: boolean;
  isEditing: boolean;
  editValue: string;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (v: string) => void;
  onSaveValue: () => void;
  onValidate: () => void;
  onDefer: () => void;
  isSaving: boolean;
}) {
  const isNotFound = fact.status === "not_found";
  const displayValue = fact.manualValue || fact.value || "";
  const sources: any[] = Array.isArray(fact.sources) ? fact.sources : [];
  const confidencePercent = Math.round((fact.confidence ?? 0) * 100);

  const confidenceColor =
    confidencePercent >= 85
      ? "text-green-600 bg-green-50"
      : confidencePercent >= 60
        ? "text-blue-600 bg-blue-50"
        : confidencePercent >= 30
          ? "text-amber-600 bg-amber-50"
          : "text-red-600 bg-red-50";

  const statusColor =
    fact.status === "validated"
      ? "bg-green-100 text-green-700"
      : fact.status === "deferred"
        ? "bg-amber-100 text-amber-700"
        : fact.status === "not_found"
          ? "bg-gray-100 text-gray-500"
          : fact.status === "rejected"
            ? "bg-red-100 text-red-700"
            : "bg-blue-100 text-blue-700";

  return (
    <div
      className={cn(
        "px-5 py-3 transition-colors",
        isNotFound && "bg-gray-50/40",
        fact.hasContradiction && "bg-red-50/30"
      )}
    >
      {/* Main row */}
      <div className="flex items-center gap-3">
        {/* Expand toggle */}
        <button
          onClick={onToggleExpand}
          className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* Fact info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900 truncate">
              {fact.description || fact.factKey}
            </span>

            {fact.hasContradiction && (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                <AlertTriangle className="h-3 w-3" />
                Противоречие
              </span>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-0.5">{fact.factKey}</p>
        </div>

        {/* Value */}
        <div className="flex-shrink-0 max-w-xs text-right">
          {!isEditing && (
            <p
              className={cn(
                "text-sm font-mono",
                isNotFound && !displayValue ? "text-gray-400 italic" : "text-gray-800"
              )}
            >
              {displayValue || (isNotFound ? "—" : "—")}
            </p>
          )}
        </div>

        {/* Confidence */}
        {!isNotFound && (
          <span className={cn("flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium", confidenceColor)}>
            {confidencePercent}%
          </span>
        )}

        {/* Status */}
        <span className={cn("flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", statusColor)}>
          {FACT_STATUS_LABELS[fact.status] ?? fact.status}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {fact.status !== "validated" && (
            <button
              onClick={onValidate}
              disabled={isSaving}
              className="rounded p-1.5 text-green-500 hover:bg-green-50 hover:text-green-700"
              title="Подтвердить"
            >
              <Check className="h-4 w-4" />
            </button>
          )}

          {fact.status !== "deferred" && (
            <button
              onClick={onDefer}
              disabled={isSaving}
              className="rounded p-1.5 text-amber-500 hover:bg-amber-50 hover:text-amber-700"
              title="Отложить"
            >
              <Clock className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={onStartEdit}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Редактировать значение"
          >
            <PenLine className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Inline editor */}
      {isEditing && (
        <div className="flex items-center gap-2 mt-2 ml-8">
          <input
            type="text"
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            placeholder="Введите значение факта..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveValue();
              if (e.key === "Escape") onCancelEdit();
            }}
          />
          <button
            onClick={onSaveValue}
            disabled={isSaving}
            className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Сохранить"}
          </button>
          <button
            onClick={onCancelEdit}
            className="rounded border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Отмена
          </button>
        </div>
      )}

      {/* Expanded: sources */}
      {isExpanded && sources.length > 0 && (
        <div className="mt-3 ml-8 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Источники в документе ({sources.length})
          </p>
          {sources.map((src: any, idx: number) => (
            <div
              key={idx}
              className={cn(
                "rounded border px-3 py-2 text-sm",
                src.isSynopsis
                  ? "border-brand-200 bg-brand-50/50"
                  : "border-gray-200 bg-gray-50/50"
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600">
                  {src.sectionTitle || "—"}
                </span>
                {src.isSynopsis && (
                  <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                    SYNOPSIS
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-700 mt-1 leading-relaxed italic">
                &laquo;{src.text}&raquo;
              </p>
            </div>
          ))}
        </div>
      )}

      {isExpanded && sources.length === 0 && !isNotFound && (
        <div className="mt-3 ml-8">
          <p className="text-xs text-gray-400 italic">Нет ссылок на источники</p>
        </div>
      )}

      {isExpanded && isNotFound && !displayValue && (
        <div className="mt-3 ml-8 rounded border border-dashed border-gray-300 p-3 text-center">
          <p className="text-xs text-gray-500">
            Факт не найден в документе. Нажмите{" "}
            <button onClick={onStartEdit} className="text-brand-600 underline">
              редактировать
            </button>
            , чтобы ввести значение вручную.
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────── Sections Tab ──────────────────────── */

function SectionsTab({ version, onRefetch }: { version: any; onRefetch: () => void }) {
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const contentPanelRef = useRef<HTMLDivElement | null>(null);

  const validateAllStructure = trpc.document.validateAllStructure.useMutation({
    onSuccess: onRefetch,
  });
  const validateAllClassification = trpc.document.validateAllClassification.useMutation({
    onSuccess: onRefetch,
  });
  const updateClassification = trpc.document.updateSectionClassification.useMutation({
    onSuccess: onRefetch,
  });

  const taxonomyQuery = trpc.document.getTaxonomy.useQuery();

  const lowConfidenceSections = useMemo(
    () =>
      version.sections.filter(
        (s: any) => s.confidence < CONFIDENCE_THRESHOLD && s.classificationStatus !== "validated"
      ),
    [version.sections]
  );

  const allStructureValidated = version.sections.every((s: any) => s.structureStatus === "validated");
  const allClassificationValidated = version.sections.every((s: any) => s.classificationStatus === "validated");
  const unvalidatedStructureCount = version.sections.filter(
    (s: any) => s.structureStatus !== "validated"
  ).length;
  const unvalidatedClassificationCount = version.sections.filter(
    (s: any) => s.classificationStatus !== "validated"
  ).length;

  const scrollToSection = (sectionId: string) => {
    setActiveSectionId(sectionId);
    const el = sectionRefs.current[sectionId];
    const container = contentPanelRef.current;
    if (el && container) {
      const elTop = el.offsetTop - container.offsetTop;
      container.scrollTo({ top: elTop - 16, behavior: "smooth" });
    }
  };

  const goToNextAttention = () => {
    const next = lowConfidenceSections.find(
      (s: any) => s.id !== activeSectionId
    );
    if (next) scrollToSection(next.id);
  };

  const taxonomyOptions = useMemo(() => {
    if (!taxonomyQuery.data) return [];
    return taxonomyQuery.data.map((r: any) => ({
      value: r.pattern,
      label: `${r.config.titleRu} (${r.pattern})`,
      type: r.config.type,
    }));
  }, [taxonomyQuery.data]);

  return (
    <div className="grid grid-cols-12 gap-5 h-full">
      {/* Left: Navigation + Actions — sticky, own scroll */}
      <div className="col-span-3 flex flex-col gap-4 overflow-hidden">
        {/* Actions */}
        <div className="space-y-2 flex-shrink-0">
          <button
            onClick={() => validateAllStructure.mutate({ versionId: version.id })}
            disabled={allStructureValidated || validateAllStructure.isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {validateAllStructure.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Подтвердить структуру
          </button>

          <button
            onClick={() => validateAllClassification.mutate({ versionId: version.id })}
            disabled={allClassificationValidated || validateAllClassification.isPending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {validateAllClassification.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Подтвердить классификацию
          </button>

          {lowConfidenceSections.length > 0 && (
            <button
              onClick={goToNextAttention}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              <SkipForward className="h-4 w-4" />
              К следующей ({lowConfidenceSections.length})
            </button>
          )}

          {(!allStructureValidated || !allClassificationValidated) && (
            <p className="text-xs text-gray-500 text-center">
              Структура: {unvalidatedStructureCount} не подтв. · Классификация: {unvalidatedClassificationCount} не подтв.
            </p>
          )}
          {allStructureValidated && allClassificationValidated && (
            <p className="text-xs text-green-600 text-center font-medium">
              Все секции подтверждены
            </p>
          )}
        </div>

        {/* Section list — fills remaining height */}
        <SectionTree
          sections={version.sections}
          activeSectionId={activeSectionId}
          onSelect={scrollToSection}
        />
      </div>

      {/* Right: Document content — own scroll */}
      <div ref={contentPanelRef} className="col-span-9 overflow-auto space-y-4 pr-1">
        {version.sections.map((section: any) => {
          const isLowConf = section.confidence < CONFIDENCE_THRESHOLD && section.classificationStatus !== "validated";
          const isActive = activeSectionId === section.id;

          return (
            <div
              key={section.id}
              ref={(el) => { sectionRefs.current[section.id] = el; }}
              className={cn(
                "rounded-lg border bg-white shadow-sm transition-all",
                isActive && "ring-2 ring-brand-400",
                isLowConf && !isActive && "border-amber-300"
              )}
            >
              {/* Section header with classification info */}
              <SectionHeader
                section={section}
                isLowConf={isLowConf}
                taxonomyOptions={taxonomyOptions}
                onUpdateClassification={(standardSection) => {
                  updateClassification.mutate({
                    sectionId: section.id,
                    standardSection,
                    classificationStatus: "validated",
                  });
                }}
              />

              {/* Content blocks */}
              <div className="px-6 pb-6 space-y-2">
                {section.contentBlocks.map((block: any) => (
                  <ContentBlockRenderer key={block.id} block={block} />
                ))}
              </div>
            </div>
          );
        })}

        {version.sections.length === 0 && (
          <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
            <FileText className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              Секции не были извлечены из этого документа.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── Section Tree (collapsible) ──────────── */

function SectionTree({
  sections,
  activeSectionId,
  onSelect,
}: {
  sections: any[];
  activeSectionId: string | null;
  onSelect: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const hasChildren = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const next = sections[i + 1];
      result[sec.id] = !!next && next.level > sec.level;
    }
    return result;
  }, [sections]);

  const visibleSet = useMemo(() => {
    const visible = new Set<string>();
    const parentStack: { id: string; level: number }[] = [];

    for (const sec of sections) {
      while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= sec.level) {
        parentStack.pop();
      }

      const hidden = parentStack.some((p) => collapsed[p.id]);
      if (!hidden) visible.add(sec.id);

      if (hasChildren[sec.id]) {
        parentStack.push({ id: sec.id, level: sec.level });
      }
    }
    return visible;
  }, [sections, collapsed, hasChildren]);

  return (
    <div className="rounded-lg border bg-white shadow-sm flex-1 overflow-auto min-h-0">
      <div className="p-3 border-b sticky top-0 bg-white z-10">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Структура документа
        </h3>
      </div>
      <div className="p-2 space-y-0.5">
        {sections.map((section: any) => {
          if (!visibleSet.has(section.id)) return null;

          const isLowConf =
            section.confidence < CONFIDENCE_THRESHOLD && section.classificationStatus !== "validated";
          const isActive = activeSectionId === section.id;
          const isParent = hasChildren[section.id];
          const isCollapsed = collapsed[section.id];
          const bothValidated = section.structureStatus === "validated" && section.classificationStatus === "validated";

          return (
            <div
              key={section.id}
              className="flex items-center"
              style={{ paddingLeft: `${(section.level - 1) * 12}px` }}
            >
              {/* Expand/collapse toggle */}
              {isParent ? (
                <button
                  onClick={() => toggle(section.id)}
                  className="flex-shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 transition-transform duration-150",
                      !isCollapsed && "rotate-90"
                    )}
                  />
                </button>
              ) : (
                <span className="w-4 flex-shrink-0" />
              )}

              {/* Section button */}
              <button
                onClick={() => onSelect(section.id)}
                className={cn(
                  "flex items-center gap-1.5 flex-1 min-w-0 rounded px-1.5 py-1.5 text-xs text-left transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-gray-700 hover:bg-gray-100",
                  isLowConf && !isActive && "bg-amber-50/60"
                )}
              >
                {isLowConf && (
                  <AlertTriangle className="h-3 w-3 text-amber-500 flex-shrink-0" />
                )}
                {bothValidated && (
                  <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                )}
                <span className="truncate">{section.title}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────── Section Header ──────────── */

function SectionHeader({
  section,
  isLowConf,
  taxonomyOptions,
  onUpdateClassification,
}: {
  section: any;
  isLowConf: boolean;
  taxonomyOptions: { value: string; label: string; type: string }[];
  onUpdateClassification: (standardSection: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selectedSection, setSelectedSection] = useState(section.standardSection ?? "");

  const confidencePercent = Math.round(section.confidence * 100);
  const confidenceColor =
    confidencePercent >= 90
      ? "text-green-600 bg-green-50"
      : confidencePercent >= 70
        ? "text-blue-600 bg-blue-50"
        : confidencePercent >= 40
          ? "text-amber-600 bg-amber-50"
          : "text-red-600 bg-red-50";

  return (
    <div className="flex items-start gap-3 px-6 py-4 border-b bg-gray-50/50">
      <div className="flex-1">
        <h3
          className={cn(
            "font-semibold text-gray-900",
            section.level === 1 && "text-xl",
            section.level === 2 && "text-lg",
            section.level >= 3 && "text-base"
          )}
        >
          {section.title}
        </h3>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {/* Standard section badge */}
          {section.standardSection && !editing && (
            <span className="rounded bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
              {section.standardSection}
            </span>
          )}

          {/* Confidence */}
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium", confidenceColor)}>
            {confidencePercent}%
          </span>

          {/* Classified by */}
          {section.classifiedBy && (
            <span className="text-xs text-gray-400">
              {CLASSIFIED_BY_LABELS[section.classifiedBy] ?? section.classifiedBy}
            </span>
          )}

          {/* Structure status */}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              section.structureStatus === "validated" && "bg-green-100 text-green-700",
              section.structureStatus === "not_validated" && "bg-gray-100 text-gray-600",
              section.structureStatus === "requires_rework" && "bg-red-100 text-red-700"
            )}
          >
            {STRUCTURE_STATUS_LABELS[section.structureStatus] ?? section.structureStatus}
          </span>

          {/* Classification status */}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              section.classificationStatus === "validated" && "bg-blue-100 text-blue-700",
              section.classificationStatus === "not_validated" && "bg-gray-100 text-gray-600",
              section.classificationStatus === "requires_rework" && "bg-red-100 text-red-700"
            )}
          >
            {CLASSIFICATION_STATUS_LABELS[section.classificationStatus] ?? section.classificationStatus}
          </span>

          {isLowConf && (
            <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              Требует проверки
            </span>
          )}
        </div>

        {/* Inline editor */}
        {editing && (
          <div className="flex items-center gap-2 mt-2">
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            >
              <option value="">— Не определена —</option>
              {taxonomyOptions
                .filter((o) => o.type === "zone")
                .map((o) => (
                  <optgroup key={o.value} label={o.label}>
                    <option value={o.value}>{o.label}</option>
                    {taxonomyOptions
                      .filter((s) => s.type === "subzone" && s.value.startsWith(o.value + "."))
                      .map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </select>
            <button
              onClick={() => {
                onUpdateClassification(selectedSection);
                setEditing(false);
              }}
              className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
            >
              Сохранить
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              Отмена
            </button>
          </div>
        )}
      </div>

      {/* Edit button */}
      {!editing && (
        <button
          onClick={() => setEditing(true)}
          className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Изменить классификацию"
        >
          <Edit3 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SOA Tab — Валидация графика процедур
   ══════════════════════════════════════════════════════════════ */

const LOW_CONFIDENCE_SOA = 0.8;

function SoaTab({ versionId }: { versionId: string }) {
  const [selectedCell, setSelectedCell] = useState<{
    tableId: string;
    row: number;
    col: number;
  } | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAddVisit, setShowAddVisit] = useState(false);
  const [showAddProc, setShowAddProc] = useState(false);
  const [newVisitName, setNewVisitName] = useState("");
  const [newProcName, setNewProcName] = useState("");

  const soaQuery = trpc.processing.getSoaData.useQuery({ docVersionId: versionId });
  const updateCell = trpc.processing.updateSoaCell.useMutation({
    onSuccess: () => {
      soaQuery.refetch();
      setEditingCell(null);
    },
  });
  const validateSoa = trpc.processing.validateSoa.useMutation({
    onSuccess: () => soaQuery.refetch(),
  });
  const addVisit = trpc.processing.addSoaVisit.useMutation({
    onSuccess: () => {
      soaQuery.refetch();
      setShowAddVisit(false);
      setNewVisitName("");
    },
  });
  const addProcedure = trpc.processing.addSoaProcedure.useMutation({
    onSuccess: () => {
      soaQuery.refetch();
      setShowAddProc(false);
      setNewProcName("");
    },
  });

  if (soaQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const tables = soaQuery.data ?? [];

  if (tables.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
        <Table2 className="mx-auto h-10 w-10 text-gray-300" />
        <p className="mt-2 text-sm text-gray-500">
          Таблица SOA не найдена в документе. Возможно, документ не содержит графика процедур.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full overflow-auto pb-6">
      {tables.map((table: any) => {
        const headerData = table.headerData as { visits: string[] };
        const visits = headerData.visits ?? [];
        const cells: any[] = table.cells ?? [];
        const isValidated = table.status === "validated";

        // Group cells by row
        const rowMap = new Map<number, any[]>();
        for (const cell of cells) {
          const row = rowMap.get(cell.rowIndex) ?? [];
          row.push(cell);
          rowMap.set(cell.rowIndex, row);
        }
        const sortedRows = [...rowMap.entries()].sort(([a], [b]) => a - b);

        // Unique procedure names per row
        const procedures = sortedRows.map(([rowIdx, rowCells]) => ({
          rowIdx,
          name: rowCells[0]?.procedureName ?? `Строка ${rowIdx + 1}`,
          cells: rowCells.sort((a: any, b: any) => a.colIndex - b.colIndex),
        }));

        return (
          <div key={table.id} className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>ClinNexus</span>
                  <ChevronRight className="h-3 w-3" />
                  <span>Проекты</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-gray-700 font-medium">Валидация SoA</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900 mt-1">Валидация SoA</h2>
              </div>

              {!isValidated && (
                <button
                  onClick={() => validateSoa.mutate({ soaTableId: table.id })}
                  disabled={validateSoa.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
                >
                  {validateSoa.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Подтвердить соответствие
                </button>
              )}

              {isValidated && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-4 py-2 text-sm font-medium text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  График процедур подтверждён
                </span>
              )}
            </div>

            {/* Original table from document */}
            <div className="rounded-lg border bg-white shadow-sm">
              <div className="px-5 py-3 border-b bg-gray-50/50">
                <h3 className="text-sm font-semibold text-gray-800">
                  {table.title || "Исходная таблица"}
                </h3>
              </div>
              <div className="overflow-x-auto overflow-y-auto max-h-80">
                {table.sourceHtml ? (
                  <OriginalSoaTable
                    html={table.sourceHtml}
                    selectedCell={
                      selectedCell?.tableId === table.id ? selectedCell : null
                    }
                    rawMatrix={table.rawMatrix as string[][]}
                  />
                ) : (
                  <div className="p-4 text-sm text-gray-400 italic">
                    Исходная таблица недоступна
                  </div>
                )}
              </div>
            </div>

            {/* Parsed SOA table (editable) */}
            <div className="rounded-lg border bg-white shadow-sm">
              <div className="px-5 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">
                    Извлечённые данные (для валидации)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  {/* Add procedure button */}
                  {showAddProc ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newProcName}
                        onChange={(e) => setNewProcName(e.target.value)}
                        placeholder="Название процедуры"
                        className="rounded border px-2 py-1 text-xs w-48"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newProcName.trim()) {
                            addProcedure.mutate({
                              soaTableId: table.id,
                              procedureName: newProcName.trim(),
                            });
                          }
                          if (e.key === "Escape") setShowAddProc(false);
                        }}
                      />
                      <button
                        onClick={() => {
                          if (newProcName.trim()) {
                            addProcedure.mutate({
                              soaTableId: table.id,
                              procedureName: newProcName.trim(),
                            });
                          }
                        }}
                        disabled={!newProcName.trim() || addProcedure.isPending}
                        className="rounded bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setShowAddProc(false)}
                        className="rounded border px-2 py-1 text-xs text-gray-600"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddProc(true)}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      + Добавить процедуру
                    </button>
                  )}

                  {/* Add visit button */}
                  {showAddVisit ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newVisitName}
                        onChange={(e) => setNewVisitName(e.target.value)}
                        placeholder="Название визита"
                        className="rounded border px-2 py-1 text-xs w-40"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && newVisitName.trim()) {
                            addVisit.mutate({
                              soaTableId: table.id,
                              visitName: newVisitName.trim(),
                            });
                          }
                          if (e.key === "Escape") setShowAddVisit(false);
                        }}
                      />
                      <button
                        onClick={() => {
                          if (newVisitName.trim()) {
                            addVisit.mutate({
                              soaTableId: table.id,
                              visitName: newVisitName.trim(),
                            });
                          }
                        }}
                        disabled={!newVisitName.trim() || addVisit.isPending}
                        className="rounded bg-brand-600 px-2 py-1 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        OK
                      </button>
                      <button
                        onClick={() => setShowAddVisit(false)}
                        className="rounded border px-2 py-1 text-xs text-gray-600"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddVisit(true)}
                      className="inline-flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      + Добавить визит
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto overflow-y-auto">
                <table className="text-sm border-collapse" style={{ tableLayout: "fixed", minWidth: `${200 + visits.length * 100}px` }}>
                  <colgroup>
                    <col style={{ width: "200px" }} />
                    {visits.map((_: string, i: number) => (
                      <col key={i} style={{ width: "100px" }} />
                    ))}
                  </colgroup>
                  <thead>
                    {/* Multi-level header rows */}
                    {(headerData as any).headerRows?.map((level: { text: string; span: number }[], lvlIdx: number) => (
                      <tr key={`hdr-${lvlIdx}`} className="border-b bg-gray-50">
                        {lvlIdx === 0 && (
                          <th
                            className="sticky left-0 bg-gray-50 px-4 py-2 text-left text-xs font-semibold text-gray-700 border-r z-10"
                            rowSpan={(headerData as any).headerRows?.length ?? 1}
                            style={{ width: "200px" }}
                          >
                            Procedures
                          </th>
                        )}
                        {level.map((hdr: { text: string; span: number }, hIdx: number) => (
                          <th
                            key={hIdx}
                            colSpan={hdr.span}
                            className="px-2 py-2 text-center text-xs font-semibold text-gray-700 border-r border-b"
                          >
                            {hdr.text}
                          </th>
                        ))}
                      </tr>
                    ))}
                    {/* Fallback: single header row if no multi-level data */}
                    {!(headerData as any).headerRows?.length && (
                      <tr className="border-b bg-gray-50">
                        <th className="sticky left-0 bg-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-gray-700 border-r z-10" style={{ width: "200px" }}>
                          Procedures
                        </th>
                        {visits.map((visit: string, colIdx: number) => (
                          <th key={colIdx} className="px-2 py-2.5 text-center text-xs font-semibold text-gray-700 border-r">
                            {visit}
                          </th>
                        ))}
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y">
                    {procedures.map((proc) => {
                      const isRowSelected =
                        selectedCell?.tableId === table.id &&
                        selectedCell?.row === proc.rowIdx;

                      return (
                        <tr
                          key={proc.rowIdx}
                          className={cn(
                            "transition-colors",
                            isRowSelected && "bg-brand-50/40",
                            !isRowSelected && proc.cells.some(
                              (c: any) => c.confidence < LOW_CONFIDENCE_SOA
                            ) && "bg-amber-50/30",
                            !isRowSelected && "hover:bg-gray-50/50"
                          )}
                        >
                          <td className={cn(
                            "sticky left-0 px-4 py-2 text-xs font-medium text-gray-800 border-r z-10",
                            isRowSelected ? "bg-brand-50" : "bg-white"
                          )}>
                            {proc.name}
                          </td>
                          {visits.map((_: string, colIdx: number) => {
                            const cell = proc.cells.find(
                              (c: any) => c.colIndex === colIdx
                            );
                            if (!cell) {
                              return (
                                <td
                                  key={colIdx}
                                  className="px-2 py-2 text-center text-xs text-gray-300 border-r"
                                >
                                  —
                                </td>
                              );
                            }

                            const displayVal =
                              cell.manualValue ?? cell.normalizedValue ?? "";
                            const isLow = cell.confidence < LOW_CONFIDENCE_SOA;
                            const isSelected =
                              selectedCell?.tableId === table.id &&
                              selectedCell?.row === cell.rowIndex &&
                              selectedCell?.col === cell.colIndex;
                            const isEditing = editingCell === cell.id;

                            return (
                              <td
                                key={colIdx}
                                onClick={() => {
                                  setSelectedCell({
                                    tableId: table.id,
                                    row: cell.rowIndex,
                                    col: cell.colIndex,
                                  });
                                }}
                                onDoubleClick={() => {
                                  if (!isValidated) {
                                    setEditingCell(cell.id);
                                    setEditValue(displayVal);
                                  }
                                }}
                                className={cn(
                                  "px-2 py-2 text-center text-xs border-r cursor-pointer transition-colors relative",
                                  isSelected && "ring-2 ring-inset ring-brand-500 bg-brand-100/60",
                                  isLow && !isSelected && "bg-amber-100/60",
                                  !isSelected && !isLow && "hover:bg-gray-100/50"
                                )}
                              >
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        updateCell.mutate({
                                          cellId: cell.id,
                                          manualValue: editValue,
                                        });
                                      }
                                      if (e.key === "Escape") {
                                        setEditingCell(null);
                                      }
                                    }}
                                    onBlur={() => {
                                      updateCell.mutate({
                                        cellId: cell.id,
                                        manualValue: editValue,
                                      });
                                    }}
                                    className="w-full border rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand-400"
                                    autoFocus
                                  />
                                ) : (
                                  <span
                                    className={cn(
                                      displayVal === "X" && "text-green-700 font-bold",
                                      displayVal === "\u2013" && "text-gray-400"
                                    )}
                                  >
                                    {displayVal === "X" ? (
                                      <Check className="h-4 w-4 mx-auto text-green-600" />
                                    ) : (
                                      displayVal || ""
                                    )}
                                  </span>
                                )}
                                {isLow && !isEditing && (
                                  <span
                                    className="absolute top-0.5 right-0.5"
                                    title={`Уверенность: ${Math.round(cell.confidence * 100)}%`}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Score info */}
              <div className="px-5 py-2 border-t bg-gray-50/50 flex items-center gap-4 text-xs text-gray-500">
                <span>
                  Оценка SOA: <strong className="text-gray-700">{table.soaScore?.toFixed(1)}</strong>
                </span>
                <span>
                  Процедур: <strong className="text-gray-700">{procedures.length}</strong>
                </span>
                <span>
                  Визитов: <strong className="text-gray-700">{visits.length}</strong>
                </span>
                {cells.some((c: any) => c.confidence < LOW_CONFIDENCE_SOA) && (
                  <span className="inline-flex items-center gap-1 text-amber-600">
                    <AlertTriangle className="h-3 w-3" />
                    Ячейки с низкой уверенностью подсвечены
                  </span>
                )}
                <span className="text-gray-400 ml-auto">
                  Двойной клик для редактирования ячейки
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────── Original SOA Table (read-only, with cell highlighting) ──────────── */

function OriginalSoaTable({
  html,
  selectedCell,
  rawMatrix,
}: {
  html: string;
  selectedCell: { row: number; col: number } | null;
  rawMatrix: string[][];
}) {
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tableRef.current) return;

    const allRows = tableRef.current.querySelectorAll("tr");
    // Clear all previous highlights
    allRows.forEach((row) => {
      (row as HTMLElement).style.background = "";
      row.querySelectorAll("td, th").forEach((cell) => {
        (cell as HTMLElement).style.outline = "";
        (cell as HTMLElement).style.background = "";
      });
    });

    if (!selectedCell) return;

    // Detect how many header rows exist in rawMatrix
    const headerRowCount = rawMatrix.length > 0
      ? rawMatrix.findIndex((r, i) => i > 0 && r[0]?.trim() !== "" && r.slice(1).some((c) => /^[xхXХ✓✔☑●+×]$/i.test(c.trim())))
      : 1;
    const hdrCount = headerRowCount > 0 ? headerRowCount : 1;

    const targetRowIdx = selectedCell!.row + hdrCount;
    const targetColIdx = selectedCell!.col + 1;

    if (targetRowIdx < allRows.length) {
      // Highlight entire row
      const row = allRows[targetRowIdx] as HTMLElement;
      row.style.background = "#f0f7ff";

      // Highlight specific cell
      const cells = row.querySelectorAll("td, th");
      if (targetColIdx < cells.length) {
        const cell = cells[targetColIdx] as HTMLElement;
        cell.style.outline = "2px solid #3b82f6";
        cell.style.background = "#dbeafe";
        cell.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }, [selectedCell, rawMatrix]);

  return (
    <div
      ref={tableRef}
      className="prose prose-sm max-w-none [&_table]:w-full [&_table]:table-fixed [&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:bg-gray-50 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_td]:text-xs"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ──────────── Content Block Renderer ──────────── */

function ContentBlockRenderer({ block }: { block: any }) {
  switch (block.type) {
    case "paragraph":
      return (
        <p
          className="text-sm text-gray-800 leading-relaxed"
          dangerouslySetInnerHTML={
            block.rawHtml ? { __html: block.rawHtml } : undefined
          }
        >
          {block.rawHtml ? undefined : block.content}
        </p>
      );

    case "table":
      return (
        <div className="overflow-auto rounded border my-2">
          {block.rawHtml ? (
            <div
              className="prose prose-sm max-w-none [&_table]:w-full [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1.5 [&_th]:bg-gray-50 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold"
              dangerouslySetInnerHTML={{ __html: block.rawHtml }}
            />
          ) : (
            <pre className="p-3 text-xs text-gray-600 whitespace-pre-wrap">
              {block.content}
            </pre>
          )}
        </div>
      );

    case "list":
      return (
        <div className="flex items-start gap-2 text-sm text-gray-800 ml-4">
          <span className="text-gray-400 mt-0.5">•</span>
          <span
            dangerouslySetInnerHTML={
              block.rawHtml ? { __html: block.rawHtml } : undefined
            }
          >
            {block.rawHtml ? undefined : block.content}
          </span>
        </div>
      );

    case "footnote":
      return (
        <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-3 my-1">
          {block.content}
        </p>
      );

    case "image":
      return (
        <div className="my-2 rounded border bg-gray-50 p-4 text-center text-xs text-gray-400">
          [Изображение]
        </div>
      );

    default:
      return (
        <p className="text-sm text-gray-700">{block.content}</p>
      );
  }
}
