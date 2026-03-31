"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { GitCompare, Plus, Minus, Edit3 } from "lucide-react";

export default function ComparePage() {
  const [oldVersionId, setOldVersionId] = useState("");
  const [newVersionId, setNewVersionId] = useState("");

  const compareMutation = trpc.comparison.compare.useMutation();

  const handleCompare = () => {
    if (oldVersionId && newVersionId) {
      compareMutation.mutate({ oldVersionId, newVersionId });
    }
  };

  const result = compareMutation.data;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Сравнение версий</h1>

      <div className="flex items-end gap-4 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">ID старой версии</label>
          <input
            type="text"
            value={oldVersionId}
            onChange={(e) => setOldVersionId(e.target.value)}
            placeholder="UUID старой версии"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">ID новой версии</label>
          <input
            type="text"
            value={newVersionId}
            onChange={(e) => setNewVersionId(e.target.value)}
            placeholder="UUID новой версии"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={handleCompare}
          disabled={compareMutation.isPending || !oldVersionId || !newVersionId}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {compareMutation.isPending ? "Сравнение..." : "Сравнить"}
        </button>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-4 gap-4">
            <SummaryCard
              icon={<Plus className="h-5 w-5 text-green-600" />}
              label="Добавлено"
              count={result.summary.addedSections}
              bgColor="bg-green-50"
            />
            <SummaryCard
              icon={<Minus className="h-5 w-5 text-red-600" />}
              label="Удалено"
              count={result.summary.removedSections}
              bgColor="bg-red-50"
            />
            <SummaryCard
              icon={<Edit3 className="h-5 w-5 text-amber-600" />}
              label="Изменено"
              count={result.summary.modifiedSections}
              bgColor="bg-amber-50"
            />
            <SummaryCard
              icon={<GitCompare className="h-5 w-5 text-gray-600" />}
              label="Без изменений"
              count={result.summary.unchangedSections}
              bgColor="bg-gray-50"
            />
          </div>

          <div className="space-y-4">
            {result.sectionDiffs
              .filter((d) => d.changeType !== "unchanged")
              .map((diff, i) => (
                <div key={i} className="rounded-lg border bg-white shadow-sm overflow-hidden">
                  <div
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 text-sm font-medium",
                      diff.changeType === "added" && "bg-green-50 text-green-700",
                      diff.changeType === "removed" && "bg-red-50 text-red-700",
                      diff.changeType === "modified" && "bg-amber-50 text-amber-700"
                    )}
                  >
                    {diff.changeType === "added" && <Plus className="h-4 w-4" />}
                    {diff.changeType === "removed" && <Minus className="h-4 w-4" />}
                    {diff.changeType === "modified" && <Edit3 className="h-4 w-4" />}
                    <span>{diff.sectionTitle}</span>
                    {diff.standardSection && (
                      <span className="text-xs opacity-60">({diff.standardSection})</span>
                    )}
                  </div>

                  {diff.changeType === "modified" && (
                    <div className="p-4 text-sm font-mono">
                      {diff.textChanges.map((change, j) => (
                        <span
                          key={j}
                          className={cn(
                            change.type === "add" && "bg-green-100 text-green-800",
                            change.type === "remove" && "bg-red-100 text-red-800 line-through"
                          )}
                        >
                          {change.value}
                        </span>
                      ))}
                    </div>
                  )}

                  {diff.changeType === "added" && diff.newContent && (
                    <div className="p-4 text-sm bg-green-50/50">
                      <p className="text-gray-700 whitespace-pre-wrap">{diff.newContent.slice(0, 500)}</p>
                    </div>
                  )}

                  {diff.changeType === "removed" && diff.oldContent && (
                    <div className="p-4 text-sm bg-red-50/50">
                      <p className="text-gray-700 whitespace-pre-wrap line-through">{diff.oldContent.slice(0, 500)}</p>
                    </div>
                  )}
                </div>
              ))}
          </div>

          {result.factChanges.filter((f) => f.changeType !== "unchanged").length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">Изменения фактов</h2>
              <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Факт</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Изменение</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Было</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Стало</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.factChanges
                      .filter((f) => f.changeType !== "unchanged")
                      .map((fc, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{fc.factKey}</td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                fc.changeType === "added" && "bg-green-100 text-green-700",
                                fc.changeType === "removed" && "bg-red-100 text-red-700",
                                fc.changeType === "modified" && "bg-amber-100 text-amber-700"
                              )}
                            >
                              {fc.changeType === "added" ? "Добавлен" : fc.changeType === "removed" ? "Удалён" : "Изменён"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{fc.oldValue ?? "—"}</td>
                          <td className="px-4 py-3 text-gray-700">{fc.newValue ?? "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  count,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  bgColor: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn("rounded-lg p-2", bgColor)}>{icon}</div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{count}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}
