"use client";

import { useState, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  FileText,
  Eye,
  AlertTriangle,
  GitCompare,
  Download,
  Trash2,
  Star,
  Upload,
  Loader2,
  Check,
  X,
  Search,
  Database,
  ChevronRight,
  Shield,
  FileSearch,
  FilePlus2,
  CircleCheck,
  Circle,
  CircleDot,
  CircleAlert,
  Pencil,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/* ──────────────────────── Types & Constants ──────────────────────── */

type Tab = "documents" | "knowledge" | "findings";

const DOC_TYPES = [
  { type: "protocol", label: "Протокол" },
  { type: "icf", label: "Информированное согласие" },
  { type: "ib", label: "Брошюра исследователя" },
  { type: "csr", label: "Отчёт клинического исследования" },
] as const;

const VERSION_STATUS_LABELS: Record<string, string> = {
  uploading: "Загрузка",
  parsing: "Разбор структуры",
  classifying_sections: "Присвоение секций",
  extracting_facts: "Выделение фактов",
  detecting_soa: "Определение SoA",
  ready: "Готов",
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
  impact_assessment: "Оценка влияния",
  parsed: "Разобран",
  error: "Ошибка",
};

const PIPELINE_STAGES = [
  { key: "parsing", label: "Разбор структуры" },
  { key: "classifying_sections", label: "Присвоение секций" },
  { key: "extracting_facts", label: "Выделение фактов" },
  { key: "detecting_soa", label: "Анализ графика процедур" },
  { key: "intra_audit", label: "Внутридокументный аудит" },
] as const;

type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];

const STAGE_ORDER: Record<string, number> = {
  uploading: -1,
  parsing: 0,
  classifying_sections: 1,
  extracting_facts: 2,
  detecting_soa: 3,
  intra_audit: 4,
  parsed: 5,
  ready: 5,
  error: -2,
};

const TERMINAL_STATUSES = new Set(["parsed", "ready", "error"]);

function getStageState(
  stageKey: PipelineStageKey,
  currentStatus: string
): "completed" | "current" | "pending" | "error" {
  if (currentStatus === "error") {
    return "pending";
  }
  const currentIdx = STAGE_ORDER[currentStatus] ?? -1;
  const stageIdx = STAGE_ORDER[stageKey] ?? 99;

  if (currentIdx >= 5) return "completed";
  if (stageIdx < currentIdx) return "completed";
  if (stageIdx === currentIdx) return "current";
  return "pending";
}

