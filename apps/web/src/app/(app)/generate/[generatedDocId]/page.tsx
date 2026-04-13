"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ArrowLeft,
  FileText,
  Loader2,
  Check,
  X,
  Download,
  Save,
  AlertTriangle,
  SkipForward,
  ChevronRight,
  FileEdit,
} from "lucide-react";
import { openInWord } from "@/lib/open-in-word";

/* ═══════════ Constants ═══════════ */

const SECTION_STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  generating: "Генерация...",
  qa_checking: "QA проверка...",
  completed: "Готов",
  skipped: "Пропущен",
  failed: "Ошибка",
};

const SECTION_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-500",
  generating: "bg-blue-100 text-blue-600",
  qa_checking: "bg-amber-100 text-amber-600",
  completed: "bg-green-100 text-green-700",
  skipped: "bg-gray-100 text-gray-400",
  failed: "bg-red-100 text-red-600",
};

const SECTION_STATUS_ICONS: Record<string, typeof Loader2> = {
  pending: FileText,
  generating: Loader2,
  qa_checking: Loader2,
  completed: Check,
  skipped: SkipForward,
  failed: X,
};

const DOC_STATUS_LABELS: Record<string, string> = {
  generating: "Генерация...",
  qa_checking: "QA проверка...",
  completed: "Завершено",
  failed: "Ошибка",
};

/* ═══════════ Page ═══════════ */

