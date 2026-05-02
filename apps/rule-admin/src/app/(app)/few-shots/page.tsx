"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

/* ═══════════════ Types ═══════════════ */

interface FewShotForm {
  id?: string;
  title: string;
  parentPath: string;
  contentPreview: string;
  standardSection: string;
  reason: string;
  isActive: boolean;
}

const EMPTY_FORM: FewShotForm = {
  title: "",
  parentPath: "",
  contentPreview: "",
  standardSection: "",
  reason: "",
  isActive: true,
};

/* ═══════════════ Page ═══════════════ */

export default function FewShotsPage() {
  const [filterZone, setFilterZone] = useState<string>("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("active");
  const [editing, setEditing] = useState<FewShotForm | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const listQuery = trpc.fewShot.list.useQuery({
    standardSection: filterZone || undefined,
    isActive: filterActive === "all" ? undefined : filterActive === "active",
  });

  const taxonomyQuery = trpc.document.getTaxonomy.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const taxonomyOptions = useMemo(() => {
    if (!taxonomyQuery.data) return [] as Array<{ value: string; label: string; type: string }>;
    return taxonomyQuery.data.map((r: Record<string, unknown>) => ({
      value: r.pattern as string,
      label: `${(r.config as Record<string, unknown>).titleRu} (${r.pattern})`,
      type: (r.config as Record<string, unknown>).type as string,
    }));
  }, [taxonomyQuery.data]);

  const createMutation = trpc.fewShot.create.useMutation({
    onSuccess: () => {
      utils.fewShot.list.invalidate();
      setEditing(null);
    },
  });

  const updateMutation = trpc.fewShot.update.useMutation({
    onSuccess: () => {
      utils.fewShot.list.invalidate();
      setEditing(null);
    },
  });

  const deleteMutation = trpc.fewShot.delete.useMutation({
    onSuccess: () => {
      utils.fewShot.list.invalidate();
      setDeletingId(null);
    },
  });

  const items = listQuery.data?.items ?? [];

  const handleSave = () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.standardSection.trim()) return;
    if (editing.id) {
      updateMutation.mutate({
        id: editing.id,
        patch: {
          title: editing.title,
          parentPath: editing.parentPath || null,
          contentPreview: editing.contentPreview || null,
          standardSection: editing.standardSection,
          reason: editing.reason || null,
          isActive: editing.isActive,
        },
      });
    } else {
      createMutation.mutate({
        title: editing.title,
        parentPath: editing.parentPath || null,
        contentPreview: editing.contentPreview || null,
        standardSection: editing.standardSection,
        reason: editing.reason || null,
      });
    }
  };

  const toggleActive = (id: string, currentActive: boolean) => {
    updateMutation.mutate({ id, patch: { isActive: !currentActive } });
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-brand-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Эталонные примеры классификации</h1>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY_FORM })}
          className="flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={14} /> Добавить
        </button>
      </div>

      <p className="text-sm text-gray-600">
        Утверждённые экспертом примеры классификации. Используются как few-shot в LLM Check —
        top-K похожих подмешиваются в систем-промпт. Помогают обучить классификатор на новых
        зонах без дообучения модели.
      </p>

      {/* Filters */}
      <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
        <span className="font-medium text-gray-700">Фильтры:</span>
        <select
          value={filterZone}
          onChange={(e) => setFilterZone(e.target.value)}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        >
          <option value="">Все зоны</option>
          {taxonomyOptions
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label, "ru"))
            .map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
        </select>
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as "all" | "active" | "inactive")}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
        >
          <option value="active">Только активные</option>
          <option value="inactive">Только отключённые</option>
          <option value="all">Все</option>
        </select>
        <span className="ml-auto text-xs text-gray-500">Всего: {items.length}</span>
      </div>

      {/* List */}
      {listQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 py-8 text-center text-sm text-gray-500">
          Примеров нет. Добавь первый — нажми «Добавить» сверху.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rounded-md border px-3 py-2 ${
                item.isActive ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {item.parentPath && (
                    <div className="text-[10px] text-gray-400 truncate" title={item.parentPath}>
                      {item.parentPath}
                    </div>
                  )}
                  <div className="text-sm font-medium text-gray-900">{item.title}</div>
                  <div className="mt-0.5 text-xs text-brand-700 font-mono">
                    → {item.standardSection}
                  </div>
                  {item.reason && (
                    <div className="mt-1 text-xs italic text-gray-600">{item.reason}</div>
                  )}
                  {item.contentPreview && (
                    <div className="mt-1 text-[11px] text-gray-500 line-clamp-2">
                      {item.contentPreview}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleActive(item.id, item.isActive)}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                    title={item.isActive ? "Отключить (не подмешивать в LLM)" : "Активировать"}
                    disabled={updateMutation.isPending}
                  >
                    {item.isActive ? <ToggleRight size={16} className="text-green-600" /> : <ToggleLeft size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: item.id,
                        title: item.title,
                        parentPath: item.parentPath ?? "",
                        contentPreview: item.contentPreview ?? "",
                        standardSection: item.standardSection,
                        reason: item.reason ?? "",
                        isActive: item.isActive,
                      })
                    }
                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                    title="Редактировать"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingId(item.id)}
                    className="rounded p-1 text-red-500 hover:bg-red-50"
                    title="Удалить"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-base font-semibold text-gray-900">
                {editing.id ? "Редактировать пример" : "Новый пример"}
              </h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Заголовок секции <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editing.title}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="Препарат сравнения"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Иерархический путь (необязательно)
                </label>
                <input
                  type="text"
                  value={editing.parentPath}
                  onChange={(e) => setEditing({ ...editing, parentPath: e.target.value })}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="5. Изучаемый препарат / 5.2. Описание"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Зона (taxonomy key) <span className="text-red-500">*</span>
                </label>
                <select
                  value={editing.standardSection}
                  onChange={(e) => setEditing({ ...editing, standardSection: e.target.value })}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">— выбрать —</option>
                  {taxonomyOptions
                    .filter((o) => o.type === "zone")
                    .slice()
                    .sort((a, b) => a.label.localeCompare(b.label, "ru"))
                    .map((zone) => {
                      const subzones = taxonomyOptions
                        .filter((s) => s.type === "subzone" && s.value.startsWith(zone.value + "."))
                        .slice()
                        .sort((a, b) => a.label.localeCompare(b.label, "ru"));
                      return (
                        <optgroup key={zone.value} label={zone.label}>
                          <option value={zone.value}>{zone.label}</option>
                          {subzones.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Причина (зачем именно эта зона — будет показано LLM)
                </label>
                <textarea
                  value={editing.reason}
                  onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                  rows={2}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  placeholder="Comparator — лекарство сравнения, отдельная subzone от parent ip"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Превью содержимого (необязательно, ≤500 chars)
                </label>
                <textarea
                  value={editing.contentPreview}
                  onChange={(e) => setEditing({ ...editing, contentPreview: e.target.value.slice(0, 500) })}
                  rows={3}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                />
              </div>
              {editing.id && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={editing.isActive}
                    onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  />
                  Активен (подмешивается в LLM Check)
                </label>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending || !editing.title.trim() || !editing.standardSection.trim()}
                className="rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}
                {editing.id ? "Сохранить" : "Создать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-200 px-4 py-3">
              <h3 className="text-base font-semibold text-gray-900">Удалить пример?</h3>
            </div>
            <div className="px-4 py-3 text-sm text-gray-700">
              Действие необратимо. Если хочешь временно отключить — используй кнопку «активен».
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                onClick={() => setDeletingId(null)}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                onClick={() => deleteMutation.mutate({ id: deletingId })}
                disabled={deleteMutation.isPending}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending && <Loader2 size={14} className="animate-spin inline mr-1" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
