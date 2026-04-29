"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Toggle } from "@/components/Toggle";
import {
  Beaker,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Globe,
  X,
  Plus,
} from "lucide-react";

export default function StudySettingsPage() {
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  const studiesQuery = trpc.study.list.useQuery();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Настройки обработки
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Глобальные параметры и настройки для каждого исследования
        </p>
      </div>

      {/* Global settings */}
      <GlobalConfigPanel />

      {/* Study selector */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-medium text-gray-700">Исследование</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Настройки исследования переопределяют глобальные
          </p>
        </div>
        <div className="p-6">
          {studiesQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" />
              Загрузка списка исследований...
            </div>
          )}

          {studiesQuery.isError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={16} />
              {studiesQuery.error.message}
            </div>
          )}

          {studiesQuery.data && studiesQuery.data.length === 0 && (
            <p className="text-sm text-gray-500">Нет исследований</p>
          )}

          {studiesQuery.data && studiesQuery.data.length > 0 && (
            <div className="space-y-1">
              {studiesQuery.data.map((study) => (
                <button
                  key={study.id}
                  onClick={() => setSelectedStudyId(study.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm transition-colors ${
                    selectedStudyId === study.id
                      ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                      : "text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Beaker
                      size={18}
                      className={
                        selectedStudyId === study.id
                          ? "text-brand-500"
                          : "text-gray-400"
                      }
                    />
                    <div>
                      <div className="font-medium">{study.title}</div>
                      {study.phase && (
                        <div className="text-xs text-gray-400">
                          Фаза: {study.phase}
                          {study.sponsor ? ` | ${study.sponsor}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className={
                      selectedStudyId === study.id
                        ? "text-brand-400"
                        : "text-gray-300"
                    }
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {selectedStudyId && <StudySettingsPanel studyId={selectedStudyId} />}
    </div>
  );
}

/* ──────────── Global Config Panel ──────────── */

function GlobalConfigPanel() {
  const utils = trpc.useUtils();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const configQuery = trpc.study.getGlobalConfig.useQuery();
  const updateMutation = trpc.study.updateGlobalConfig.useMutation({
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      utils.study.getGlobalConfig.invalidate();
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => setSaveStatus("error"),
  });

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const config = configQuery.data;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-gray-500" />
          <h2 className="text-sm font-medium text-gray-700">Глобальные настройки</h2>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="px-6 py-5">
        <ExcludedPrefixesEditor
          value={config?.excludedSectionPrefixes ?? []}
          onChange={(prefixes) => updateMutation.mutate({ excludedSectionPrefixes: prefixes })}
          disabled={updateMutation.isPending}
          description="Секции, начинающиеся с этих префиксов, исключаются из извлечения фактов на всех уровнях (детерминированный, LLM, QA). Применяется ко всем исследованиям, если не переопределено."
        />
      </div>
    </div>
  );
}

/* ──────────── Study Settings Panel ──────────── */

function StudySettingsPanel({ studyId }: { studyId: string }) {
  const utils = trpc.useUtils();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const settingsQuery = trpc.study.getSettings.useQuery({ studyId });

  const updateMutation = trpc.study.updateSettings.useMutation({
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      utils.study.getSettings.invalidate({ studyId });
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => setSaveStatus("error"),
  });

  if (settingsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-12 shadow-sm">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={16} />
          {settingsQuery.error.message}
        </div>
      </div>
    );
  }

  const settings = settingsQuery.data;
  if (!settings) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-medium text-gray-700">
          Параметры пайплайна
        </h2>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="divide-y divide-gray-100">
        {/* Operator Review */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-900">
              Ревью оператором
            </div>
            <div className="text-xs text-gray-500 max-w-md">
              Включает шаг ручной проверки оператором (уровень 4) в пайплайне
              обработки. Классификация секций, извлечение фактов и аудит будут
              ожидать одобрения оператора перед переходом к следующему этапу.
            </div>
          </div>
          <Toggle
            checked={settings.operatorReviewEnabled}
            onChange={(value) =>
              updateMutation.mutate({
                studyId,
                operatorReviewEnabled: value,
              })
            }
            disabled={updateMutation.isPending}
          />
        </div>

        {/* LLM Thinking Mode */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-900">
              Режим рассуждений LLM (Thinking)
            </div>
            <div className="text-xs text-gray-500 max-w-md">
              Разрешает LLM использовать цепочку рассуждений при генерации
              текстовых ответов. В режиме JSON thinking автоматически
              отключается. Для нерассуждающих моделей настройка не влияет на
              работу.
            </div>
          </div>
          <Toggle
            checked={settings.llmThinkingEnabled}
            onChange={(value) =>
              updateMutation.mutate({
                studyId,
                llmThinkingEnabled: value,
              })
            }
            disabled={updateMutation.isPending}
          />
        </div>

        {/* Excluded Section Prefixes */}
        <div className="px-6 py-5">
          <ExcludedPrefixesEditor
            value={settings.excludedSectionPrefixes}
            onChange={(prefixes) =>
              updateMutation.mutate({ studyId, excludedSectionPrefixes: prefixes })
            }
            disabled={updateMutation.isPending}
            description="Переопределяет глобальный список. Оставьте пустым, чтобы использовать глобальные настройки."
            showClearButton
            onClear={() =>
              updateMutation.mutate({ studyId, excludedSectionPrefixes: [] })
            }
          />
        </div>

        {/* Audit Mode */}
        <div className="px-6 py-5">
          <AuditModeSelector
            value={settings.auditMode ?? "auto"}
            onChange={(mode) =>
              updateMutation.mutate({ studyId, auditMode: mode as "auto" | "single_call" | "zone_based" })
            }
            disabled={updateMutation.isPending}
          />
        </div>

        {/* Cross-Check Pairs */}
        <div className="px-6 py-5">
          <CrossCheckPairsEditor
            value={settings.crossCheckPairs ?? null}
            onChange={(pairs) =>
              updateMutation.mutate({ studyId, crossCheckPairs: pairs })
            }
            disabled={updateMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────── Excluded Prefixes Editor ──────────── */

function ExcludedPrefixesEditor({
  value,
  onChange,
  disabled,
  description,
  showClearButton,
  onClear,
}: {
  value: string[];
  onChange: (prefixes: string[]) => void;
  disabled?: boolean;
  description: string;
  showClearButton?: boolean;
  onClear?: () => void;
}) {
  const [newPrefix, setNewPrefix] = useState("");

  const handleAdd = () => {
    const trimmed = newPrefix.trim().toLowerCase();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setNewPrefix("");
  };

  const handleRemove = (prefix: string) => {
    onChange(value.filter((p) => p !== prefix));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium text-gray-900">
            Исключённые секции
          </div>
          <div className="text-xs text-gray-500 max-w-md">
            {description}
          </div>
        </div>
        {showClearButton && value.length > 0 && (
          <button
            onClick={onClear}
            disabled={disabled}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Сбросить к глобальным
          </button>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((prefix) => (
            <span
              key={prefix}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
            >
              {prefix}
              <button
                onClick={() => handleRemove(prefix)}
                disabled={disabled}
                className="rounded-full p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 disabled:opacity-50"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {value.length === 0 && showClearButton && (
        <p className="text-xs text-gray-400 italic">Используются глобальные настройки</p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newPrefix}
          onChange={(e) => setNewPrefix(e.target.value)}
          placeholder="Например: ip.safety_data"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          onClick={handleAdd}
          disabled={disabled || !newPrefix.trim()}
          className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Plus size={14} />
          Добавить
        </button>
      </div>
    </div>
  );
}

/* ──────────── Audit Mode Selector ──────────── */

const AUDIT_MODE_OPTIONS = [
  { value: "auto", label: "Авто", description: "Variant 1 если документ помещается в контекстное окно, иначе Variant 2" },
  { value: "single_call", label: "Variant 1 — один вызов", description: "Весь документ одним вызовом LLM (combined prompt: self+cross+editorial)" },
  { value: "zone_based", label: "Variant 2 — по зонам", description: "Зонный аудит с параллельными вызовами (self-check + cross-check + editorial для каждой зоны)" },
] as const;

function AuditModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium text-gray-900">
          Режим intra-doc аудита
        </div>
        <div className="text-xs text-gray-500 max-w-md">
          Определяет стратегию LLM-аудита документа. Variant 1 отправляет весь
          документ одним запросом, Variant 2 разбивает на зоны и проверяет
          параллельно.
        </div>
      </div>

      <div className="space-y-2">
        {AUDIT_MODE_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
              value === opt.value
                ? "border-brand-300 bg-brand-50"
                : "border-gray-200 hover:bg-gray-50"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <input
              type="radio"
              name="auditMode"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              disabled={disabled}
              className="mt-0.5 text-brand-600 focus:ring-brand-500"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">{opt.label}</div>
              <div className="text-xs text-gray-500">{opt.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ──────────── Cross-Check Pairs Editor ──────────── */

const KNOWN_ZONES = [
  "synopsis", "introduction", "study_objectives", "study_design",
  "study_population", "treatments", "efficacy_assessments",
  "safety_assessments", "statistics", "schedule_of_assessments",
  "ethics", "references", "abbreviations", "appendices",
];

const DEFAULT_AFFINITY_PAIRS: [string, string][] = [
  ["synopsis", "study_design"],
  ["synopsis", "study_objectives"],
  ["synopsis", "study_population"],
  ["synopsis", "treatments"],
  ["synopsis", "efficacy_assessments"],
  ["synopsis", "safety_assessments"],
  ["synopsis", "statistics"],
  ["synopsis", "schedule_of_assessments"],
  ["study_objectives", "efficacy_assessments"],
  ["study_objectives", "statistics"],
  ["efficacy_assessments", "statistics"],
  ["efficacy_assessments", "schedule_of_assessments"],
  ["study_design", "schedule_of_assessments"],
  ["study_design", "study_population"],
  ["study_design", "appendices"],
  ["safety_assessments", "treatments"],
  ["safety_assessments", "schedule_of_assessments"],
  ["safety_assessments", "study_population"],
  ["safety_assessments", "ethics"],
  ["study_population", "statistics"],
  ["treatments", "schedule_of_assessments"],
];

function CrossCheckPairsEditor({
  value,
  onChange,
  disabled,
}: {
  value: [string, string][] | null;
  onChange: (pairs: [string, string][] | null) => void;
  disabled?: boolean;
}) {
  const [newAnchor, setNewAnchor] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const isManual = value !== null;
  const pairs = value ?? DEFAULT_AFFINITY_PAIRS;

  const handleAdd = () => {
    if (!newAnchor || !newTarget || newAnchor === newTarget) return;
    const alreadyExists = pairs.some(
      ([a, b]) => (a === newAnchor && b === newTarget) || (a === newTarget && b === newAnchor),
    );
    if (alreadyExists) return;
    onChange([...pairs, [newAnchor, newTarget]]);
    setNewAnchor("");
    setNewTarget("");
  };

  const handleRemove = (index: number) => {
    const updated = pairs.filter((_, i) => i !== index);
    onChange(updated.length > 0 ? updated : null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium text-gray-900">
            Cross-check пары (Variant 2)
          </div>
          <div className="text-xs text-gray-500 max-w-md">
            Пары зон для перекрёстной проверки. В авто-режиме система определяет
            пары на основе карты аффинности зон, фильтруя по реально
            присутствующим в документе.
          </div>
        </div>
        {isManual && (
          <button
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Сбросить к авто
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${
            isManual
              ? "bg-amber-100 text-amber-700"
              : "bg-green-100 text-green-700"
          }`}
        >
          {isManual ? "Ручной" : "Авто"}
        </span>
        <span className="text-gray-400">{pairs.length} пар</span>
      </div>

      {pairs.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Reference</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Target</th>
                {isManual && <th className="w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pairs.map(([anchor, target], i) => (
                <tr key={`${anchor}-${target}`} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-mono text-gray-700">{anchor}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-700">{target}</td>
                  {isManual && (
                    <td className="px-1">
                      <button
                        onClick={() => handleRemove(i)}
                        disabled={disabled}
                        className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <X size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={newAnchor}
          onChange={(e) => setNewAnchor(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">Reference зона...</option>
          {KNOWN_ZONES.map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <span className="text-gray-400 text-xs">&rarr;</span>
        <select
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
        >
          <option value="">Target зона...</option>
          {KNOWN_ZONES.filter((z) => z !== newAnchor).map((z) => (
            <option key={z} value={z}>{z}</option>
          ))}
        </select>
        <button
          onClick={handleAdd}
          disabled={disabled || !newAnchor || !newTarget || newAnchor === newTarget}
          className="inline-flex items-center gap-1 rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Plus size={14} />
          Добавить
        </button>
      </div>
    </div>
  );
}

/* ──────────── Save Status Indicator ──────────── */

function SaveStatusIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "saving") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <Loader2 size={12} className="animate-spin" />
        Сохранение...
      </div>
    );
  }
  if (status === "saved") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 size={12} />
        Сохранено
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-red-600">
        <AlertCircle size={12} />
        Ошибка сохранения
      </div>
    );
  }
  return null;
}
