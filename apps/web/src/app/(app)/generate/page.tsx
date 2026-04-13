"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { FileText, Wand2, CheckCircle2, Clock, AlertCircle } from "lucide-react";

const statusLabels: Record<string, string> = {
  completed: "Завершён",
  generating: "Выполняется",
  error: "Ошибка",
  pending: "Ожидает",
};

export default function GeneratePage() {
  const [protocolVersionId, setProtocolVersionId] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [genType, setGenType] = useState<"icf" | "csr">("icf");

  const startMutation = trpc.generation.startGeneration.useMutation({
    onSuccess: (data) => setActiveRunId(data.generatedDocId),
  });

  const resultQuery = trpc.generation.getGeneratedDoc.useQuery(
    { generatedDocId: activeRunId! },
    { enabled: !!activeRunId, refetchInterval: 3000 }
  );

  const handleGenerate = () => {
    if (!protocolVersionId) return;
    startMutation.mutate({ protocolVersionId, docType: genType });
  };

  const result = resultQuery.data;
  const isLoading = startMutation.isPending;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Генерация документов</h1>

      <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
        <div className="flex gap-4">
          <button
            onClick={() => setGenType("icf")}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              genType === "icf"
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            Генерация ICF
          </button>
          <button
            onClick={() => setGenType("csr")}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              genType === "csr"
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            Генерация CSR
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ID версии протокола
          </label>
          <input
            type="text"
            value={protocolVersionId}
            onChange={(e) => setProtocolVersionId(e.target.value)}
            placeholder="UUID разобранной версии протокола"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={isLoading || !protocolVersionId}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4" />
          {isLoading ? "Запуск..." : `Сгенерировать ${genType.toUpperCase()}`}
        </button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border bg-white p-4 shadow-sm">
            {result.status === "completed" && (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            {result.status === "generating" && (
              <Clock className="h-5 w-5 text-amber-600 animate-pulse" />
            )}
            {result.status === "error" && (
              <AlertCircle className="h-5 w-5 text-red-600" />
            )}
            <span className="text-sm font-medium text-gray-900">
              Статус: {statusLabels[result.status] ?? result.status}
            </span>
            <span className="text-xs text-gray-500">
              Секций: {result.sections.length}
            </span>
          </div>

          {result.sections.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Сгенерированные секции ({result.sections.length})
              </h2>
              {result.sections.map((section) => (
                <div key={section.id} className="rounded-lg border bg-white shadow-sm">
                  <div className="flex items-center gap-2 border-b px-4 py-3">
                    <FileText className="h-4 w-4 text-brand-600" />
                    <span className="font-medium text-gray-900">{section.title}</span>
                    <span className="text-xs text-gray-400">({section.standardSection})</span>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {section.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
