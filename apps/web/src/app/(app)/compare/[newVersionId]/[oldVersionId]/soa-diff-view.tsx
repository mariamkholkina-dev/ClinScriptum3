"use client";

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { Loader2, ArrowRight } from "lucide-react";
import { useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@clinscriptum/api/src/routers/index.js";

type CompareSoaResult = inferRouterOutputs<AppRouter>["comparison"]["compareSoa"];
type SoaDiff = CompareSoaResult["diff"];
type SoaSnapshot = CompareSoaResult["oldSnapshot"];

interface Props {
  oldVersionId: string;
  newVersionId: string;
  oldLabel: string;
  newLabel: string;
}

export function SoaDiffView({ oldVersionId, newVersionId, oldLabel, newLabel }: Props) {
  const query = trpc.comparison.compareSoa.useQuery(
    { oldVersionId, newVersionId },
    { staleTime: 60_000 },
  );

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Не удалось загрузить сравнение SoA: {query.error.message}
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  const { oldSnapshot, newSnapshot, diff } = data;

  if (diff.unchanged && oldSnapshot.cells.length === 0 && newSnapshot.cells.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
        <p className="text-sm text-gray-500">SoA не обнаружена ни в одной из версий.</p>
      </div>
    );
  }

  if (diff.unchanged) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        SoA идентична в обеих версиях.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DiffSummary diff={diff} oldLabel={oldLabel} newLabel={newLabel} />
      <SideBySideMatrix
        oldSnapshot={oldSnapshot}
        newSnapshot={newSnapshot}
        diff={diff}
        oldLabel={oldLabel}
        newLabel={newLabel}
      />
      {diff.footnoteChanges.length > 0 && (
        <FootnoteChanges changes={diff.footnoteChanges} />
      )}
    </div>
  );
}

