"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  Loader2,
  AlertCircle,
  HelpCircle,
  Send,
  CheckCircle2,
  ExternalLink,
  Filter,
  Columns2,
} from "lucide-react";
import { SourcePanel, type SourceSection } from "@/components/SourcePanel";

/* ═══════════════ Types ═══════════════ */

interface QueueItem {
  id: string;
  goldenSampleId: string;
  stage: string;
  sectionKey: string;
  proposedZone: string | null;
  isQuestion: boolean;
  questionText: string | null;
  status: string;
  annotatedAt: string | Date;
  annotator: { id: string; name: string; email: string };
  goldenSample: { id: string; name: string };
}

/* ═══════════════ Page ═══════════════ */

export default function ExpertReviewPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [finalZone, setFinalZone] = useState("");
  const [rationale, setRationale] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sampleFilter, setSampleFilter] = useState<string>("all");
  const [showSource, setShowSource] = useState(false);

  const queueQuery = trpc.annotation.expertQueue.useQuery({ limit: 100 });
  const taxonomyQuery = trpc.document.getTaxonomy.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
  });

  const utils = trpc.useUtils();
  const resolveMut = trpc.annotation.resolveQuestion.useMutation({
    onSuccess: () => {
      utils.annotation.expertQueue.invalidate();
      // Move to next item, deselect
      setSelectedId(null);
      setFinalZone("");
      setRationale("");
    },
  });

  const items: QueueItem[] = (queueQuery.data ?? []) as QueueItem[];

  const stages = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) s.add(it.stage);
    return Array.from(s).sort();
  }, [items]);

  // Уникальные protocol-samples из текущего queue, чтобы фильтр-dropdown
  // показывал только те sample'ы, по которым реально есть открытые вопросы.
  const samples = useMemo(() => {
    const m = new Map<string, string>(); // id → name
    for (const it of items) {
      if (!m.has(it.goldenSample.id)) m.set(it.goldenSample.id, it.goldenSample.name);
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((i) => {
      if (stageFilter !== "all" && i.stage !== stageFilter) return false;
      if (sampleFilter !== "all" && i.goldenSample.id !== sampleFilter) return false;
      return true;
    });
  }, [items, stageFilter, sampleFilter]);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  /* ───── Source preview data (for the «Исходник» toggle panel) ─────
   *
   * Загружаем версию документа активного sample только когда нужно (источник
   * включён + есть выбранный вопрос), чтобы не дёргать API без причины. */
  const sampleQuery = trpc.goldenDataset.getSample.useQuery(
    { id: selectedItem?.goldenSampleId ?? "" },
    { enabled: showSource && Boolean(selectedItem?.goldenSampleId) },
  );
  const sourceVersionId = sampleQuery.data?.documents?.[0]?.documentVersion?.id;
  const sourceVersionQuery = trpc.document.getVersion.useQuery(
    { versionId: sourceVersionId as string },
    { enabled: showSource && Boolean(sourceVersionId) },
  );

  const sourceSections: SourceSection[] = useMemo(
    () => (sourceVersionQuery.data?.sections ?? []) as SourceSection[],
    [sourceVersionQuery.data?.sections],
  );

  // sectionKey хранится в lower-cased trim'нутом виде (см. annotate page);
  // ищем секцию с тем же canonical title — это и есть focused для скролла.
  const sourceFocusedId = useMemo(() => {
    if (!selectedItem) return null;
    const target = selectedItem.sectionKey;
    const found = sourceSections.find(
      (s) => (s.title ?? "").trim().toLowerCase() === target,
    );
    return found?.id ?? null;
  }, [sourceSections, selectedItem]);

  const handleResolve = async () => {
    if (!selectedItem || !finalZone) return;
    try {
      await resolveMut.mutateAsync({
        annotationId: selectedItem.id,
        finalZone,
        rationale: rationale.trim() || undefined,
      });
    } catch (err) {
       
      alert(`Ошибка: ${(err as Error).message}`);
    }
  };

  if (queueQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (queueQuery.error) {
    return (
      <div className="flex h-screen items-center justify-center text-red-600">
        <AlertCircle className="mr-2" /> Ошибка загрузки очереди
      </div>
    );
  }

  const taxonomyOptions = (taxonomyQuery.data ?? []).map((r) => {
    const cfg = (r.config ?? {}) as { key?: string; titleRu?: string };
    return { key: cfg.key ?? r.pattern, titleRu: cfg.titleRu ?? "" };
  });

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Экспертная очередь</h1>
          <p className="text-xs text-gray-500">
            {items.length} вопросов от разметчиков · {stages.length > 0 && `Этапы: ${stages.join(", ")}`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setShowSource((v) => !v)}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
              showSource
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
            title="Показать/скрыть панель «Исходник» (содержимое разделов выбранного sample)"
          >
            <Columns2 size={12} /> Исходник
          </button>
          <Filter size={14} className="text-gray-400" />
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
          >
            <option value="all">Все этапы</option>
            {stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={sampleFilter}
            onChange={(e) => setSampleFilter(e.target.value)}
            className="max-w-[20rem] rounded border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
            title="Фильтр вопросов по протоколу (sample)"
          >
            <option value="all">Все протоколы</option>
            {samples.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Queue list */}
        <aside className="flex w-96 flex-col border-r border-gray-200 bg-white">
          <div className="flex-1 overflow-y-auto">
            {filteredItems.length === 0 && (
              <div className="p-10 text-center text-sm text-gray-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-green-500" />
                Все вопросы решены 🎉
              </div>
            )}
            {filteredItems.map((it) => {
              const isActive = it.id === selectedId;
              return (
                <button
                  key={it.id}
                  onClick={() => {
                    setSelectedId(it.id);
                    setFinalZone(it.proposedZone ?? "");
                    setRationale("");
                  }}
                  className={`flex w-full flex-col items-start gap-1 border-b border-gray-100 px-3 py-3 text-left text-xs hover:bg-gray-50 ${
                    isActive ? "bg-amber-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle size={12} className="text-amber-600" />
                    <span className="font-medium text-gray-900">{it.goldenSample.name}</span>
                  </div>
                  <div className="text-gray-700 line-clamp-2">{it.sectionKey}</div>
                  <div className="text-amber-700 line-clamp-2 italic">«{it.questionText}»</div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <span>{it.stage}</span>
                    <span>·</span>
                    <span>{it.annotator.name ?? it.annotator.email}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Decision panel */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          {!selectedItem ? (
            <div className="flex flex-1 items-center justify-center text-gray-400">
              {filteredItems.length === 0 ? "Очередь пуста" : "Выбери вопрос слева"}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-gray-500">
                      Sample · этап
                    </div>
                    <div className="font-medium text-gray-900">
                      {selectedItem.goldenSample.name}
                      <span className="ml-2 text-sm text-gray-500">{selectedItem.stage}</span>
                    </div>
                  </div>
                  <Link
                    href={`/golden-dataset/${selectedItem.goldenSampleId}`}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
                  >
                    Открыть sample <ExternalLink size={12} />
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Секция
                </div>
                <div className="mt-1 text-base text-gray-900">{selectedItem.sectionKey}</div>
              </div>

              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-amber-900">
                  <HelpCircle size={14} /> Вопрос разметчика
                </div>
                <div className="mt-1 text-amber-900 italic">«{selectedItem.questionText}»</div>
                <div className="mt-2 text-xs text-amber-800">
                  От: {selectedItem.annotator.name ?? selectedItem.annotator.email}
                </div>
                {selectedItem.proposedZone && (
                  <div className="mt-2 text-xs text-amber-800">
                    Предположение: <code className="rounded bg-white px-1">{selectedItem.proposedZone}</code>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Финальное решение
                </div>
                <select
                  value={finalZone}
                  onChange={(e) => setFinalZone(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">— выбери зону —</option>
                  {taxonomyOptions.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.key} {t.titleRu ? `— ${t.titleRu}` : ""}
                    </option>
                  ))}
                </select>

                <div className="mt-3 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Обоснование <span className="text-gray-400 font-normal normal-case">(опционально, поможет следующим разметчикам)</span>
                </div>
                <textarea
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  rows={3}
                  placeholder="Например: «Если препарат сравнения — comparator. Если описание IP — description.»"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleResolve}
                    disabled={!finalZone || resolveMut.isPending}
                    className="flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {resolveMut.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    Утвердить и перейти к следующему
                  </button>
                  <button
                    onClick={() => {
                      setSelectedId(null);
                      setFinalZone("");
                      setRationale("");
                    }}
                    className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right: source preview */}
        {showSource && (
          <SourcePanel
            sections={sourceSections}
            focusedSectionId={sourceFocusedId}
            loading={
              Boolean(selectedItem) &&
              (sampleQuery.isLoading || sourceVersionQuery.isLoading)
            }
          />
        )}
      </div>
    </div>
  );
}
