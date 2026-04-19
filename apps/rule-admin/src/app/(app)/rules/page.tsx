"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  GitCompare,
  Trash2,
  Save,
  Loader2,
  ToggleLeft,
  ToggleRight,
  X,
  History,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const RULE_SET_TYPE_GROUPS: Record<string, string[]> = {
  "Классификация": ["section_classification", "section_classification_qa"],
  "Извлечение": ["fact_extraction", "fact_extraction_qa"],
  SOA: ["soa_detection", "soa_detection_qa", "soa_identification"],
  "Внутренний аудит": ["intra_audit", "intra_audit_qa", "fact_audit_intra", "fact_audit_intra_qa"],
  "Межд. аудит": ["inter_audit", "inter_audit_qa", "fact_audit_inter", "fact_audit_inter_qa", "audit"],
  "Генерация": ["generation", "generation_qa"],
  "Влияние": ["impact_analysis", "impact_analysis_qa", "change_classification", "change_classification_qa"],
  "Прочее": ["correction_recommend"],
};

const DOC_TYPE_COLORS: Record<string, string> = {
  protocol: "bg-blue-100 text-blue-700",
  icf: "bg-green-100 text-green-700",
  ib: "bg-purple-100 text-purple-700",
  csr: "bg-amber-100 text-amber-700",
};

/* ═══════════════ Types ═══════════════ */

interface RuleEditorState {
  name: string;
  pattern: string;
  config: string;
  promptTemplate: string;
  documentType: string;
  stage: string;
  isEnabled: boolean;
  requiresFacts: boolean;
  requiresSoa: boolean;
}

/* ═══════════════ Component ═══════════════ */

