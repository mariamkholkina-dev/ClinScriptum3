"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ═══════════════ Types (proj. of EvaluationResult.diff from Sprint 1) ═══ */

interface MatchStatsView {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

interface CascadeDecision {
  predictedId: string;
  expectedId: string | null;
  tier: "strict" | "lenient" | "miss";
  score: number;
}

interface CoverageView {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  totalProblems: number;
  coveredProblemIds: string[];
  missedProblemIds: string[];
  hallucinationCandidateIds: string[];
}

interface PerFamilyEntry extends MatchStatsView {
  expectedCount: number;
  predictedCount: number;
}

interface IntraAuditDiff {
  primary?: {
    method: "llm_judge" | "cascade_lenient";
    tp: number;
    fp: number;
    fn: number;
    precision: number;
    recall: number;
    f1: number;
    uncertainCount?: number;
  };
  cascade?: {
    strict: MatchStatsView;
    lenient: MatchStatsView;
    decisions: CascadeDecision[];
  };
  coverage?: CoverageView;
  perFamily?: Record<string, PerFamilyEntry>;
  llmJudgeAuditTrail?: Array<{
    predictedId: string;
    expectedId: string | null;
    verdict: "yes" | "no" | "uncertain";
    rationale?: string;
  }>;
  expectedCounts?: { findings: number; problems: number };
  predictedCount?: number;
}

interface EvalResultView {
  id: string;
  goldenSampleId: string;
  stage: string;
  status: string;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  diff: unknown;
  goldenSample?: { id: string; name?: string | null } | null;
}

/* ═══════════════ Helpers ═══════════════ */

function pct(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function f1Color(f1: number | null | undefined): string {
  if (f1 == null) return "text-gray-400";
  if (f1 >= 0.8) return "text-green-700";
  if (f1 >= 0.6) return "text-yellow-700";
  return "text-red-700";
}

/* ═══════════════ Main page ═══════════════ */

export default function IntraAuditFailureModesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId = params.id;

  const runQuery = trpc.evaluation.getRun.useQuery(
    { id: runId },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const resultsQuery = trpc.evaluation.getRunResults.useQuery(
    { evaluationRunId: runId, stage: "intra_audit" },
    { staleTime: 60_000, refetchOnWindowFocus: false },
  );

  if (runQuery.isLoading || resultsQuery.isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Loader2 size={20} className="mx-auto animate-spin" />
        <p className="mt-2 text-sm">Загрузка failure modes...</p>
      </div>
    );
  }
  if (runQuery.error || resultsQuery.error) {
    return (
      <div className="m-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle size={16} /> {(runQuery.error ?? resultsQuery.error)?.message}
      </div>
    );
  }

  const run = runQuery.data;
  const results = (resultsQuery.data ?? []) as EvalResultView[];

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/evaluation/${runId}`)}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          title="Назад к прогону"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Failure modes — intra-audit</h1>
          <p className="text-xs text-gray-500">
            Прогон: {run?.name ?? runId} · образцов с intra_audit: {results.length}
          </p>
        </div>
      </header>

      {results.length === 0 ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          В этом прогоне нет результатов со stage=&apos;intra_audit&apos;. Проверьте, что у golden
          samples заполнен этап «Внутренний аудит» (см. <code>intra-audit-viewer</code>).
        </p>
      ) : (
        <div className="space-y-6">
          {results.map((r) => (
            <ResultSection key={r.id} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════ One golden sample result ═══════════════ */

function ResultSection({ result }: { result: EvalResultView }) {
  const [expandedTrail, setExpandedTrail] = useState(false);
  const diff = (result.diff ?? {}) as IntraAuditDiff;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-gray-800">
          {result.goldenSample?.name ?? `Образец ${result.goldenSampleId.slice(0, 8)}`}
        </h2>
        <span className="text-xs text-gray-400">
          predicted: {diff.predictedCount ?? "—"}, expected: {diff.expectedCounts?.findings ?? "—"}
        </span>
      </div>

      {/* Primary metric */}
      {diff.primary ? (
        <PrimaryCard primary={diff.primary} />
      ) : (
        <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-700">
          ⚠ Primary метрика отсутствует — возможно, evaluation запускался до Sprint 1.
        </p>
      )}

      {/* Cascade comparison */}
      {diff.cascade && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Cascade — strict vs lenient (диагностика локализации vs классификации)
          </h3>
          <CascadeTable strict={diff.cascade.strict} lenient={diff.cascade.lenient} />
          <p className="mt-1 text-xs text-gray-500">
            Большой разрыв = модель попадает в место, но путает issueType. Маленький разрыв =
            «промахивается местом».
          </p>
        </div>
      )}

      {/* Per-family breakdown */}
      {diff.perFamily && Object.keys(diff.perFamily).length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Разбивка по issueFamily</h3>
          <PerFamilyTable perFamily={diff.perFamily} />
        </div>
      )}

      {/* Coverage */}
      {diff.coverage && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Coverage — на уровне уникальных проблем
          </h3>
          <CoveragePanel coverage={diff.coverage} />
        </div>
      )}

      {/* LLM judge audit trail */}
      {diff.llmJudgeAuditTrail && diff.llmJudgeAuditTrail.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setExpandedTrail(!expandedTrail)}
            className="flex items-center gap-1 text-sm font-semibold text-gray-700 hover:text-gray-900"
          >
            {expandedTrail ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            LLM judge audit trail ({diff.llmJudgeAuditTrail.length} решений)
          </button>
          {expandedTrail && <JudgeTrail trail={diff.llmJudgeAuditTrail} />}
        </div>
      )}
    </section>
  );
}

/* ═══════════════ Sub-panels ═══════════════ */

function PrimaryCard({ primary }: { primary: NonNullable<IntraAuditDiff["primary"]> }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat
        label="Метод"
        value={primary.method === "llm_judge" ? "LLM judge" : "Cascade lenient"}
        hint="Sprint 1 primary"
      />
      <Stat label="F1" value={pct(primary.f1)} valueClass={f1Color(primary.f1)} />
      <Stat
        label="Precision"
        value={pct(primary.precision)}
        hint={`TP=${primary.tp}, FP=${primary.fp}`}
      />
      <Stat
        label="Recall"
        value={pct(primary.recall)}
        hint={`TP=${primary.tp}, FN=${primary.fn}`}
      />
      {primary.uncertainCount !== undefined && primary.uncertainCount > 0 && (
        <div className="col-span-2 rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-700 md:col-span-4">
          ⚠ {primary.uncertainCount} пар получили verdict=&apos;uncertain&apos; — стоит пересмотреть
          руками
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueClass,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${valueClass ?? "text-gray-800"}`}>{value}</p>
      {hint && <p className="text-[10px] text-gray-500">{hint}</p>}
    </div>
  );
}