function PipelineStatus({ status }: { status: string }) {
  if (status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Загрузка...
      </span>
    );
  }

  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
        <CircleAlert className="h-3.5 w-3.5" />
        Ошибка обработки
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0">
      {PIPELINE_STAGES.map((stage, idx) => {
        const state = getStageState(stage.key, status);
        return (
          <div key={stage.key} className="flex items-center">
            {idx > 0 && (
              <div
                className={cn(
                  "h-px w-3 sm:w-5",
                  state === "completed"
                    ? "bg-green-400"
                    : state === "current"
                      ? "bg-blue-300"
                      : "bg-gray-200"
                )}
              />
            )}
            <div
              className="group relative flex items-center"
              title={stage.label}
            >
              {state === "completed" ? (
                <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
              ) : state === "current" ? (
                <CircleDot className="h-4 w-4 text-blue-500 animate-pulse shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-gray-300 shrink-0" />
              )}
              <span
                className={cn(
                  "absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none pointer-events-none",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                  state === "completed"
                    ? "text-green-600"
                    : state === "current"
                      ? "text-blue-600 font-medium"
                      : "text-gray-400"
                )}
              >
                {stage.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const POLL_INTERVAL = 3000;

const FACT_STATUS_LABELS: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Проверен",
  validated: "Подтверждён",
  rejected: "Отклонён",
};

const FINDING_STATUS_LABELS: Record<string, string> = {
  pending: "Открыта",
  confirmed: "Подтверждена",
  rejected: "Отклонена",
  resolved: "Решена",
};

const FINDING_TYPE_LABELS: Record<string, string> = {
  editorial: "Редакционная",
  semantic: "Семантическая",
};

/* ──────────────────────── Main Page ──────────────────────── */

export default function StudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("documents");
  const [editing, setEditing] = useState(false);

  const utils = trpc.useUtils();
  const studyQuery = trpc.study.getById.useQuery({ id });

  if (studyQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }
  if (!studyQuery.data) {
    return <p className="text-sm text-red-500">Исследование не найдено</p>;
  }

  const study = studyQuery.data;

  const tabs: { key: Tab; label: string }[] = [
    { key: "documents", label: "Документы" },
    { key: "knowledge", label: "База знаний" },
    { key: "findings", label: "Аудиторские находки" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/studies" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Исследование {study.title}</h1>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Редактировать характеристики"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          {!editing && (
            <p className="mt-1 text-sm text-gray-500">
              {[study.protocolTitle, study.sponsor, study.drug, study.therapeuticArea, study.phase && `Фаза ${study.phase}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>

      {/* Study properties edit */}
      {editing && (
        <StudyEditForm
          study={study}
          onSave={() => {
            setEditing(false);
            utils.study.getById.invalidate({ id });
            utils.study.list.invalidate();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-5 py-3 text-sm font-medium border-b-2 transition-colors",
                activeTab === tab.key
                  ? "border-brand-600 text-brand-700 bg-brand-50/50"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "documents" && (
        <DocumentsTab studyId={id} documents={study.documents} onRefetch={studyQuery.refetch} />
      )}
      {activeTab === "knowledge" && <KnowledgeBaseTab studyId={id} />}
      {activeTab === "findings" && <FindingsTab studyId={id} />}
    </div>
  );
}

/* ──────────────────── Study Edit Form ──────────────────── */

function StudyEditForm({
  study,
  onSave,
  onCancel,
}: {
  study: any;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(study.title ?? "");
  const [protocolTitle, setProtocolTitle] = useState(study.protocolTitle ?? "");
  const [sponsor, setSponsor] = useState(study.sponsor ?? "");
  const [drug, setDrug] = useState(study.drug ?? "");
  const [therapeuticArea, setTherapeuticArea] = useState(study.therapeuticArea ?? "");
  const [phase, setPhase] = useState(study.phase ?? "");

  const updateMutation = trpc.study.update.useMutation({ onSuccess: onSave });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: study.id,
      title: title || undefined,
      protocolTitle: protocolTitle || undefined,
      sponsor: sponsor || undefined,
      drug: drug || undefined,
      therapeuticArea: therapeuticArea || undefined,
      phase: phase || undefined,
    });
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-4 shadow-sm space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Характеристики исследования</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Номер протокола <span className="text-red-500">*</span>
          </label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Название протокола</label>
          <input type="text" value={protocolTitle} onChange={(e) => setProtocolTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Спонсор</label>
          <input type="text" value={sponsor} onChange={(e) => setSponsor(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Препарат / МИ</label>
          <input type="text" value={drug} onChange={(e) => setDrug(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Терапевтическая область</label>
          <input type="text" value={therapeuticArea} onChange={(e) => setTherapeuticArea(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Фаза исследования</label>
          <input type="text" value={phase} onChange={(e) => setPhase(e.target.value)} className={inputClass} />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={updateMutation.isPending || !title}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Сохранение...</>
          ) : (
            <><Check className="h-4 w-4" /> Сохранить</>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

/* ──────────────────────── Documents Tab ──────────────────────── */

function DocumentsTab({
  studyId,
  documents,
  onRefetch,
}: {
  studyId: string;
  documents: any[];
  onRefetch: () => void;
}) {
  const [selectedType, setSelectedType] = useState<string>("protocol");
  const [showUpload, setShowUpload] = useState(false);

  const docsOfType = documents.filter((d) => d.type === selectedType);
  const selectedDoc = docsOfType[0];

  const allVersions: any[] = documents.flatMap((d: any) => d.versions);
  const processingVersionIds = allVersions
    .filter((v: any) => !TERMINAL_STATUSES.has(v.status) && v.status !== "uploading")
    .map((v: any) => v.id);

  const statusPoll = trpc.document.getVersionStatuses.useQuery(
    { versionIds: processingVersionIds.length > 0 ? processingVersionIds : ["00000000-0000-0000-0000-000000000000"] },
    {
      enabled: processingVersionIds.length > 0,
      refetchInterval: POLL_INTERVAL,
      refetchIntervalInBackground: false,
    }
  );

  const liveStatuses = new Map<string, string>();
  if (statusPoll.data) {
    for (const v of statusPoll.data) {
      liveStatuses.set(v.id, v.status);
    }
  }

  useEffect(() => {
    if (!statusPoll.data) return;
    const anyChanged = statusPoll.data.some((polled) => {
      const orig = allVersions.find((v: any) => v.id === polled.id);
      return orig && orig.status !== polled.status && TERMINAL_STATUSES.has(polled.status);
    });
    if (anyChanged) onRefetch();
  }, [statusPoll.data]);

  const deleteVersion = trpc.document.deleteVersion.useMutation({ onSuccess: onRefetch });
  const setCurrent = trpc.document.setCurrentVersion.useMutation({ onSuccess: onRefetch });

  const handleDownload = async (versionId: string) => {
    const token = (await import("@/lib/auth-store")).useAuthStore.getState().accessToken;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace("/trpc", "");
    const res = await fetch(`${apiUrl}/api/download/${versionId}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''(.+)/)?.[1]
      ? decodeURIComponent(res.headers.get("content-disposition")!.match(/filename\*=UTF-8''(.+)/)![1])
      : "document.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left: Document types */}
      <div className="col-span-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Типы документов
        </h3>
        <div className="space-y-1">
          {DOC_TYPES.map((dt) => {
            const count = documents.filter((d) => d.type === dt.type).flatMap((d: any) => d.versions).length;
            return (
              <button
                key={dt.type}
                onClick={() => { setSelectedType(dt.type); setShowUpload(false); }}
                className={cn(
                  "flex items-center justify-between w-full rounded-lg px-3 py-2.5 text-sm text-left transition-colors",
                  selectedType === dt.type
                    ? "bg-brand-50 text-brand-700 font-medium"
                    : "text-gray-700 hover:bg-gray-100"
                )}
              >
                <span>{dt.label}</span>
                {count > 0 && (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Versions */}
      <div className="col-span-9">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Версии: {DOC_TYPES.find((d) => d.type === selectedType)?.label}
          </h3>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Upload className="h-4 w-4" />
            + Добавить версию
          </button>
        </div>

        {/* Upload form */}
        {showUpload && (
          <VersionUploadForm
            studyId={studyId}
            docType={selectedType}
            existingDoc={selectedDoc}
            onSuccess={() => { setShowUpload(false); onRefetch(); }}
            onCancel={() => setShowUpload(false)}
          />
        )}

        {/* Versions list */}
        {(!selectedDoc || selectedDoc.versions.length === 0) && !showUpload && (
          <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-2 text-sm text-gray-500">
              Версии не загружены. Нажмите «+ Добавить версию».
            </p>
          </div>
        )}

        <div className="space-y-3 mt-3">
          {selectedDoc?.versions.map((ver: any) => (
            <div
              key={ver.id}
              className={cn(
                "rounded-lg border bg-white p-4 shadow-sm",
                ver.isCurrent && "ring-2 ring-brand-400"
              )}
            >
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {ver.versionLabel || `v${ver.versionNumber}`}
                    </span>
                    <span className="text-xs text-gray-400">
                      от {new Date(ver.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                    {ver.isCurrent && (
                      <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                    )}
                  </div>
                  <div className="mt-2 mb-1">
                    <PipelineStatus status={liveStatuses.get(ver.id) ?? ver.status} />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Link
                    href={`/documents/${ver.id}`}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Просмотр документа"
                  >
                    <Eye className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/audit/${ver.id}`}
                    className="rounded-lg p-2 text-gray-400 hover:bg-amber-50 hover:text-amber-600"
                    title="Внутридокументный аудит"
                  >
                    <Shield className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/findings/${ver.id}`}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Все находки"
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </Link>
                  {selectedType === "protocol" && (
                    <>
                      <GenerateDocButton
                        protocolVersionId={ver.id}
                        protocolLabel={ver.versionLabel || `v${ver.versionNumber}`}
                      />
                      <CrossDocAuditButton
                        studyId={studyId}
                        protocolVersionId={ver.id}
                        protocolLabel={ver.versionLabel || `v${ver.versionNumber}`}
                      />
                    </>
                  )}
                  <CompareVersionButton
                    versionId={ver.id}
                    versionLabel={ver.versionLabel || `v${ver.versionNumber}`}
                    allVersions={selectedDoc?.versions ?? []}
                  />
                  <button
                    onClick={() => handleDownload(ver.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Скачать документ"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  {!ver.isCurrent && (
                    <button
                      onClick={() => setCurrent.mutate({ versionId: ver.id })}
                      className="rounded-lg p-2 text-gray-400 hover:bg-amber-50 hover:text-amber-600"
                      title="Пометить как актуальную"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm("Удалить эту версию?")) {
                        deleteVersion.mutate({ versionId: ver.id });
                      }
                    }}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    title="Удалить версию"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Version Upload Form ──────────────────── */

function VersionUploadForm({
  studyId,
  docType,
  existingDoc,
  onSuccess,
  onCancel,
}: {
  studyId: string;
  docType: string;
  existingDoc: any;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [versionLabel, setVersionLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const createDoc = trpc.document.create.useMutation();
  const getUploadUrl = trpc.document.getUploadUrl.useMutation();
  const confirmUpload = trpc.document.confirmUpload.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !versionLabel) return;

    setUploading(true);
    setError("");

    try {
      let docId = existingDoc?.id;
      if (!docId) {
        const doc = await createDoc.mutateAsync({
          studyId,
          type: docType as any,
          title: file.name.replace(/\.docx$/i, ""),
        });
        docId = doc.id;
      }

      const { versionId } = await getUploadUrl.mutateAsync({
        documentId: docId,
        versionLabel,
      });

      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), "")
      );

      await confirmUpload.mutateAsync({ versionId, fileBuffer: base64 });
      onSuccess();
    } catch (err: any) {
      setError(err.message ?? "Ошибка загрузки");
      setUploading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border bg-white p-4 shadow-sm space-y-3 mb-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Загрузка новой версии</h4>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Версия <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            required
            placeholder="Напр., v2.0, v2.1"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Файл (.docx) <span className="text-red-500">*</span>
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2 cursor-pointer text-sm transition-colors",
              file ? "border-brand-300 bg-brand-50" : "border-gray-300 hover:border-gray-400"
            )}
          >
            <FileText className={cn("h-4 w-4", file ? "text-brand-600" : "text-gray-400")} />
            <span className={file ? "text-gray-900" : "text-gray-500"}>
              {file ? file.name : "Выберите файл"}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!file || !versionLabel || uploading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Загрузить
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

/* ──────────────────── Compare Version Button ──────────────────── */

function CompareVersionButton({
  versionId,
  versionLabel,
  allVersions,
}: {
  versionId: string;
  versionLabel: string;
  allVersions: any[];
}) {
  const [open, setOpen] = useState(false);
  const otherVersions = allVersions.filter((v) => v.id !== versionId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  if (otherVersions.length === 0) {
    return (
      <span
        className="rounded-lg p-2 text-gray-300 cursor-not-allowed"
        title="Нет других версий для сравнения"
      >
        <GitCompare className="h-4 w-4" />
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        title="Сравнить версии"
      >
        <GitCompare className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border bg-white shadow-lg py-1">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Сравнить {versionLabel} с:
            </p>
          </div>
          {otherVersions.map((other: any) => (
            <Link
              key={other.id}
              href={`/compare/${versionId}/${other.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-brand-50 hover:text-brand-700"
            >
              <GitCompare className="h-3.5 w-3.5 text-gray-400" />
              <span>{other.versionLabel || `v${other.versionNumber}`}</span>
              <span className="text-xs text-gray-400 ml-auto">
                от {new Date(other.createdAt).toLocaleDateString("ru-RU")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Cross-Document Audit Button ──────────────────── */

function CrossDocAuditButton({
  studyId,
  protocolVersionId,
  protocolLabel,
}: {
  studyId: string;
  protocolVersionId: string;
  protocolLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const docsQuery = trpc.audit.getStudyDocumentsForInterAudit.useQuery(
    { studyId },
    { enabled: open }
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-2 text-gray-400 hover:bg-purple-50 hover:text-purple-600"
        title="Междокументный аудит"
      >
        <FileSearch className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-lg border bg-white shadow-lg py-1">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Аудит {protocolLabel} vs документ:
            </p>
          </div>
          {docsQuery.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
          ) : !docsQuery.data || docsQuery.data.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              Нет доступных документов ICF или CSR
            </div>
          ) : (
            docsQuery.data.map((doc) => (
              <div key={doc.id}>
                <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500">
                  {doc.type === "icf" ? "Информированное согласие" : "Отчёт клинического исследования"}
                </div>
                {doc.versions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400">Нет готовых версий</div>
                ) : (
                  doc.versions.map((ver) => (
                    <Link
                      key={ver.id}
                      href={`/cross-audit/${protocolVersionId}/${ver.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700"
                    >
                      <FileSearch className="h-3.5 w-3.5 text-gray-400" />
                      <span>{doc.title} — {ver.versionLabel || `v${ver.versionNumber}`}</span>
                      {ver.isCurrent && (
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500 ml-auto" />
                      )}
                    </Link>
                  ))
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Generate Document Button ──────────────────── */

function GenerateDocButton({
  protocolVersionId,
  protocolLabel,
}: {
  protocolVersionId: string;
  protocolLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [docType, setDocType] = useState<"icf" | "csr">("icf");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [starting, setStarting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const templatesQuery = trpc.generation.listTemplates.useQuery(
    { docType },
    { enabled: open }
  );

  const startGeneration = trpc.generation.startGeneration.useMutation({
    onSuccess: (data) => {
      setOpen(false);
      setStarting(false);
      router.push(`/generate/${data.generatedDocId}`);
    },
    onError: () => {
      setStarting(false);
    },
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  useEffect(() => {
    setSelectedTemplateId("");
  }, [docType]);

  const handleStart = () => {
    setStarting(true);
    startGeneration.mutate({
      protocolVersionId,
      docType,
      templateId: selectedTemplateId || undefined,
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="rounded-lg p-2 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600"
        title="Сгенерировать документ"
      >
        <FilePlus2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-96 rounded-lg border bg-white shadow-lg">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold text-gray-900">
              Генерация документа из {protocolLabel}
            </p>
          </div>

          <div className="px-4 py-3 space-y-3">
            {/* doc type selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Тип документа
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDocType("icf")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    docType === "icf"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  ICF
                </button>
                <button
                  onClick={() => setDocType("csr")}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    docType === "csr"
                      ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  )}
                >
                  CSR
                </button>
              </div>
            </div>

            {/* template selector */}
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">
                Шаблон документа
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">По умолчанию</option>
                {templatesQuery.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {templatesQuery.isLoading && (
                <p className="text-xs text-gray-400 mt-1">Загрузка шаблонов...</p>
              )}
            </div>
          </div>

          <div className="px-4 py-3 border-t bg-gray-50 rounded-b-lg flex gap-2">
            <button
              onClick={handleStart}
              disabled={starting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Запуск...
                </>
              ) : (
                <>
                  <FilePlus2 className="h-4 w-4" />
                  Начать
                </>
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Knowledge Base Tab ──────────────────── */

function KnowledgeBaseTab({ studyId }: { studyId: string }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");

  const factsQuery = trpc.processing.listFactsByStudy.useQuery({ studyId });

  const facts = (factsQuery.data ?? []).filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (classFilter !== "all" && f.factClass !== classFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        f.factKey.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по фактам..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все статусы</option>
          <option value="extracted">Извлечён</option>
          <option value="verified">Проверен</option>
          <option value="validated">Подтверждён</option>
          <option value="rejected">Отклонён</option>
        </select>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все типы</option>
          <option value="general">Общие</option>
          <option value="phase_specific">Фаза-специфичные</option>
        </select>
      </div>

      {/* Table */}
      {factsQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : facts.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <Database className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            {search ? "Ничего не найдено" : "Факты ещё не извлечены"}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Факт</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Значение</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Статус</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Источник</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {facts.map((fact) => (
                <tr key={fact.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-gray-900">{fact.factKey}</span>
                      <span className="block text-xs text-gray-400">{fact.factClass}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{fact.value}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        fact.status === "validated" && "bg-green-100 text-green-700",
                        fact.status === "extracted" && "bg-gray-100 text-gray-600",
                        fact.status === "verified" && "bg-blue-100 text-blue-700",
                        fact.status === "rejected" && "bg-red-100 text-red-700"
                      )}
                    >
                      {FACT_STATUS_LABELS[fact.status] ?? fact.status}
                    </span>
                    {fact.hasContradiction && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/documents/${fact.docVersion.id}`}
                      className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline"
                    >
                      {fact.docVersion.document.title}{" "}
                      {fact.docVersion.versionLabel ?? `v${fact.docVersion.versionNumber}`}
                      <ChevronRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Findings Tab ──────────────────── */

function FindingsTab({ studyId }: { studyId: string }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const findingsQuery = trpc.processing.listFindingsByStudy.useQuery({ studyId });

  const findings = (findingsQuery.data ?? []).filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все статусы</option>
          <option value="pending">Открыта</option>
          <option value="confirmed">Подтверждена</option>
          <option value="rejected">Отклонена</option>
          <option value="resolved">Решена</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все категории</option>
          <option value="editorial">Редакционная</option>
          <option value="semantic">Семантическая</option>
        </select>
      </div>

      {/* Table */}
      {findingsQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : findings.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">Находок не найдено</p>
        </div>
      ) : (
        <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Описание</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-28">Статус</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-32">Серьёзность</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-40">Документ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {findings.map((finding) => {
                const severity = (finding.extraAttributes as any)?.severity ?? "—";
                return (
                  <tr key={finding.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{finding.description}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-xs font-medium",
                          finding.status === "pending" && "bg-amber-100 text-amber-700",
                          finding.status === "confirmed" && "bg-green-100 text-green-700",
                          finding.status === "rejected" && "bg-gray-100 text-gray-600",
                          finding.status === "resolved" && "bg-blue-100 text-blue-700"
                        )}
                      >
                        {FINDING_STATUS_LABELS[finding.status] ?? finding.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {severity !== "—" ? (
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-xs font-bold uppercase",
                            severity === "CRITICAL" && "bg-red-600 text-white",
                            severity === "MAJOR" && "bg-orange-500 text-white",
                            severity === "MINOR" && "bg-yellow-400 text-yellow-900"
                          )}
                        >
                          {severity}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/documents/${finding.docVersion.id}`}
                        className="text-sm text-brand-600 hover:underline"
                      >
                        {finding.docVersion.document.title}{" "}
                        {finding.docVersion.versionLabel ?? `v${finding.docVersion.versionNumber}`}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