export default function RulesPage() {
  const searchParams = useSearchParams();
  const initialGroup = searchParams.get("group");

  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(Object.keys(RULE_SET_TYPE_GROUPS)));
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [editState, setEditState] = useState<RuleEditorState | null>(null);
  const [showCreateRuleSet, setShowCreateRuleSet] = useState(false);
  const [newRuleSetName, setNewRuleSetName] = useState("");
  const [newRuleSetType, setNewRuleSetType] = useState("section_classification");
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [diffVersionId1, setDiffVersionId1] = useState<string | null>(null);
  const [diffVersionId2, setDiffVersionId2] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  const [didAutoSelect, setDidAutoSelect] = useState(false);
  const utils = trpc.useUtils();

  const ruleSetsQuery = trpc.ruleManagement.listRuleSets.useQuery({});

  const activeVersionQuery = trpc.ruleManagement.getActiveVersion.useQuery(
    { ruleSetId: selectedRuleSetId! },
    { enabled: !!selectedRuleSetId },
  );

  const versionHistoryQuery = trpc.ruleManagement.getVersionHistory.useQuery(
    { ruleSetId: selectedRuleSetId! },
    { enabled: !!selectedRuleSetId && showVersionHistory },
  );

  const diffQuery = trpc.ruleManagement.diffVersions.useQuery(
    { versionId1: diffVersionId1!, versionId2: diffVersionId2! },
    { enabled: !!diffVersionId1 && !!diffVersionId2 && showDiff },
  );

  const createRuleSetMut = trpc.ruleManagement.createRuleSet.useMutation({
    onSuccess: () => {
      utils.ruleManagement.listRuleSets.invalidate();
      setShowCreateRuleSet(false);
      setNewRuleSetName("");
    },
  });

  const createVersionMut = trpc.ruleManagement.createVersion.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
      utils.ruleManagement.getVersionHistory.invalidate();
    },
  });

  const activateVersionMut = trpc.ruleManagement.activateVersion.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
      utils.ruleManagement.getVersionHistory.invalidate();
    },
  });

  const rollbackMut = trpc.ruleManagement.rollbackVersion.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
      utils.ruleManagement.getVersionHistory.invalidate();
    },
  });

  const updateRuleMut = trpc.ruleManagement.updateRule.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
      setExpandedRuleId(null);
      setEditState(null);
    },
  });

  const deleteRuleMut = trpc.ruleManagement.deleteRule.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
    },
  });

  useEffect(() => {
    if (!initialGroup || didAutoSelect || !ruleSetsQuery.data) return;
    const types = RULE_SET_TYPE_GROUPS[initialGroup];
    if (!types) return;
    const first = ruleSetsQuery.data.find((rs: any) => types.includes(rs.type));
    if (first) {
      setSelectedRuleSetId((first as any).id);
      setExpandedGroups(new Set([initialGroup]));
    }
    setDidAutoSelect(true);
  }, [initialGroup, didAutoSelect, ruleSetsQuery.data]);

  /* ═══════════════ Helpers ═══════════════ */

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const startEditRule = useCallback((rule: any) => {
    setExpandedRuleId(rule.id);
    setEditState({
      name: rule.name,
      pattern: rule.pattern,
      config: JSON.stringify(rule.config ?? {}, null, 2),
      promptTemplate: rule.promptTemplate ?? "",
      documentType: rule.documentType ?? "",
      stage: rule.stage ?? "",
      isEnabled: rule.isEnabled,
      requiresFacts: rule.requiresFacts,
      requiresSoa: rule.requiresSoa,
    });
  }, []);

  const saveRule = useCallback(() => {
    if (!expandedRuleId || !editState) return;
    let parsedConfig: Record<string, unknown> = {};
    try {
      parsedConfig = JSON.parse(editState.config);
    } catch {
      /* keep empty */
    }
    updateRuleMut.mutate({
      ruleId: expandedRuleId,
      data: {
        name: editState.name,
        pattern: editState.pattern,
        config: parsedConfig,
        promptTemplate: editState.promptTemplate || undefined,
        documentType: (editState.documentType as any) || undefined,
        stage: editState.stage || undefined,
        isEnabled: editState.isEnabled,
        requiresFacts: editState.requiresFacts,
        requiresSoa: editState.requiresSoa,
      },
    });
  }, [expandedRuleId, editState, updateRuleMut]);

  const handleCreateNewVersion = useCallback(() => {
    if (!selectedRuleSetId || !activeVersionQuery.data) return;
    const rules = activeVersionQuery.data.rules.map((r: any) => ({
      name: r.name,
      pattern: r.pattern,
      config: r.config ?? {},
      documentType: r.documentType ?? undefined,
      stage: r.stage ?? undefined,
      subStage: r.subStage ?? undefined,
      promptTemplate: r.promptTemplate ?? undefined,
      isEnabled: r.isEnabled,
      requiresFacts: r.requiresFacts,
      requiresSoa: r.requiresSoa,
      order: r.order,
    }));
    createVersionMut.mutate({ ruleSetId: selectedRuleSetId, rules });
  }, [selectedRuleSetId, activeVersionQuery.data, createVersionMut]);

  /* ═══════════════ Grouping ═══════════════ */

  const grouped = new Map<string, typeof ruleSetsQuery.data>();
  if (ruleSetsQuery.data) {
    for (const [group, types] of Object.entries(RULE_SET_TYPE_GROUPS)) {
      const items = ruleSetsQuery.data.filter((rs: any) => types.includes(rs.type));
      if (items.length > 0) grouped.set(group, items);
    }
    const allGroupedTypes = Object.values(RULE_SET_TYPE_GROUPS).flat();
    const ungrouped = ruleSetsQuery.data.filter((rs: any) => !allGroupedTypes.includes(rs.type));
    if (ungrouped.length > 0) {
      const existing = grouped.get("Прочее") ?? [];
      grouped.set("Прочее", [...existing, ...ungrouped]);
    }
  }

  /* ═══════════════ Render ═══════════════ */

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Правила и промпты</h1>
          <p className="mt-1 text-sm text-gray-500">Управление правилами классификации и шаблонами промптов LLM.</p>
        </div>
        <button
          onClick={() => setShowCreateRuleSet(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus size={16} /> Создать набор правил
        </button>
      </div>

      {/* Create RuleSet Modal */}
      {showCreateRuleSet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Создать набор правил</h2>
              <button onClick={() => setShowCreateRuleSet(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Название</label>
                <input
                  type="text"
                  value={newRuleSetName}
                  onChange={(e) => setNewRuleSetName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  placeholder="напр. Классификация секций протокола"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Тип</label>
                <select
                  value={newRuleSetType}
                  onChange={(e) => setNewRuleSetType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {Object.values(RULE_SET_TYPE_GROUPS).flat().map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowCreateRuleSet(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={() => createRuleSetMut.mutate({ name: newRuleSetName, type: newRuleSetType as any })}
                  disabled={!newRuleSetName || createRuleSetMut.isPending}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {createRuleSetMut.isPending && <Loader2 size={14} className="animate-spin" />}
                  Создать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-6">
        {/* Left Panel: RuleSet List */}
        <div className="w-80 shrink-0">
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            {ruleSetsQuery.isLoading && (
              <div className="flex items-center justify-center p-8">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            )}
            {ruleSetsQuery.isError && (
              <div className="p-4 text-sm text-red-600">Не удалось загрузить наборы правил.</div>
            )}
            {ruleSetsQuery.data && Array.from(grouped.entries()).map(([group, items]) => (
              <div key={group} className="border-b border-gray-100 last:border-b-0">
                <button
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50"
                >
                  {expandedGroups.has(group) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {group}
                  <span className="ml-auto text-gray-400">{(items as any[]).length}</span>
                </button>
                {expandedGroups.has(group) && (items as any[]).map((rs: any) => (
                  <button
                    key={rs.id}
                    onClick={() => {
                      setSelectedRuleSetId(rs.id);
                      setExpandedRuleId(null);
                      setEditState(null);
                      setShowVersionHistory(false);
                      setShowDiff(false);
                    }}
                    className={`flex w-full items-center gap-3 px-6 py-2 text-left text-sm transition-colors ${
                      selectedRuleSetId === rs.id
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <BookOpen size={14} className="shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{rs.name}</div>
                      <div className="truncate text-xs text-gray-400">
                        {rs.type} {rs.versions?.[0] ? `- ${rs.versions[0]._count.rules} правил` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel: Active Version Details */}
        <div className="min-w-0 flex-1">
          {!selectedRuleSetId && (
            <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white">
              <p className="text-sm text-gray-400">Выберите набор правил в левой панели.</p>
            </div>
          )}

          {selectedRuleSetId && activeVersionQuery.isLoading && (
            <div className="flex h-64 items-center justify-center rounded-lg border border-gray-200 bg-white">
              <Loader2 size={24} className="animate-spin text-gray-400" />
            </div>
          )}

          {selectedRuleSetId && activeVersionQuery.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Не удалось загрузить активную версию. Возможно, у этого набора правил ещё нет активной версии.
            </div>
          )}

          {selectedRuleSetId && activeVersionQuery.data && (
            <div className="space-y-4">
              {/* Version Controls */}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <span className="text-sm font-medium text-gray-700">
                  Версия {activeVersionQuery.data.version}
                </span>
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Активная</span>
                <span className="text-xs text-gray-400">
                  {activeVersionQuery.data.rules.length} правил
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={handleCreateNewVersion}
                    disabled={createVersionMut.isPending}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {createVersionMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                    Новая версия
                  </button>
                  <button
                    onClick={() => setShowVersionHistory((p) => !p)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      showVersionHistory ? "border-brand-300 bg-brand-50 text-brand-700" : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <History size={12} /> История
                  </button>
                  <button
                    onClick={() => rollbackMut.mutate({ ruleSetId: selectedRuleSetId! })}
                    disabled={rollbackMut.isPending}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {rollbackMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Откатить
                  </button>
                </div>
              </div>

              {/* Version History */}
              {showVersionHistory && versionHistoryQuery.data && (
                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">История версий</h3>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {versionHistoryQuery.data.map((v: any) => (
                      <div key={v.id} className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-gray-50">
                        <span className="font-medium text-gray-700">v{v.version}</span>
                        {v.isActive && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">Активная</span>}
                        <span className="text-xs text-gray-400">{v._count.rules} правил</span>
                        <span className="text-xs text-gray-400">{new Date(v.createdAt).toLocaleDateString()}</span>
                        <div className="ml-auto flex gap-1">
                          {!v.isActive && (
                            <button
                              onClick={() => activateVersionMut.mutate({ versionId: v.id })}
                              className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
                            >
                              Активировать
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (!diffVersionId1) {
                                setDiffVersionId1(v.id);
                              } else if (!diffVersionId2) {
                                setDiffVersionId2(v.id);
                                setShowDiff(true);
                              } else {
                                setDiffVersionId1(v.id);
                                setDiffVersionId2(null);
                                setShowDiff(false);
                              }
                            }}
                            className={`rounded px-2 py-1 text-xs ${
                              diffVersionId1 === v.id || diffVersionId2 === v.id
                                ? "bg-amber-50 text-amber-700"
                                : "text-gray-500 hover:bg-gray-100"
                            }`}
                          >
                            <GitCompare size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {diffVersionId1 && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <span>Сравнение: {diffVersionId1.slice(0, 8)}...</span>
                      {diffVersionId2 ? <span>и {diffVersionId2.slice(0, 8)}...</span> : <span>Выберите вторую версию</span>}
                      <button onClick={() => { setDiffVersionId1(null); setDiffVersionId2(null); setShowDiff(false); }} className="text-red-500 hover:text-red-700">
                        <X size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Diff Results */}
              {showDiff && diffQuery.data && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    Сравнение: v{diffQuery.data.version1.version} и v{diffQuery.data.version2.version}
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center text-sm">
                    <div className="rounded bg-green-100 p-2 text-green-700">
                      +{diffQuery.data.summary.addedCount} добавлено
                    </div>
                    <div className="rounded bg-red-100 p-2 text-red-700">
                      -{diffQuery.data.summary.removedCount} удалено
                    </div>
                    <div className="rounded bg-blue-100 p-2 text-blue-700">
                      ~{diffQuery.data.summary.modifiedCount} изменено
                    </div>
                  </div>
                  {diffQuery.data.modified.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-gray-600">Изменённые правила:</p>
                      {diffQuery.data.modified.map((m: any) => (
                        <div key={m.name} className="rounded border border-gray-200 bg-white p-2 text-xs">
                          <span className="font-medium">{m.name}</span>
                          {m.before.pattern !== m.after.pattern && (
                            <div className="mt-1 text-gray-500">Шаблон изменён</div>
                          )}
                          {m.before.promptTemplate !== m.after.promptTemplate && (
                            <div className="mt-1 text-gray-500">Шаблон промпта изменён</div>
                          )}
                          {m.before.isEnabled !== m.after.isEnabled && (
                            <div className="mt-1 text-gray-500">
                              Включено: {String(m.before.isEnabled)} &rarr; {String(m.after.isEnabled)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Rules List */}
              <div className="space-y-2">
                {activeVersionQuery.data.rules.map((rule: any) => (
                  <div
                    key={rule.id}
                    className="rounded-lg border border-gray-200 bg-white shadow-sm"
                  >
                    {/* Rule Summary Row */}
                    <div
                      className="flex cursor-pointer items-center gap-3 px-4 py-3"
                      onClick={() => {
                        if (expandedRuleId === rule.id) {
                          setExpandedRuleId(null);
                          setEditState(null);
                        } else {
                          startEditRule(rule);
                        }
                      }}
                    >
                      {expandedRuleId === rule.id ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                      <span className="text-sm font-medium text-gray-900">{rule.name}</span>
                      <span className="max-w-[200px] truncate text-xs text-gray-400 font-mono">
                        {rule.pattern}
                      </span>
                      {rule.promptTemplate && (
                        <span className="max-w-[150px] truncate text-xs text-gray-400">
                          {rule.promptTemplate.slice(0, 40)}...
                        </span>
                      )}
                      {rule.documentType && (
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${DOC_TYPE_COLORS[rule.documentType] ?? "bg-gray-100 text-gray-600"}`}>
                          {rule.documentType}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateRuleMut.mutate({ ruleId: rule.id, data: { isEnabled: !rule.isEnabled } });
                          }}
                          title={rule.isEnabled ? "Выключить" : "Включить"}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          {rule.isEnabled ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} className="text-gray-300" />}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("Удалить это правило?")) {
                              deleteRuleMut.mutate({ ruleId: rule.id });
                            }
                          }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Rule Editor */}
                    {expandedRuleId === rule.id && editState && (
                      <div className="border-t border-gray-100 p-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Название</label>
                            <input
                              type="text"
                              value={editState.name}
                              onChange={(e) => setEditState({ ...editState, name: e.target.value })}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Шаблон</label>
                            <input
                              type="text"
                              value={editState.pattern}
                              onChange={(e) => setEditState({ ...editState, pattern: e.target.value })}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 font-mono text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Тип документа</label>
                            <select
                              value={editState.documentType}
                              onChange={(e) => setEditState({ ...editState, documentType: e.target.value })}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                              <option value="">Все</option>
                              <option value="protocol">Протокол</option>
                              <option value="icf">ИСД (ICF)</option>
                              <option value="ib">БИ (IB)</option>
                              <option value="csr">ОКИ (CSR)</option>
                            </select>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Этап</label>
                            <input
                              type="text"
                              value={editState.stage}
                              onChange={(e) => setEditState({ ...editState, stage: e.target.value })}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs font-medium text-gray-600">Конфигурация (JSON)</label>
                            <textarea
                              value={editState.config}
                              onChange={(e) => setEditState({ ...editState, config: e.target.value })}
                              rows={4}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs font-medium text-gray-600">Шаблон промпта</label>
                            <textarea
                              value={editState.promptTemplate}
                              onChange={(e) => setEditState({ ...editState, promptTemplate: e.target.value })}
                              rows={6}
                              className="w-full rounded border border-gray-300 px-2.5 py-1.5 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                              placeholder="Введите шаблон промпта..."
                            />
                          </div>
                          <div className="col-span-2 flex items-center gap-6">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editState.isEnabled}
                                onChange={(e) => setEditState({ ...editState, isEnabled: e.target.checked })}
                                className="rounded border-gray-300"
                              />
                              Включено
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editState.requiresFacts}
                                onChange={(e) => setEditState({ ...editState, requiresFacts: e.target.checked })}
                                className="rounded border-gray-300"
                              />
                              Требуются факты
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                              <input
                                type="checkbox"
                                checked={editState.requiresSoa}
                                onChange={(e) => setEditState({ ...editState, requiresSoa: e.target.checked })}
                                className="rounded border-gray-300"
                              />
                              Требуется SOA
                            </label>
                          </div>
                          <div className="col-span-2 flex justify-end gap-2">
                            <button
                              onClick={() => { setExpandedRuleId(null); setEditState(null); }}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Отмена
                            </button>
                            <button
                              onClick={saveRule}
                              disabled={updateRuleMut.isPending}
                              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                            >
                              {updateRuleMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              Сохранить
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {activeVersionQuery.data.rules.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
                    В этой версии нет правил.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
