"use client";

import { useState } from "react";
import { Play, Upload, BarChart3, Minus, FileText } from "lucide-react";

export default function BatchTestingPage() {
  const [showImport, setShowImport] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Пакетное тестирование</h1>
          <p className="mt-1 text-sm text-gray-500">
            Массовая оценка по всему пулу документов (300 документов)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Импорт документов
          </button>
          <button className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            <Play className="h-4 w-4" />
            Запустить пакет
          </button>
        </div>
      </div>

      {/* Pool Summary */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Протоколы", count: 0, icon: FileText, color: "blue" },
          { label: "ICF", count: 0, icon: FileText, color: "green" },
          { label: "IB", count: 0, icon: FileText, color: "purple" },
          { label: "Исследования", count: 0, icon: BarChart3, color: "orange" },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <card.icon className="h-4 w-4" />
              {card.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{card.count}</div>
          </div>
        ))}
      </div>

      {/* Stage Metrics Matrix */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Метрики по этапам и типам документов</h2>
          <p className="text-xs text-gray-500">Уверенность и процент согласия алгоритма/LLM из последнего пакетного запуска</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Этап</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">Протокол</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">ICF</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">IB</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">Дельта</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {["Классификация", "Извлечение", "Обнаружение SOA", "Внутренний аудит", "Межд. аудит"].map((stage) => (
                <tr key={stage} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{stage}</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-400">—</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-400">—</td>
                  <td className="px-4 py-3 text-center text-sm text-gray-400">—</td>
                  <td className="px-4 py-3 text-center">
                    <Minus className="mx-auto h-4 w-4 text-gray-300" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Batch Runs History */}
      <div className="rounded-lg border bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">История пакетных запусков</h2>
        </div>
        <div className="px-4 py-12 text-center text-sm text-gray-400">
          Пока нет пакетных запусков. Импортируйте пул документов и запустите первую пакетную оценку.
        </div>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-6">
            <h2 className="text-lg font-semibold">Импорт пула документов</h2>
            <p className="mt-1 text-sm text-gray-500">
              Загрузите документы с привязкой к исследованиям и информацией о версиях
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
                <Upload className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-2 text-sm text-gray-500">Перетащите файлы сюда или нажмите для выбора</p>
                <p className="text-xs text-gray-400">Поддерживаются файлы .docx. Привязка к исследованиям после загрузки.</p>
              </div>
              <div className="text-xs text-gray-500">
                Ожидается: ~100 протоколов + ~100 ICF + ~100 IB, сгруппированных по исследованиям
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowImport(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
              >
                Отмена
              </button>
              <button className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                Начать импорт
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
