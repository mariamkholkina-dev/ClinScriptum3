"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, AlertCircle, GitCompare } from "lucide-react";
import { trpc } from "@/lib/trpc";

/* ═══════════════ Helpers ═══════════════ */

function pct(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function deltaSign(d: number | null | undefined): { text: string; cls: string } {
  if (d == null) return { text: "—", cls: "text-gray-400" };
  const sign = d > 0 ? "+" : "";
  const cls =
    d > 0.02 ? "text-green-700" : d < -0.02 ? "text-red-700" : "text-gray-500";
  return { text: `${sign}${(d * 100).toFixed(1)}%`, cls };
}

function f1Color(f1: number | null | undefined): string {
  if (f1 == null) return "text-gray-400";
  if (f1 >= 0.8) return "text-green-700";
  if (f1 >= 0.6) return "text-yellow-700";
  return "text-red-700";
}

/* ═══════════════ Types ═══════════════ */

interface RunListItem {
  id: string;
  name?: string | null;
  status?: string;
  createdAt?: string | Date;
}

interface PerFamilyRow {
  run1: { p: number | null; r: number | null; f1: number | null; expected: number; predicted: number };
  run2: { p: number | null; r: number | null; f1: number | null; expected: number; predicted: number };
  delta: { p: number | null; r: number | null; f1: number | null };
}

interface CompareResponse {
  run1: { id: string; name?: string | null; createdAt: string | Date; overall: { p: number | null; r: number | null; f1: number | null; samples: number } };
  run2: { id: string; name?: string | null; createdAt: string | Date; overall: { p: number | null; r: number | null; f1: number | null; samples: number } };
  overallDelta: { p: number | null; r: number | null; f1: number | null };
  perFamily: Record<string, PerFamilyRow>;
}

/* ═══════════════ Page ═══════════════ */

export default function IntraAuditComparePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const runId1 = params.id;

  const [runId2, setRunId2] = useState<string | null>(null);

  const runsQuery = trpc.evaluation.listRuns.useQuery(
    {},
    { staleTime: 30_000, refetchOnWindowFocus: false },
  );

  const compareQuery = trpc.evaluation.compareIntraAuditRuns.useQuery(
    { runId1, runId2: runId2! },
    {
      enabled: !!runId2,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  const allRuns = (runsQuery.data ?? []) as RunListItem[];
  // Hide self from selector
  const candidates = allRuns.filter((r) => r.id !== runId1);

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <button
          onClick={() => router.push(`/evaluation/${runId1}`)}
          className="rounded p-1 text-gray-500 hover:bg-gray-100"
          title="Назад к прогону"
        >
          <ArrowLeft size={18} />
        </button>
        <GitCompare size={20} className="text-gray-600" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            Сравнение intra-audit прогонов
          </h1>
          <p className="text-xs text-gray-500">
            Run #1 (this): {runId1.slice(0, 8)} — сравните с другим, чтобы увидеть delta f1 по
            issueFamily.
          </p>
        </div>
      </header>

      {/* Run #2 selector */}
      <section>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Выберите второй прогон для сравнения
        </label>
        {runsQuery.isLoading ? (
          <Loader2 size={16} className="animate-spin text-gray-400" />
        ) : (
          <select
            value={runId2 ?? ""}
            onChange={(e) => setRunId2(e.target.value || null)}
            className="w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">— выбрать —</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.id.slice(0, 8)}
                {r.createdAt && ` · ${new Date(r.createdAt).toLocaleString("ru")}`}
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Results */}
      {!runId2 ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
          Выберите второй прогон выше — таблица сравнения появится здесь.
        </p>
      ) : compareQuery.isLoading ? (
        <div className="py-8 text-center text-gray-500">
          <Loader2 size={20} className="mx-auto animate-spin" />
        </div>
      ) : compareQuery.error ? (
        <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={16} /> {compareQuery.error.message}
        </div>
      ) : compareQuery.data ? (
        <CompareView data={compareQuery.data as unknown as CompareResponse} />
      ) : null}
    </div>
  );
}

/* ═══════════════ CompareView ═══════════════ */

