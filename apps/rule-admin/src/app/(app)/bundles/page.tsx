"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  Package,
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  section_classification: "Классификация секций",
  section_classification_qa: "Классификация QA",
  fact_extraction: "Извлечение фактов",
  fact_extraction_qa: "Извлечение QA",
  soa_detection: "SOA детекция",
  soa_detection_qa: "SOA QA",
  intra_audit: "Внутренний аудит",
  intra_audit_qa: "Внутренний аудит QA",
  inter_audit: "Межд. аудит",
  inter_audit_qa: "Межд. аудит QA",
  fact_audit_intra: "Факт-аудит внутр.",
  fact_audit_inter: "Факт-аудит межд.",
  generation: "Генерация",
  generation_qa: "Генерация QA",
  impact_analysis: "Анализ влияния",
  change_classification: "Классификация изменений",
  correction_recommend: "Рекомендации по корректировкам",
  soa_identification: "SOA идентификация",
  audit: "Аудит",
};

export default function BundlesPage() {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [expandedBundle, setExpandedBundle] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloningId, setCloningId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const bundlesQuery = trpc.bundle.list.useQuery({});
  const ruleSetsQuery = trpc.ruleManagement.listRuleSets.useQuery({});

  const createMut = trpc.bundle.create.useMutation({
    onSuccess: () => {
      utils.bundle.list.invalidate();
      setCreating(false);
      setNewName("");
      setNewDesc("");
    },
  });
  const deleteMut = trpc.bundle.delete.useMutation({
    onSuccess: () => utils.bundle.list.invalidate(),
  });
  const activateMut = trpc.bundle.activate.useMutation({
    onSuccess: () => utils.bundle.list.invalidate(),
  });
  const deactivateMut = trpc.bundle.deactivate.useMutation({
    onSuccess: () => utils.bundle.list.invalidate(),
  });
  const addEntryMut = trpc.bundle.addEntry.useMutation({
    onSuccess: () => {
      utils.bundle.list.invalidate();
      setAddingTo(null);
      setSelectedRuleSetId("");
    },
  });
  const removeEntryMut = trpc.bundle.removeEntry.useMutation({
    onSuccess: () => utils.bundle.list.invalidate(),
  });
  const cloneMut = trpc.bundle.clone.useMutation({
    onSuccess: () => {
      utils.bundle.list.invalidate();
      setCloningId(null);
      setCloneName("");
    },
  });

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createMut.mutate({ name: newName.trim(), description: newDesc.trim() || undefined });
  }, [newName, newDesc, createMut]);

  const bundles = bundlesQuery.data ?? [];
  const ruleSets = ruleSetsQuery.data ?? [];

  const ruleSetVersionOptions = ruleSets.flatMap((rs: any) =>
    (rs.versions ?? []).map((v: any) => ({
      versionId: v.id,
      label: `${rs.name} (v${v.version}, ${v._count?.rules ?? 0} rules)`,
      type: rs.type,
    })),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Бандлы конфигурации</h1>
          <p className="mt-1 text-sm text-gray-500">
            Группируйте версии правил в бандлы для привязки к обработке документов
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={16} />
          Создать бандл
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-900">Новый бандл</h3>
          <div className="space-y-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название бандла"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Описание (необязательно)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={createMut.isPending || !newName.trim()}
                className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {createMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Создать
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(""); setNewDesc(""); }}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <X size={14} />
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {bundlesQuery.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      <div className="space-y-3">
        {bundles.map((bundle: any) => {
          const isExpanded = expandedBundle === bundle.id;
          return (
            <div key={bundle.id} className="rounded-lg border border-gray-200 bg-white">
              {/* Header */}
              <div
                className="flex cursor-pointer items-center gap-3 px-4 py-3"
                onClick={() => setExpandedBundle(isExpanded ? null : bundle.id)}
              >
                {isExpanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <Package size={18} className="text-brand-600" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{bundle.name}</span>
                    {bundle.isActive && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Активный
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {bundle.entries?.length ?? 0} версий
                    </span>
                    {bundle._count?.processingRuns > 0 && (
                      <span className="text-xs text-gray-400">
                        {bundle._count.processingRuns} прогонов
                      </span>
                    )}
                  </div>
                  {bundle.description && (
                    <p className="text-xs text-gray-500">{bundle.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {bundle.isActive ? (
                    <button
                      onClick={() => deactivateMut.mutate({ bundleId: bundle.id })}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-orange-600"
                      title="Деактивировать"
                    >
                      <PowerOff size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={() => activateMut.mutate({ bundleId: bundle.id })}
                      className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-green-600"
                      title="Активировать"
                    >
                      <Power size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => { setCloningId(bundle.id); setCloneName(`${bundle.name} (копия)`); }}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-brand-600"
                    title="Клонировать"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Удалить бандл?")) deleteMut.mutate({ bundleId: bundle.id });
                    }}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    title="Удалить"
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Clone dialog */}
              {cloningId === bundle.id && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={cloneName}
                      onChange={(e) => setCloneName(e.target.value)}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      placeholder="Имя копии"
                    />
                    <button
                      onClick={() => cloneMut.mutate({ bundleId: bundle.id, newName: cloneName })}
                      disabled={cloneMut.isPending || !cloneName.trim()}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {cloneMut.isPending ? <Loader2 size={14} className="animate-spin" /> : "Клонировать"}
                    </button>
                    <button
                      onClick={() => setCloningId(null)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Expanded entries */}
              {isExpanded && (
                <div className="border-t border-gray-100">
                  {(bundle.entries ?? []).length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-gray-400">
                      Нет версий в бандле. Добавьте версии RuleSet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                          <th className="px-4 py-2 font-medium">Тип</th>
                          <th className="px-4 py-2 font-medium">RuleSet</th>
                          <th className="px-4 py-2 font-medium">Версия</th>
                          <th className="px-4 py-2 font-medium">Правил</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {bundle.entries.map((entry: any) => {
                          const rs = entry.ruleSetVersion?.ruleSet;
                          const v = entry.ruleSetVersion;
                          return (
                            <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-4 py-2">
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                  {TYPE_LABELS[rs?.type] ?? rs?.type}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-gray-900">{rs?.name}</td>
                              <td className="px-4 py-2 text-gray-600">v{v?.version}</td>
                              <td className="px-4 py-2 text-gray-600">{v?._count?.rules ?? "—"}</td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => removeEntryMut.mutate({ bundleId: bundle.id, entryId: entry.id })}
                                  className="rounded p-1 text-gray-400 hover:text-red-600"
                                  title="Удалить из бандла"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Add entry */}
                  <div className="border-t border-gray-100 px-4 py-3">
                    {addingTo === bundle.id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedRuleSetId}
                          onChange={(e) => setSelectedRuleSetId(e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                        >
                          <option value="">Выберите версию RuleSet...</option>
                          {ruleSetVersionOptions.map((opt: any) => (
                            <option key={opt.versionId} value={opt.versionId}>
                              [{TYPE_LABELS[opt.type] ?? opt.type}] {opt.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            if (selectedRuleSetId) {
                              addEntryMut.mutate({ bundleId: bundle.id, ruleSetVersionId: selectedRuleSetId });
                            }
                          }}
                          disabled={!selectedRuleSetId || addEntryMut.isPending}
                          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {addEntryMut.isPending ? <Loader2 size={14} className="animate-spin" /> : "Добавить"}
                        </button>
                        <button
                          onClick={() => { setAddingTo(null); setSelectedRuleSetId(""); }}
                          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                        >
                          Отмена
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingTo(bundle.id)}
                        className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
                      >
                        <Plus size={14} />
                        Добавить версию RuleSet
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!bundlesQuery.isLoading && bundles.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-200 py-12 text-center">
          <Package className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">Нет бандлов</p>
          <p className="text-xs text-gray-400">Создайте первый бандл для управления конфигурацией пайплайна</p>
        </div>
      )}
    </div>
  );
}
