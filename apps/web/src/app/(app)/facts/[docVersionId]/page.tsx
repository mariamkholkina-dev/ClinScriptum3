"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { ArrowLeft, AlertTriangle, Database } from "lucide-react";

const statusLabels: Record<string, string> = {
  extracted: "Извлечён",
  verified: "Проверен",
  validated: "Подтверждён",
  rejected: "Отклонён",
};

export default function FactsPage() {
  const { docVersionId } = useParams<{ docVersionId: string }>();
  const factsQuery = trpc.processing.listFacts.useQuery({ docVersionId });

  const grouped = new Map<string, typeof factsQuery.data>();
  for (const fact of factsQuery.data ?? []) {
    const list = grouped.get(fact.factClass) ?? [];
    list.push(fact);
    grouped.set(fact.factClass, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/documents" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Извлечённые факты</h1>
      </div>

      {factsQuery.isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      {Array.from(grouped.entries()).map(([cls, facts]) => (
        <div key={cls} className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900 capitalize">Факты: {cls}</h2>
          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Ключ</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Значение</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Статус</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Противоречия</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {facts!.map((fact) => (
                  <tr key={fact.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{fact.factKey}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-sm truncate">{fact.value}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          fact.status === "validated" && "bg-green-100 text-green-700",
                          fact.status === "extracted" && "bg-gray-100 text-gray-600",
                          fact.status === "verified" && "bg-blue-100 text-blue-700",
                          fact.status === "rejected" && "bg-red-100 text-red-700"
                        )}
                      >
                        {statusLabels[fact.status] ?? fact.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {fact.hasContradiction && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <AlertTriangle className="h-3 w-3" /> Противоречие
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {(factsQuery.data ?? []).length === 0 && !factsQuery.isLoading && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <Database className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">Факты ещё не извлечены.</p>
        </div>
      )}
    </div>
  );
}