function CompareView({ data }: { data: CompareResponse }) {
  const { run1, run2, overallDelta, perFamily } = data;

  const families = Object.entries(perFamily).sort(
    (a, b) => Math.abs(b[1].delta.f1 ?? 0) - Math.abs(a[1].delta.f1 ?? 0),
  );

  return (
    <div className="space-y-4">
      {/* Run headers */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <RunCard label="Run #1" run={run1} />
        <RunCard label="Run #2" run={run2} />
      </div>

      {/* Overall delta */}
      <div className="rounded-md border border-gray-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">Overall delta (Run #2 − Run #1)</h3>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <DeltaCell label="Precision" d={overallDelta.p} />
          <DeltaCell label="Recall" d={overallDelta.r} />
          <DeltaCell label="F1" d={overallDelta.f1} />
        </div>
      </div>

      {/* Per-family table */}
      <div className="rounded-md border border-gray-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-gray-800">
          Per-family — сортировка по |delta f1| (largest impact first)
        </h3>
        {families.length === 0 ? (
          <p className="py-2 text-center text-xs text-gray-500 italic">
            Нет per-family данных. Возможно, у этих прогонов нет stage=&apos;intra_audit&apos;
            results, или они запускались до Sprint 1 (когда diff.perFamily ещё не писался).
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left">Family</th>
                <th className="px-2 py-1 text-right">Run#1 F1</th>
                <th className="px-2 py-1 text-right">Run#2 F1</th>
                <th className="px-2 py-1 text-right">Δ F1</th>
                <th className="px-2 py-1 text-right">Δ Prec.</th>
                <th className="px-2 py-1 text-right">Δ Recall</th>
                <th className="px-2 py-1 text-right">Exp 1/2</th>
                <th className="px-2 py-1 text-right">Pred 1/2</th>
              </tr>
            </thead>
            <tbody>
              {families.map(([family, row]) => {
                const dF1 = deltaSign(row.delta.f1);
                const dP = deltaSign(row.delta.p);
                const dR = deltaSign(row.delta.r);
                return (
                  <tr key={family} className="border-b border-gray-100">
                    <td className="px-2 py-1 font-medium text-gray-700">{family}</td>
                    <td className={`px-2 py-1 text-right ${f1Color(row.run1.f1)}`}>
                      {pct(row.run1.f1)}
                    </td>
                    <td className={`px-2 py-1 text-right ${f1Color(row.run2.f1)}`}>
                      {pct(row.run2.f1)}
                    </td>
                    <td className={`px-2 py-1 text-right font-semibold ${dF1.cls}`}>
                      {dF1.text}
                    </td>
                    <td className={`px-2 py-1 text-right ${dP.cls}`}>{dP.text}</td>
                    <td className={`px-2 py-1 text-right ${dR.cls}`}>{dR.text}</td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {row.run1.expected}/{row.run2.expected}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {row.run1.predicted}/{row.run2.predicted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function RunCard({
  label,
  run,
}: {
  label: string;
  run: CompareResponse["run1"];
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className="truncate text-sm font-medium text-gray-800">
        {run.name ?? run.id.slice(0, 8)}
      </p>
      <p className="text-[10px] text-gray-400">
        {new Date(run.createdAt).toLocaleString("ru")} · {run.overall.samples} samples
      </p>
      <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
        <div>
          <span className="text-gray-500">P:</span>{" "}
          <span className={f1Color(run.overall.p)}>{pct(run.overall.p)}</span>
        </div>
        <div>
          <span className="text-gray-500">R:</span>{" "}
          <span className={f1Color(run.overall.r)}>{pct(run.overall.r)}</span>
        </div>
        <div>
          <span className="text-gray-500">F1:</span>{" "}
          <span className={`font-semibold ${f1Color(run.overall.f1)}`}>{pct(run.overall.f1)}</span>
        </div>
      </div>
    </div>
  );
}

function DeltaCell({ label, d }: { label: string; d: number | null }) {
  const s = deltaSign(d);
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${s.cls}`}>{s.text}</p>
    </div>
  );
}