function DiffSummary({
  diff,
  oldLabel,
  newLabel,
}: {
  diff: SoaDiff;
  oldLabel: string;
  newLabel: string;
}) {
  const items = [
    { label: "Добавленные процедуры", count: diff.addedProcedures.length, tone: "added" as const },
    { label: "Удалённые процедуры", count: diff.removedProcedures.length, tone: "removed" as const },
    { label: "Добавленные визиты", count: diff.addedVisits.length, tone: "added" as const },
    { label: "Удалённые визиты", count: diff.removedVisits.length, tone: "removed" as const },
    { label: "Изменения ячеек", count: diff.cellChanges.length, tone: "modified" as const },
    { label: "Изменения сносок", count: diff.footnoteChanges.length, tone: "modified" as const },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-600">
        <span className="font-medium text-gray-900">{oldLabel}</span>
        <ArrowRight className="h-4 w-4" />
        <span className="font-medium text-gray-900">{newLabel}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {items.map((item) => (
          <div
            key={item.label}
            className={cn(
              "rounded-lg border bg-white p-3 shadow-sm",
              item.count > 0 && item.tone === "added" && "border-emerald-200 bg-emerald-50",
              item.count > 0 && item.tone === "removed" && "border-red-200 bg-red-50",
              item.count > 0 && item.tone === "modified" && "border-amber-200 bg-amber-50",
            )}
          >
            <div className="text-xs text-gray-600">{item.label}</div>
            <div className="text-lg font-bold text-gray-900">{item.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DerivedDiff {
  addedProcSet: Set<string>;
  removedProcSet: Set<string>;
  addedVisitSet: Set<string>;
  removedVisitSet: Set<string>;
  cellChangeMap: Map<string, { oldValue: string | null; newValue: string | null }>;
}

function deriveDiff(diff: SoaDiff): DerivedDiff {
  const cellChangeMap = new Map<string, { oldValue: string | null; newValue: string | null }>();
  for (const c of diff.cellChanges) {
    cellChangeMap.set(`${c.procedure}|${c.visit}`, { oldValue: c.oldValue, newValue: c.newValue });
  }
  return {
    addedProcSet: new Set(diff.addedProcedures),
    removedProcSet: new Set(diff.removedProcedures),
    addedVisitSet: new Set(diff.addedVisits),
    removedVisitSet: new Set(diff.removedVisits),
    cellChangeMap,
  };
}

function snapshotCellMap(snapshot: SoaSnapshot): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of snapshot.cells) m.set(`${c.procedure}|${c.visit}`, c.value);
  return m;
}

function SideBySideMatrix({
  oldSnapshot,
  newSnapshot,
  diff,
  oldLabel,
  newLabel,
}: {
  oldSnapshot: SoaSnapshot;
  newSnapshot: SoaSnapshot;
  diff: SoaDiff;
  oldLabel: string;
  newLabel: string;
}) {
  const derived = useMemo(() => deriveDiff(diff), [diff]);
  const oldCells = useMemo(() => snapshotCellMap(oldSnapshot), [oldSnapshot]);
  const newCells = useMemo(() => snapshotCellMap(newSnapshot), [newSnapshot]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SoaTablePanel
        title={`SoA · ${oldLabel}`}
        snapshot={oldSnapshot}
        cellMap={oldCells}
        derived={derived}
        side="old"
      />
      <SoaTablePanel
        title={`SoA · ${newLabel}`}
        snapshot={newSnapshot}
        cellMap={newCells}
        derived={derived}
        side="new"
      />
    </div>
  );
}

function SoaTablePanel({
  title,
  snapshot,
  cellMap,
  derived,
  side,
}: {
  title: string;
  snapshot: SoaSnapshot;
  cellMap: Map<string, string>;
  derived: DerivedDiff;
  side: "old" | "new";
}) {
  if (snapshot.visits.length === 0 && snapshot.procedures.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center">
        <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-xs text-gray-500">SoA отсутствует в этой версии.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
      <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
        {title}
      </div>
      <div className="overflow-auto max-h-[600px]">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr>
              <th className="border-b border-r px-2 py-1.5 text-left font-medium text-gray-700 sticky left-0 bg-gray-50">
                Процедура
              </th>
              {snapshot.visits.map((v) => {
                const isAdded = side === "new" && derived.addedVisitSet.has(v);
                const isRemoved = side === "old" && derived.removedVisitSet.has(v);
                return (
                  <th
                    key={v}
                    className={cn(
                      "border-b px-2 py-1.5 text-center font-medium text-gray-700 whitespace-nowrap",
                      isAdded && "bg-emerald-100 text-emerald-800",
                      isRemoved && "bg-red-100 text-red-800",
                    )}
                  >
                    {v}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {snapshot.procedures.map((p) => {
              const isProcAdded = side === "new" && derived.addedProcSet.has(p);
              const isProcRemoved = side === "old" && derived.removedProcSet.has(p);
              return (
                <tr key={p} className="border-b last:border-b-0">
                  <td
                    className={cn(
                      "border-r px-2 py-1 text-gray-800 sticky left-0 bg-white whitespace-nowrap",
                      isProcAdded && "bg-emerald-50 text-emerald-800 font-medium",
                      isProcRemoved && "bg-red-50 text-red-800 font-medium",
                    )}
                  >
                    {p}
                  </td>
                  {snapshot.visits.map((v) => {
                    const key = `${p}|${v}`;
                    const value = cellMap.get(key) ?? "";
                    const change = derived.cellChangeMap.get(key);
                    let cellTone: "added" | "removed" | "modified" | null = null;
                    if (change) {
                      if (side === "old" && change.oldValue !== null && change.newValue === null) cellTone = "removed";
                      else if (side === "new" && change.oldValue === null && change.newValue !== null) cellTone = "added";
                      else if (change.oldValue !== null && change.newValue !== null) cellTone = "modified";
                    }
                    return (
                      <td
                        key={v}
                        className={cn(
                          "px-2 py-1 text-center text-gray-700",
                          cellTone === "added" && "bg-emerald-100 text-emerald-800 font-semibold",
                          cellTone === "removed" && "bg-red-100 text-red-800 font-semibold",
                          cellTone === "modified" && "bg-amber-100 text-amber-800 font-semibold",
                        )}
                      >
                        {value || "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FootnoteChanges({
  changes,
}: {
  changes: SoaDiff["footnoteChanges"];
}) {
  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
        Изменения сносок
      </div>
      <ul className="divide-y">
        {changes.map((c) => (
          <li key={`${c.type}-${c.marker}`} className="px-4 py-3 text-sm">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  c.type === "added" && "bg-emerald-100 text-emerald-700",
                  c.type === "removed" && "bg-red-100 text-red-700",
                  c.type === "edited" && "bg-amber-100 text-amber-700",
                )}
              >
                {c.type === "added" ? "Добавлена" : c.type === "removed" ? "Удалена" : "Изменена"}
              </span>
              <span className="font-mono text-xs text-gray-500">[{c.marker}]</span>
            </div>
            {c.type === "edited" && (
              <div className="mt-2 space-y-1 text-xs">
                <div>
                  <span className="text-gray-500">Было:</span>{" "}
                  <span className="text-red-700 line-through">{c.oldText}</span>
                </div>
                <div>
                  <span className="text-gray-500">Стало:</span>{" "}
                  <span className="text-emerald-700">{c.newText}</span>
                </div>
              </div>
            )}
            {c.type === "added" && c.newText && (
              <div className="mt-2 text-xs text-emerald-700">{c.newText}</div>
            )}
            {c.type === "removed" && c.oldText && (
              <div className="mt-2 text-xs text-red-700 line-through">{c.oldText}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
