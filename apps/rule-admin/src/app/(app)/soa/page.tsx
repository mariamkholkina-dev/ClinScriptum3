"use client";

import { useState } from "react";
import { Table2, Eye, CheckCircle, XCircle, Filter } from "lucide-react";

type SoaResult = {
  id: string;
  documentName: string;
  documentType: string;
  tableCount: number;
  detectionRate: number;
  procedureAccuracy: number;
  visitAccuracy: number;
  cellAccuracy: number;
  status: "detected" | "validated";
};

const PLACEHOLDER_DATA: SoaResult[] = [];

export default function SoaPage() {
  const [stageFilter, setStageFilter] = useState<string>("all");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Обнаружение и разбор SOA</h1>
          <p className="mt-1 text-sm text-gray-500">
            Проверка и корректировка результатов обнаружения Schedule of Activities
          </p>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Процент обнаружения", value: "—", icon: Table2 },
          { label: "Точность процедур", value: "—", icon: CheckCircle },
          { label: "Точность визитов", value: "—", icon: CheckCircle },
          { label: "Точность ячеек", value: "—", icon: CheckCircle },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <card.icon className="h-4 w-4" />
              {card.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-gray-400" />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="all">Все типы документов</option>
          <option value="protocol">Протокол</option>
          <option value="icf">ICF</option>
          <option value="ib">IB</option>
        </select>
      </div>

      {/* Results Table */}
      <div className="rounded-lg border bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Документ", "Тип", "Таблицы", "Обнаружение", "Процедуры", "Визиты", "Ячейки", "Статус", "Действия"].map(
                (h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {PLACEHOLDER_DATA.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  Пока нет результатов SOA. Обработайте документы через конвейер, чтобы увидеть результаты здесь.
                </td>
              </tr>
            ) : (
              PLACEHOLDER_DATA.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{row.documentName}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {row.documentType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{row.tableCount}</td>
                  <td className="px-4 py-3 text-sm">{(row.detectionRate * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-sm">{(row.procedureAccuracy * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-sm">{(row.visitAccuracy * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3 text-sm">{(row.cellAccuracy * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3">
                    {row.status === "validated" ? (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle className="h-3 w-3" /> Проверено
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-600">
                        <XCircle className="h-3 w-3" /> Обнаружено
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-sm text-blue-600 hover:underline">
                      <Eye className="inline h-4 w-4" /> Просмотр
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