function CascadeTable({
  strict,
  lenient,
}: {
  strict: MatchStatsView;
  lenient: MatchStatsView;
}) {
  const gap = lenient.f1 - strict.f1;
  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-gray-600">
        <tr>
          <th className="px-2 py-1 text-left">Tier</th>
          <th className="px-2 py-1 text-right">TP</th>
          <th className="px-2 py-1 text-right">FP</th>
          <th className="px-2 py-1 text-right">FN</th>
          <th className="px-2 py-1 text-right">Precision</th>
          <th className="px-2 py-1 text-right">Recall</th>
          <th className="px-2 py-1 text-right">F1</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-gray-100">
          <td className="px-2 py-1 font-medium text-gray-700">Strict</td>
          <td className="px-2 py-1 text-right">{strict.tp}</td>
          <td className="px-2 py-1 text-right">{strict.fp}</td>
          <td className="px-2 py-1 text-right">{strict.fn}</td>
          <td className="px-2 py-1 text-right">{pct(strict.precision)}</td>
          <td className="px-2 py-1 text-right">{pct(strict.recall)}</td>
          <td className={`px-2 py-1 text-right font-semibold ${f1Color(strict.f1)}`}>
            {pct(strict.f1)}
          </td>
        </tr>
        <tr>
          <td className="px-2 py-1 font-medium text-gray-700">Lenient</td>
          <td className="px-2 py-1 text-right">{lenient.tp}</td>
          <td className="px-2 py-1 text-right">{lenient.fp}</td>
          <td className="px-2 py-1 text-right">{lenient.fn}</td>
          <td className="px-2 py-1 text-right">{pct(lenient.precision)}</td>
          <td className="px-2 py-1 text-right">{pct(lenient.recall)}</td>
          <td className={`px-2 py-1 text-right font-semibold ${f1Color(lenient.f1)}`}>
            {pct(lenient.f1)}
          </td>
        </tr>
        <tr className="border-t-2 border-gray-200 bg-gray-50/50">
          <td className="px-2 py-1 text-gray-600 italic">Разрыв lenient−strict</td>
          <td colSpan={5} />
          <td
            className={`px-2 py-1 text-right font-semibold ${
              gap >= 0.2 ? "text-orange-700" : "text-gray-500"
            }`}
          >
            +{pct(gap)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function PerFamilyTable({ perFamily }: { perFamily: Record<string, PerFamilyEntry> }) {
  const families = Object.entries(perFamily).sort(
    (a, b) => (b[1].expectedCount ?? 0) - (a[1].expectedCount ?? 0),
  );
  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-gray-600">
        <tr>
          <th className="px-2 py-1 text-left">Family</th>
          <th className="px-2 py-1 text-right">Expected</th>
          <th className="px-2 py-1 text-right">Predicted</th>
          <th className="px-2 py-1 text-right">TP</th>
          <th className="px-2 py-1 text-right">FP</th>
          <th className="px-2 py-1 text-right">FN</th>
          <th className="px-2 py-1 text-right">F1</th>
        </tr>
      </thead>
      <tbody>
        {families.map(([family, s]) => (
          <tr key={family} className="border-b border-gray-100">
            <td className="px-2 py-1 font-medium text-gray-700">{family}</td>
            <td className="px-2 py-1 text-right">{s.expectedCount}</td>
            <td className="px-2 py-1 text-right">{s.predictedCount}</td>
            <td className="px-2 py-1 text-right text-green-700">{s.tp}</td>
            <td className="px-2 py-1 text-right text-red-700">{s.fp}</td>
            <td className="px-2 py-1 text-right text-orange-700">{s.fn}</td>
            <td className={`px-2 py-1 text-right font-semibold ${f1Color(s.f1)}`}>
              {pct(s.f1)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CoveragePanel({ coverage }: { coverage: CoverageView }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="rounded-md border border-green-200 bg-green-50/50 p-2">
        <p className="text-[10px] uppercase text-green-700">Covered ({coverage.tp})</p>
        <p className="text-xs text-gray-600">
          {coverage.coveredProblemIds.length === 0
            ? "—"
            : coverage.coveredProblemIds.join(", ")}
        </p>
      </div>
      <div className="rounded-md border border-orange-200 bg-orange-50/50 p-2">
        <p className="text-[10px] uppercase text-orange-700">Missed FN ({coverage.fn})</p>
        <p className="text-xs text-gray-600">
          {coverage.missedProblemIds.length === 0 ? "—" : coverage.missedProblemIds.join(", ")}
        </p>
      </div>
      <div className="rounded-md border border-red-200 bg-red-50/50 p-2">
        <p className="text-[10px] uppercase text-red-700">
          Hallucination FP ({coverage.fp})
        </p>
        <p className="break-all text-xs text-gray-600">
          {coverage.hallucinationCandidateIds.length === 0
            ? "—"
            : coverage.hallucinationCandidateIds
                .slice(0, 10)
                .map((id) => id.slice(0, 8))
                .join(", ") +
              (coverage.hallucinationCandidateIds.length > 10
                ? ` … +${coverage.hallucinationCandidateIds.length - 10}`
                : "")}
        </p>
      </div>
    </div>
  );
}

function JudgeTrail({
  trail,
}: {
  trail: NonNullable<IntraAuditDiff["llmJudgeAuditTrail"]>;
}) {
  return (
    <div className="mt-2 max-h-72 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2">
      <table className="w-full text-[11px]">
        <thead className="text-gray-500">
          <tr>
            <th className="px-1 text-left">Verdict</th>
            <th className="px-1 text-left">predicted</th>
            <th className="px-1 text-left">expected</th>
            <th className="px-1 text-left">rationale</th>
          </tr>
        </thead>
        <tbody>
          {trail.map((d, i) => (
            <tr key={i} className="border-t border-gray-200">
              <td className="px-1 font-medium">
                <span
                  className={`rounded px-1 py-0.5 text-[10px] ${
                    d.verdict === "yes"
                      ? "bg-green-100 text-green-700"
                      : d.verdict === "no"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {d.verdict}
                </span>
              </td>
              <td className="px-1 font-mono text-gray-600">{d.predictedId.slice(0, 8)}</td>
              <td className="px-1 font-mono text-gray-600">
                {d.expectedId ? d.expectedId.slice(0, 8) : "—"}
              </td>
              <td className="px-1 text-gray-700">{d.rationale ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
