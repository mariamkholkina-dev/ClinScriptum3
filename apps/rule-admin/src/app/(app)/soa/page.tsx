"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Table2,
  Eye,
  CheckCircle,
  XCircle,
  Filter,
  AlertTriangle,
  Brain,
  Loader2,
  AlertCircle,
  Target,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

type DocType = "protocol" | "icf" | "ib" | "csr";

const DOC_TYPE_LABELS: Record<DocType, string> = {
  protocol: "Протокол",
  icf: "ICF",
  ib: "IB",
  csr: "CSR",
};

const VERIFICATION_LABELS: Record<string, string> = {
  deterministic: "Детерм.",
  llm_check: "LLM check",
  llm_qa: "LLM QA",
};

export default function SoaPage() {
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const q = trpc.processing.listSoaTablesOverview.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  const metricsQuery = trpc.evaluation.getSoaMetricsByGoldenSample.useQuery(
    undefined,
    { refetchOnWindowFocus: false },
  );

  const tables = q.data ?? [];
  const sampleMetrics = metricsQuery.data ?? [];

  const f1Summary = useMemo(() => {
    const withExpected = sampleMetrics.filter((s) => s.hasExpected);
    if (withExpected.length === 0) return null;
    const avg = (vals: (number | null)[]) => {
      const v = vals.filter((x): x is number => typeof x === "number");
      return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
    };
    const detection = avg(withExpected.map((s) => s.metrics.detectionAgreement));
    const visit = avg(withExpected.map((s) => s.metrics.visit?.f1 ?? null));
    const cell = avg(withExpected.map((s) => s.metrics.cell?.f1 ?? null));
    const fn = avg(withExpected.map((s) => s.metrics.footnoteLink?.f1 ?? null));
    return {
      sampleCount: withExpected.length,
      detection,
      visit,
      cell,
      footnoteLink: fn,
    };
  }, [sampleMetrics]);

  const filtered = useMemo(() => {
    return tables.filter((t) => {
      if (docTypeFilter !== "all" && t.document.type !== docTypeFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tables, docTypeFilter, statusFilter]);

  const summary = useMemo(() => {
    const total = filtered.length;
    const validated = filtered.filter((t) => t.status === "validated").length;
    const notSoa = filtered.filter((t) => t.status === "not_soa").length;
    const withConflict = filtered.filter((t) => t.orientationConflict).length;
    const llmVerified = filtered.filter(
      (t) => t.verificationLevel === "llm_check" || t.verificationLevel === "llm_qa",
    ).length;
    const totalAnchors = filtered.reduce((sum, t) => sum + t.anchorCount, 0);
    const totalDrawings = filtered.reduce((sum, t) => sum + t.drawingCount, 0);
    return { total, validated, notSoa, withConflict, llmVerified, totalAnchors, totalDrawings };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Обнаружение и разбор SOA</h1>
          <p className="mt-1 text-sm text-gray-500">
            Сводка по обнаруженным таблицам Schedule of Activities во всех документах тенанта.
            Перейдите к конкретной таблице для проверки и корректировки.
          </p>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          icon={Table2}
          label="Таблиц SoA"
          value={summary.total}
          hint={`${summary.validated} подтверждено, ${summary.notSoa} исключено`}
        />
        <SummaryCard
          icon={CheckCircle}
          label="Привязок сносок"
          value={summary.totalAnchors}
          hint={`${summary.totalDrawings} графических объектов`}
        />
        <SummaryCard
          icon={Brain}
          label="Проверено LLM"
          value={`${summary.llmVerified}/${summary.total}`}
          hint="llm_check + llm_qa"
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Конфликт ориентации"
          value={summary.withConflict}
          hint="требуют ручной проверки"
          variant={summary.withConflict > 0 ? "amber" : "default"}
        />
      </div>

      {/* F1 Metrics over golden samples */}
      {f1Summary && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-gray-800">
              Метрики на golden set ({f1Summary.sampleCount} samples)
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCell label="Detection agreement" value={f1Summary.detection} />
            <MetricCell label="Visit F1" value={f1Summary.visit} />
            <MetricCell label="Cell F1" value={f1Summary.cell} />
            <MetricCell label="Footnote link F1" value={f1Summary.footnoteLink} />
          </div>
          {sampleMetrics.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-blue-700 hover:underline">
                Per-sample детализация ({sampleMetrics.length})
              </summary>
              <div className="mt-2 max-h-72 overflow-auto rounded border border-blue-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-blue-50">
                    <tr>
                      {["Sample", "Detect", "Visits", "Procedures", "Cells", "Footnotes"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleMetrics.map((s) => (
                      <tr key={s.goldenSampleId} className={s.hasExpected ? "" : "text-gray-400"}>
                        <td className="px-2 py-1 font-medium">{s.sampleName}</td>
                        <td className="px-2 py-1">{s.hasExpected ? formatPct(s.metrics.detectionAgreement) : "—"}</td>
                        <td className="px-2 py-1">{s.hasExpected ? formatPct(s.metrics.visit?.f1) : "—"}</td>
                        <td className="px-2 py-1">{s.hasExpected ? formatPct(s.metrics.procedure?.f1) : "—"}</td>
                        <td className="px-2 py-1">{s.hasExpected ? formatPct(s.metrics.cell?.f1) : "—"}</td>
                        <td className="px-2 py-1">{s.hasExpected ? formatPct(s.metrics.footnoteLink?.f1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-gray-400" />
        <select
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="all">Все типы документов</option>
          <option value="protocol">Протокол</option>
          <option value="icf">ICF</option>
          <option value="ib">IB</option>
          <option value="csr">CSR</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="all">Все статусы</option>
          <option value="detected">Обнаружено</option>
          <option value="validated">Подтверждено</option>
          <option value="not_soa">Исключено</option>
        </select>
        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} из {tables.length}
        </span>
      </div>

      {/* Results Table */}
      <div className="rounded-lg border bg-white">
        {q.isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Загрузка...</span>
          </div>
        )}
        {q.error && (
          <div className="m-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} /> {q.error.message}
          </div>
        )}
        {!q.isLoading && !q.error && (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  "Документ",
                  "Тип",
                  "Версия",
                  "Score",
                  "Визитов",
                  "Ячеек",
                  "Сносок (anchors)",
                  "Графика",
                  "Ориентация",
                  "Проверка",
                  "Статус",
                  "Действия",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm text-gray-400">
                    Пока нет SoA-таблиц, удовлетворяющих фильтрам. Обработайте документы
                    через конвейер, чтобы увидеть результаты.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-900">
                      <span className="block max-w-[260px] truncate" title={row.document.title}>
                        {row.document.title}
                      </span>
                      <span className="block text-xs text-gray-400 truncate">
                        {row.document.study.title}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {DOC_TYPE_LABELS[row.document.type as DocType] ?? row.document.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      v{row.document.versionNumber}
                      {row.document.versionLabel && (
                        <span className="text-gray-400"> ({row.document.versionLabel})</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">{row.soaScore.toFixed(1)}</td>
                    <td className="px-3 py-2 text-sm">{row.visitCount}</td>
                    <td className="px-3 py-2 text-sm">{row.cellCount}</td>
                    <td className="px-3 py-2 text-sm">
                      {row.footnoteCount} <span className="text-gray-400">({row.anchorCount})</span>
                    </td>
                    <td className="px-3 py-2 text-sm">
                      {row.drawingCount > 0 ? (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                          {row.drawingCount}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.orientation === "visits_cols" && <span className="text-gray-600">cols</span>}
                      {row.orientation === "visits_rows" && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">rows</span>
                      )}
                      {row.orientation === "unknown" && (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">?</span>
                      )}
                      {row.orientationConflict && (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600" title="Конфликт ориентации">
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {VERIFICATION_LABELS[row.verificationLevel] ?? row.verificationLevel}
                      {row.llmConfidence != null && (
                        <span className="ml-1 text-gray-400">{Math.round(row.llmConfidence * 100)}%</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.status === "validated" && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="h-3 w-3" /> Подтверждено
                        </span>
                      )}
                      {row.status === "detected" && (
                        <span className="flex items-center gap-1 text-xs text-yellow-600">
                          <Eye className="h-3 w-3" /> Обнаружено
                        </span>
                      )}
                      {row.status === "not_soa" && (
                        <span className="flex items-center gap-1 text-xs text-gray-500">
                          <XCircle className="h-3 w-3" /> Исключено
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/golden-dataset/${row.document.versionId}#soa`}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v * 1000) / 10}%`;
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded border border-blue-100 bg-white p-2.5">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">
        {formatPct(value)}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  variant = "default",
}: {
  icon: typeof Table2;
  label: string;
  value: number | string;
  hint?: string;
  variant?: "default" | "amber";
}) {
  const ring =
    variant === "amber"
      ? "border-amber-200 bg-amber-50/40"
      : "border-gray-200 bg-white";
  return (
    <div className={`rounded-lg border ${ring} p-4`}>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}