export default function GenerateDocPage() {
  const { generatedDocId } = useParams<{ generatedDocId: string }>();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const docQuery = trpc.generation.getGeneratedDoc.useQuery(
    { generatedDocId },
    { refetchInterval: (data) => {
      const status = data?.state?.data?.status;
      return status === "generating" || status === "qa_checking" ? 3000 : false;
    }}
  );

  const updateContent = trpc.generation.updateSectionContent.useMutation({
    onSuccess: () => {
      setSaving(false);
      setIsEditing(false);
      docQuery.refetch();
    },
    onError: () => setSaving(false),
  });

  const doc = docQuery.data;
  const sections = doc?.sections ?? [];

  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? null;

  useEffect(() => {
    if (sections.length > 0 && !selectedSectionId) {
      const first = sections.find((s) => s.status === "completed") ?? sections[0];
      setSelectedSectionId(first.id);
    }
  }, [sections, selectedSectionId]);

  useEffect(() => {
    if (selectedSection) {
      setEditContent(selectedSection.content);
      setIsEditing(false);
    }
  }, [selectedSection?.id, selectedSection?.content]);

  const handleSave = useCallback(() => {
    if (!selectedSectionId) return;
    setSaving(true);
    updateContent.mutate({ sectionId: selectedSectionId, content: editContent });
  }, [selectedSectionId, editContent, updateContent]);

  const handleExport = useCallback(async () => {
    const token = (await import("@/lib/auth-store")).useAuthStore.getState().accessToken;
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace("/trpc", "");
    const res = await fetch(`${apiUrl}/api/generated-doc-export/${generatedDocId}`, {
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
  }, [generatedDocId]);

  if (docQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }
  if (!doc) {
    return <p className="text-sm text-red-500">Документ не найден</p>;
  }

  const docLabel = doc.docType === "icf" ? "ICF" : "CSR";
  const completedCount = sections.filter((s) => s.status === "completed").length;
  const totalCount = sections.filter((s) => s.status !== "skipped").length;
  const isGenerating = doc.status === "generating" || doc.status === "qa_checking";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/studies" className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span>{doc.studyTitle}</span>
              <ChevronRight className="h-3 w-3" />
              <span>{doc.protocolTitle} {doc.protocolLabel}</span>
            </div>
            <h1 className="text-lg font-bold text-gray-900">
              Генерация {docLabel}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            {isGenerating && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            <span className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              isGenerating ? "bg-blue-100 text-blue-700" :
              doc.status === "completed" ? "bg-green-100 text-green-700" :
              "bg-red-100 text-red-700"
            )}>
              {DOC_STATUS_LABELS[doc.status] ?? doc.status}
            </span>
            <span className="text-gray-400">
              {completedCount}/{totalCount} разделов
            </span>
          </div>
          <button
            onClick={() => openInWord({ mode: "generation_review", generatedDocId })}
            disabled={doc.status !== "completed"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <FileEdit className="h-4 w-4" />
            Открыть в Word
          </button>
          <button
            onClick={handleExport}
            disabled={doc.status !== "completed"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Экспорт Word
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — structure */}
        <div className="w-80 border-r bg-gray-50 overflow-y-auto shrink-0">
          <div className="px-4 py-3 border-b bg-white">
            <h2 className="text-sm font-semibold text-gray-700">Структура документа</h2>
          </div>
          <div className="p-2 space-y-0.5">
            {sections.map((section) => {
              const Icon = SECTION_STATUS_ICONS[section.status] ?? FileText;
              const isActive = section.id === selectedSectionId;
              const isAnimating = section.status === "generating" || section.status === "qa_checking";

              return (
                <button
                  key={section.id}
                  onClick={() => setSelectedSectionId(section.id)}
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                    isActive
                      ? "bg-white shadow-sm ring-1 ring-brand-200 text-brand-700"
                      : "text-gray-700 hover:bg-white hover:shadow-sm"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isAnimating && "animate-spin",
                      section.status === "completed" && "text-green-500",
                      section.status === "failed" && "text-red-500",
                      section.status === "skipped" && "text-gray-300",
                      section.status === "pending" && "text-gray-300",
                      (section.status === "generating" || section.status === "qa_checking") && "text-blue-500"
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="block truncate font-medium">
                      {section.order}. {section.title}
                    </span>
                    <span
                      className={cn(
                        "inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        SECTION_STATUS_COLORS[section.status] ?? "bg-gray-100 text-gray-500"
                      )}
                    >
                      {SECTION_STATUS_LABELS[section.status] ?? section.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel — content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedSection ? (
            <>
              {/* Section header */}
              <div className="flex items-center justify-between px-6 py-3 border-b bg-white shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    {selectedSection.title}
                  </h2>
                  {selectedSection.standardSection && (
                    <span className="text-xs text-gray-400">
                      Секция: {selectedSection.standardSection}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedSection.status === "completed" && !isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Редактировать
                    </button>
                  )}
                  {isEditing && (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Сохранить
                      </button>
                      <button
                        onClick={() => {
                          setEditContent(selectedSection.content);
                          setIsEditing(false);
                        }}
                        className="rounded-lg border px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        Отмена
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* QA findings banner */}
              {selectedSection.qaFindings && Array.isArray(selectedSection.qaFindings) && (selectedSection.qaFindings as any[]).length > 0 && (
                <div className="px-6 py-2 bg-amber-50 border-b shrink-0">
                  <div className="flex items-center gap-2 text-sm text-amber-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span className="font-medium">
                      QA нашла {(selectedSection.qaFindings as any[]).length} замечани{(selectedSection.qaFindings as any[]).length === 1 ? "е" : "й"} — текст был автоматически исправлен
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {(selectedSection.qaFindings as any[]).map((f: any, i: number) => (
                      <p key={i} className="text-xs text-amber-600 pl-6">
                        {i + 1}. [{f.severity}] {f.description}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Content area */}
              <div className="flex-1 overflow-y-auto">
                {selectedSection.status === "generating" || selectedSection.status === "qa_checking" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    <p className="text-sm text-gray-500">
                      {selectedSection.status === "generating"
                        ? "Генерация текста раздела..."
                        : "QA проверка на противоречия..."}
                    </p>
                  </div>
                ) : selectedSection.status === "pending" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <FileText className="h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-400">Ожидание генерации</p>
                  </div>
                ) : selectedSection.status === "skipped" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <SkipForward className="h-8 w-8 text-gray-300" />
                    <p className="text-sm text-gray-400">
                      Раздел пропущен — нет сопоставленной секции в протоколе
                    </p>
                  </div>
                ) : selectedSection.status === "failed" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <X className="h-8 w-8 text-red-400" />
                    <p className="text-sm text-red-500">Ошибка генерации</p>
                  </div>
                ) : isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full p-6 text-sm text-gray-800 leading-relaxed resize-none focus:outline-none"
                    spellCheck={false}
                  />
                ) : (
                  <div className="p-6">
                    <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
                      {selectedSection.content.split("\n").map((para, i) => (
                        para.trim() ? <p key={i}>{para}</p> : <br key={i} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">Выберите раздел в левой панели</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
