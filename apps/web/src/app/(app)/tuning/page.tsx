"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import Link from "next/link";
import {
  SlidersHorizontal,
  Plus,
  FileCheck,
  FileText,
  Table2,
  Award,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  section_classification: "Секции",
  fact_extraction: "Факты",
  soa_detection: "SOA",
  icf_generation: "Генерация ICF",
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  section_classification: FileCheck,
  fact_extraction: FileText,
  soa_detection: Table2,
  icf_generation: Sparkles,
};

const STATUS_LABELS: Record<string, string> = {
  processing: "Обработка",
  pending_review: "Ожидает ревью",
  in_review: "На ревью",
  completed: "Завершена",
};

const STATUS_COLORS: Record<string, string> = {
  processing: "bg-blue-100 text-blue-700",
  pending_review: "bg-yellow-100 text-yellow-700",
  in_review: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
};

export default function TuningDashboard() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedType, setSelectedType] = useState<string>("section_classification");
  const [selectedVersionId, setSelectedVersionId] = useState<string>("");
  const [selectedGenDocId, setSelectedGenDocId] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const sessionsQuery = trpc.tuning.listSessions.useQuery({
    type: filterType || undefined,
    status: filterStatus || undefined,
  } as any);

  const versionsQuery = trpc.tuning.getVersionsForTuning.useQuery();
  const genDocsQuery = trpc.tuning.getGeneratedDocsForTuning.useQuery(
    { protocolVersionId: selectedVersionId },
    { enabled: selectedType === "icf_generation" && !!selectedVersionId }
  );
  const createMutation = trpc.tuning.createSession.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setSelectedVersionId("");
      setSelectedGenDocId("");
      sessionsQuery.refetch();
    },
  });

  const toggleGoldenMutation = trpc.tuning.toggleGoldenSet.useMutation({
    onSuccess: () => sessionsQuery.refetch(),
  });

  const sessions = sessionsQuery.data ?? [];

  function getSessionUrl(session: any) {
    const typeMap: Record<string, string> = {
      section_classification: "sections",
      fact_extraction: "facts",
      soa_detection: "soa",
      icf_generation: "generation",
    };
    return `/tuning/${typeMap[session.type]}/${session.id}`;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="h-7 w-7 text-brand-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Тюнинг качества</h1>
            <p className="text-sm text-gray-500">
              Верификация и улучшение алгоритмов распознавания
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Новая сессия
        </button>
      </div>

      {/* Фильтры */}
      <div className="mb-6 flex items-center gap-4">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Все типы</option>
          <option value="section_classification">Секции</option>
          <option value="fact_extraction">Факты</option>
          <option value="soa_detection">SOA</option>
          <option value="icf_generation">Генерация ICF</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="pending_review">Ожидает ревью</option>
          <option value="in_review">На ревью</option>
          <option value="completed">Завершена</option>
        </select>
        <Link
          href="/tuning/golden-sets"
          className="ml-auto flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-100 transition-colors"
        >
          <Award className="h-4 w-4" />
          Золотые наборы
        </Link>
      </div>

      {/* Список сессий */}
      {sessionsQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 py-16 text-center">
          <SlidersHorizontal className="mx-auto mb-3 h-10 w-10 text-gray-300" />
          <p className="text-gray-500">Нет сессий тюнинга</p>
          <p className="mt-1 text-sm text-gray-400">
            Создайте первую сессию для начала верификации
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session: any) => {
            const Icon = TYPE_ICONS[session.type] ?? FileText;
            return (
              <Link
                key={session.id}
                href={getSessionUrl(session)}
                className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 hover:border-brand-300 hover:shadow-sm transition-all"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                  <Icon className="h-5 w-5 text-gray-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">
                      {session.docVersion?.document?.title ?? "—"}
                    </span>
                    <span className="text-xs text-gray-400">
                      {session.docVersion?.versionLabel ??
                        `v${session.docVersion?.versionNumber}`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-gray-500">
                    <span>{TYPE_LABELS[session.type]}</span>
                    <span>
                      {new Date(session.createdAt).toLocaleDateString("ru-RU")}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_COLORS[session.status] ?? "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {STATUS_LABELS[session.status] ?? session.status}
                  </span>
                  {session.status === "completed" && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleGoldenMutation.mutate({ sessionId: session.id });
                      }}
                      className={`rounded p-1 transition-colors ${
                        session.isGoldenSet
                          ? "text-yellow-500 hover:text-yellow-600"
                          : "text-gray-300 hover:text-yellow-400"
                      }`}
                      title={
                        session.isGoldenSet
                          ? "Убрать из золотого набора"
                          : "Добавить в золотой набор"
                      }
                    >
                      <Award className="h-4 w-4" />
                    </button>
                  )}
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Модал создания */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Новая сессия тюнинга
            </h2>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Тип проверки
              </label>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value);
                  setSelectedGenDocId("");
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="section_classification">Классификация секций</option>
                <option value="fact_extraction">Извлечение фактов</option>
                <option value="soa_detection">Определение SOA</option>
                <option value="icf_generation">Качество генерации ICF</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {selectedType === "icf_generation"
                  ? "Версия протокола (источник генерации)"
                  : "Версия документа"}
              </label>
              {versionsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка...
                </div>
              ) : (
                <select
                  value={selectedVersionId}
                  onChange={(e) => {
                    setSelectedVersionId(e.target.value);
                    setSelectedGenDocId("");
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Выберите документ</option>
                  {(versionsQuery.data ?? [])
                    .filter((v: any) =>
                      selectedType === "icf_generation"
                        ? v.documentType === "protocol"
                        : true
                    )
                    .map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.documentTitle} — {v.versionLabel ?? `v${v.versionNumber}`} ({v.documentType})
                      </option>
                    ))}
                </select>
              )}
            </div>

            {selectedType === "icf_generation" && selectedVersionId && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Сгенерированный документ
                </label>
                {genDocsQuery.isLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка...
                  </div>
                ) : (genDocsQuery.data ?? []).length === 0 ? (
                  <p className="py-2 text-sm text-gray-400">
                    Нет завершённых генераций для этого протокола
                  </p>
                ) : (
                  <select
                    value={selectedGenDocId}
                    onChange={(e) => setSelectedGenDocId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Выберите документ</option>
                    {(genDocsQuery.data ?? []).map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.docType.toUpperCase()} — {d.totalSections} секций —{" "}
                        {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  if (selectedVersionId) {
                    createMutation.mutate({
                      docVersionId: selectedVersionId,
                      type: selectedType as any,
                      generatedDocId:
                        selectedType === "icf_generation" ? selectedGenDocId || undefined : undefined,
                    });
                  }
                }}
                disabled={
                  !selectedVersionId ||
                  (selectedType === "icf_generation" && !selectedGenDocId) ||
                  createMutation.isPending
                }
                className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {createMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Создать
              </button>
            </div>

            {createMutation.error && (
              <p className="mt-3 text-sm text-red-600">
                {createMutation.error.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
