"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  FileText,
  Eye,
  Save,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

/* ═══════════════ Constants ═══════════════ */

const GENERATION_TYPES = ["generation", "generation_qa"] as const;

/* ═══════════════ Component ═══════════════ */

export default function GenerationPromptsPage() {
  const [selectedRuleSetId, setSelectedRuleSetId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);

  const utils = trpc.useUtils();

  // Fetch generation and generation_qa rule sets
  const generationSetsQuery = trpc.ruleManagement.listRuleSets.useQuery({});

  const activeVersionQuery = trpc.ruleManagement.getActiveVersion.useQuery(
    { ruleSetId: selectedRuleSetId! },
    { enabled: !!selectedRuleSetId },
  );

  const updateRuleMut = trpc.ruleManagement.updateRule.useMutation({
    onSuccess: () => {
      utils.ruleManagement.getActiveVersion.invalidate();
      setEditingRuleId(null);
      setEditedPrompt("");
    },
  });

  const filteredSets = (generationSetsQuery.data ?? []).filter((rs: any) =>
    GENERATION_TYPES.includes(rs.type as any),
  );

  // Group by base name (e.g., "icf_introduction" -> generation + generation_qa)
  const generationSets = filteredSets.filter((rs: any) => rs.type === "generation");
  const qaSets = filteredSets.filter((rs: any) => rs.type === "generation_qa");

  const handleSavePrompt = useCallback(() => {
    if (!editingRuleId) return;
    updateRuleMut.mutate({
      ruleId: editingRuleId,
      data: { promptTemplate: editedPrompt },
    });
  }, [editingRuleId, editedPrompt, updateRuleMut]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Промпты генерации</h1>
        <p className="mt-1 text-sm text-gray-500">
          Управление промптами для генерации документов (секции ИСД, ОКИ).
        </p>
      </div>

      {/* Preview Modal */}
      {previewPrompt !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Предпросмотр промпта</h2>
              <button onClick={() => setPreviewPrompt(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-gray-50 p-4 font-mono text-xs text-gray-800 whitespace-pre-wrap">
              {previewPrompt || "(пустой промпт)"}
            </pre>
          </div>
        </div>
      )}

      {generationSetsQuery.isLoading && (
        <div className="flex items-center justify-center p-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      )}

      {generationSetsQuery.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Не удалось загрузить наборы правил генерации.
        </div>
      )}

      {generationSetsQuery.data && (
        <div className="flex gap-6">
          {/* Left Panel: Rule Set list */}
          <div className="w-72 shrink-0">
            <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Наборы генерации</h3>
              </div>
              {filteredSets.length === 0 && (
                <div className="p-4 text-sm text-gray-400">Наборы правил генерации не найдены.</div>
              )}
              {filteredSets.map((rs: any) => (
                <button
                  key={rs.id}
                  onClick={() => {
                    setSelectedRuleSetId(rs.id);
                    setEditingRuleId(null);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    selectedRuleSetId === rs.id
                      ? "bg-brand-50 text-brand-700 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <FileText size={14} className="shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{rs.name}</div>
                    <div className="text-xs text-gray-400">
                      {rs.type === "generation_qa" ? "QA" : "Генерация"}
                      {rs.versions?.[0] ? ` - ${rs.versions[0]._count.rules} правил` : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right Panel: Rules with prompts */}
          <div className="min-w-0 flex-1">
            {!selectedRuleSetId && (
              <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white">
                <p className="text-sm text-gray-400">Выберите набор правил генерации для просмотра промптов.</p>
              </div>
            )}

            {selectedRuleSetId && activeVersionQuery.isLoading && (
              <div className="flex h-64 items-center justify-center rounded-lg border border-gray-200 bg-white">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            )}

            {selectedRuleSetId && activeVersionQuery.isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Активная версия для этого набора правил не найдена.
              </div>
            )}

            {selectedRuleSetId && activeVersionQuery.data && (
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                  <span className="text-sm font-medium text-gray-700">
                    Версия {activeVersionQuery.data.version}
                  </span>
                  <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Активная</span>
                  <span className="ml-2 text-xs text-gray-400">{activeVersionQuery.data.rules.length} правил</span>
                </div>

                {activeVersionQuery.data.rules.map((rule: any) => {
                  const isEditing = editingRuleId === rule.id;

                  return (
                    <div key={rule.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                      <div
                        className="flex cursor-pointer items-center gap-3 px-4 py-3"
                        onClick={() => {
                          if (isEditing) {
                            setEditingRuleId(null);
                          } else {
                            setEditingRuleId(rule.id);
                            setEditedPrompt(rule.promptTemplate ?? "");
                          }
                        }}
                      >
                        {isEditing ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                        <span className="text-sm font-medium text-gray-900">{rule.name}</span>
                        {rule.documentType && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                            {rule.documentType}
                          </span>
                        )}
                        {rule.stage && (
                          <span className="text-xs text-gray-400">{rule.stage}</span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewPrompt(rule.promptTemplate ?? "");
                            }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                          >
                            <Eye size={12} /> Предпросмотр
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="border-t border-gray-100 p-4">
                          <label className="mb-1.5 block text-xs font-medium text-gray-600">Шаблон промпта</label>
                          <textarea
                            value={editedPrompt}
                            onChange={(e) => setEditedPrompt(e.target.value)}
                            rows={12}
                            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                            placeholder="Введите шаблон промпта генерации..."
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              onClick={() => setPreviewPrompt(editedPrompt)}
                              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Eye size={14} /> Предпросмотр
                            </button>
                            <button
                              onClick={() => { setEditingRuleId(null); setEditedPrompt(""); }}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              Отмена
                            </button>
                            <button
                              onClick={handleSavePrompt}
                              disabled={updateRuleMut.isPending}
                              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                            >
                              {updateRuleMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              Сохранить
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {activeVersionQuery.data.rules.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
                    В этой версии нет правил.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
