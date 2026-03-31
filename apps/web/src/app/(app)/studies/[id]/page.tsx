"use client";

import { useState, useRef } from "react";
import { useParams } from "next/navigation";
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

const VERSION_STATUS_COLORS: Record<string, string> = {
  uploading: "bg-gray-100 text-gray-600",
  parsing: "bg-blue-100 text-blue-700",
  classifying_sections: "bg-blue-100 text-blue-700",
  extracting_facts: "bg-blue-100 text-blue-700",
  detecting_soa: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  intra_audit: "bg-amber-100 text-amber-700",
  inter_audit: "bg-amber-100 text-amber-700",
  impact_assessment: "bg-amber-100 text-amber-700",
  parsed: "bg-teal-100 text-teal-700",
  error: "bg-red-100 text-red-700",
};

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
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Link href="/studies" className="hover:text-gray-600">Исследования</Link>
            <span>/</span>
            <span className="text-gray-600">{study.title}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{study.title}</h1>
        </div>
      </div>

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
                  <div className="mt-1">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium",
                        VERSION_STATUS_COLORS[ver.status] ?? "bg-gray-100 text-gray-600"
                      )}
                    >
                      {VERSION_STATUS_LABELS[ver.status] ?? ver.status}
                    </span>
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
                  <Link
                    href={`/compare?old=${ver.id}`}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="Сравнение версий"
                  >
                    <GitCompare className="h-4 w-4" />
                  </Link>
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
          title: DOC_TYPES.find((d) => d.type === docType)?.label ?? docType,
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
