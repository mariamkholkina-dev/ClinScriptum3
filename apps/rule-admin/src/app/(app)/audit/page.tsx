"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  section_classification: "Классификация секций",
  fact_extraction: "Извлечение фактов",
  soa_detection: "Обнаружение SOA",
  intra_doc_audit: "Внутренний аудит",
  inter_doc_audit: "Межд. аудит",
  icf_generation: "Генерация ICF",
  csr_generation: "Генерация CSR",
  version_comparison: "Сравнение версий",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  pending: "bg-yellow-100 text-yellow-700",
  skipped: "bg-gray-100 text-gray-500",
};

const LEVEL_LABELS: Record<string, string> = {
  deterministic: "Детерминированный",
  llm_check: "LLM проверка",
  llm_qa: "LLM QA",
  operator_review: "Оператор",
  user_validation: "Валидация",
};

function Badge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className ?? ""}`}>
      {label}
    </span>
  );
}

function LlmConfigCell({ snapshot }: { snapshot: any }) {
  if (!snapshot) return <span className="text-gray-400">—</span>;
  const provider = snapshot.provider ?? snapshot.llmProvider ?? "?";
  const model = snapshot.model ?? snapshot.llmModel ?? "?";
  const temp = snapshot.temperature ?? snapshot.llmTemperature;
  return (
    <div className="text-xs leading-tight">
      <div className="font-medium">{provider}</div>
      <div className="text-gray-500">{model}</div>
      {temp !== undefined && temp !== null && (
        <div className="text-gray-400">t={temp}</div>
      )}
    </div>
  );
}

function RuleSnapshotCell({ snapshot }: { snapshot: any }) {
  if (!snapshot) return <span className="text-gray-400">—</span>;
  const rules = Array.isArray(snapshot) ? snapshot : snapshot.rules;
  if (!rules) return <span className="text-gray-400">—</span>;
  return <span className="text-xs text-gray-600">{rules.length} правил(а)</span>;
}

function ExpandedRow({ runId }: { runId: string }) {
  const { data: run } = trpc.processing.getRun.useQuery({ runId });

  if (!run) return <tr><td colSpan={8} className="px-4 py-3 text-sm text-gray-500">Загрузка...</td></tr>;

  const steps = run.steps ?? [];
  if (steps.length === 0) {
    return <tr><td colSpan={8} className="px-4 py-3 text-sm text-gray-400">Нет этапов</td></tr>;
  }

  return (
    <>
      <tr className="bg-gray-50">
        <td />
        <td colSpan={7}>
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase">
                <th className="px-3 py-1 text-left font-medium">Уровень</th>
                <th className="px-3 py-1 text-left font-medium">Статус</th>
                <th className="px-3 py-1 text-left font-medium">LLM конфиг</th>
                <th className="px-3 py-1 text-left font-medium">Правила</th>
                <th className="px-3 py-1 text-left font-medium">Начало</th>
                <th className="px-3 py-1 text-left font-medium">Длительность</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step: any) => {
                const dur = step.startedAt && step.completedAt
                  ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000)
                  : null;
                return (
                  <tr key={step.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-sm">{LEVEL_LABELS[step.level] ?? step.level}</td>
                    <td className="px-3 py-1.5">
                      <Badge label={step.status} className={STATUS_COLORS[step.status] ?? "bg-gray-100"} />
                    </td>
                    <td className="px-3 py-1.5"><LlmConfigCell snapshot={step.llmConfigSnapshot} /></td>
                    <td className="px-3 py-1.5"><RuleSnapshotCell snapshot={step.ruleSnapshot} /></td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {step.startedAt ? new Date(step.startedAt).toLocaleTimeString("ru") : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {dur !== null ? `${dur}с` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}

export default function AuditPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.processing.listAllRuns.useQuery({
    limit: 50,
    type: typeFilter || undefined,
    status: statusFilter || undefined,
  });

  const runs = data?.runs ?? [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Аудит обработок</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          Обновить
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Все типы</option>
          {Object.entries(TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          <option value="queued">В очереди</option>
          <option value="running">Выполняется</option>
          <option value="completed">Завершено</option>
          <option value="failed">Ошибка</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
        </div>
      ) : runs.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
          Обработки не найдены
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium uppercase text-gray-500">
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3">Документ</th>
                <th className="px-4 py-3">Исследование</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Bundle</th>
                <th className="px-4 py-3">Этапы</th>
                <th className="px-4 py-3">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run: any) => {
                const isExpanded = expandedId === run.id;
                return (
                  <>
                    <tr
                      key={run.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => setExpandedId(isExpanded ? null : run.id)}
                    >
                      <td className="px-4 py-3 text-gray-400">
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {run.docVersion?.document?.title ?? "—"}
                        </div>
                        <div className="text-xs text-gray-500">
                          v{run.docVersion?.versionNumber ?? "?"} &middot; {run.docVersion?.document?.type ?? ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {run.study?.title ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {TYPE_LABELS[run.type] ?? run.type}
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={run.status} className={STATUS_COLORS[run.status] ?? "bg-gray-100"} />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {run.ruleSetBundle ? (
                          <span className="text-gray-700">{run.ruleSetBundle.name}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {run.steps?.length ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(run.createdAt).toLocaleString("ru")}
                      </td>
                    </tr>
                    {isExpanded && <ExpandedRow key={`${run.id}-exp`} runId={run.id} />}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
