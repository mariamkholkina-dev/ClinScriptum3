"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import type { ExpectedFinding, ExpectedSeverity } from "./types";

/**
 * Sprint 2b — форма для разметки «модель пропустила это» (FN).
 * Эксперт добавляет finding, которого нет в кандидатах. После approve
 * он попадает в expectedResults.findings вместе с accepted candidates.
 */

const SEVERITY_OPTIONS: ExpectedSeverity[] = ["critical", "high", "medium", "low", "info"];

const FAMILY_OPTIONS = [
  "NUMERIC",
  "TEXT_CONTRADICTION",
  "MISSINGNESS",
  "RANGE_CONSISTENCY",
  "PROCEDURES",
  "DOSING",
  "SAFETY",
  "POPULATION",
  "ENDPOINTS",
  "STATISTICS",
] as const;

interface Props {
  zoneSuggestions: string[];
  onCancel: () => void;
  onSubmit: (finding: ExpectedFinding) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AddMissingForm({ zoneSuggestions, onCancel, onSubmit }: Props) {
  const [issueFamily, setIssueFamily] = useState<string>("NUMERIC");
  const [issueType, setIssueType] = useState("");
  const [severity, setSeverity] = useState<ExpectedSeverity>("medium");
  const [anchorZone, setAnchorZone] = useState("");
  const [anchorQuote, setAnchorQuote] = useState("");
  const [description, setDescription] = useState("");

  const canSubmit =
    issueFamily.trim() &&
    anchorZone.trim() &&
    anchorQuote.trim() &&
    description.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    const f: ExpectedFinding = {
      id: makeId(),
      issueFamily: issueFamily.trim().toUpperCase(),
      issueType: issueType.trim(),
      severity,
      anchorZone: anchorZone.trim().toUpperCase(),
      anchorQuote: anchorQuote.trim(),
      description: description.trim(),
      mustDetect: true,
      notes: "manual: модель пропустила",
    };
    onSubmit(f);
  };

  return (
    <div className="rounded-md border border-purple-300 bg-purple-50/50 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-purple-900">
          <Plus size={14} /> Добавить пропущенное замечание (будущий FN модели)
        </h3>
        <button
          onClick={onCancel}
          className="rounded p-1 text-gray-500 hover:bg-gray-200"
          title="Отмена"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Семейство (issueFamily) *">
          <select
            value={issueFamily}
            onChange={(e) => setIssueFamily(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
          >
            {FAMILY_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Тип (issueType)">
          <input
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            placeholder="например, sample_size_pop_vs_stats"
            className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
          />
        </Field>
        <Field label="Severity">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ExpectedSeverity)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Anchor zone *">
          <input
            value={anchorZone}
            onChange={(e) => setAnchorZone(e.target.value.toUpperCase())}
            placeholder="POPULATION / STATISTICS / SAFETY ..."
            list="zone-suggestions"
            className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs"
          />
          <datalist id="zone-suggestions">
            {zoneSuggestions.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Anchor quote * (цитата из документа, где defect)">
        <textarea
          value={anchorQuote}
          onChange={(e) => setAnchorQuote(e.target.value)}
          rows={2}
          placeholder="«120 пациентов согласно синопсису»"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </Field>

      <Field label="Описание *">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Что не так? Например: «sample size 120 в синопсисе vs 130 в статистике»"
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
        />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
        >
          Отмена
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          Добавить в эталон
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase text-gray-500">{label}</span>
      {children}
    </label>
  );
}
