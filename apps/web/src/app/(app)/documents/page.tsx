"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { FileText, Loader2, Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

const DOC_TYPE_LABELS: Record<string, string> = {
  protocol: "Протокол",
  icf: "Информированное согласие",
  ib: "Брошюра исследователя",
  csr: "Отчёт КИ",
};

const STATUS_LABELS: Record<string, string> = {
  uploading: "Загрузка",
  parsing: "Разбор структуры",
  classifying_sections: "Присвоение секций",
  extracting_facts: "Выделение фактов",
  detecting_soa: "Определение SoA",
  ready: "Готов",
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
  impact_assessment: "Оценка влияния",
  parsed: "Разобран",
  error: "Ошибка",
};

const STATUS_GROUPS: Record<string, string> = {
  ready: "ready",
  parsed: "ready",
  error: "error",
  uploading: "processing",
  parsing: "processing",
  classifying_sections: "processing",
  extracting_facts: "processing",
  detecting_soa: "processing",
  intra_audit: "processing",
  inter_audit: "processing",
  impact_assessment: "processing",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        status === "ready" && "bg-green-100 text-green-700",
        status === "parsed" && "bg-green-100 text-green-700",
        status === "error" && "bg-red-100 text-red-700",
        status === "uploading" && "bg-gray-100 text-gray-600",
        !["ready", "parsed", "error", "uploading"].includes(status) &&
          "bg-blue-100 text-blue-700"
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

type SortKey = "study" | "type" | "title" | "version" | "status" | "date";
type SortDir = "asc" | "desc";

export default function DocumentsPage() {
  const versionsQuery = trpc.document.listAll.useQuery();

  const [search, setSearch] = useState("");
  const [studyFilter, setStudyFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const studies = useMemo(() => {
    if (!versionsQuery.data) return [];
    const map = new Map<string, string>();
    for (const v of versionsQuery.data) {
      map.set(v.document.study.id, v.document.study.title);
    }
    return Array.from(map, ([id, title]) => ({ id, title })).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }, [versionsQuery.data]);

  const filtered = useMemo(() => {
    if (!versionsQuery.data) return [];
    const q = search.toLowerCase();

    let rows = versionsQuery.data.filter((ver) => {
      if (studyFilter !== "all" && ver.document.study.id !== studyFilter) return false;
      if (typeFilter !== "all" && ver.document.type !== typeFilter) return false;
      if (statusFilter === "ready" && !["ready", "parsed"].includes(ver.status)) return false;
      if (statusFilter === "processing" && STATUS_GROUPS[ver.status] !== "processing") return false;
      if (statusFilter === "error" && ver.status !== "error") return false;
      if (q) {
        return (
          ver.document.study.title.toLowerCase().includes(q) ||
          ver.document.title.toLowerCase().includes(q) ||
          (ver.versionLabel ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "study":
          cmp = a.document.study.title.localeCompare(b.document.study.title);
          break;
        case "type":
          cmp = a.document.type.localeCompare(b.document.type);
          break;
        case "title":
          cmp = a.document.title.localeCompare(b.document.title);
          break;
        case "version":
          cmp = (a.versionLabel ?? "").localeCompare(b.versionLabel ?? "");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "date":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [versionsQuery.data, search, studyFilter, typeFilter, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-gray-300" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 text-brand-600" />
    ) : (
      <ArrowDown className="h-3 w-3 text-brand-600" />
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Документы</h1>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <select
          value={studyFilter}
          onChange={(e) => setStudyFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все исследования</option>
          {studies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все типы</option>
          <option value="protocol">Протокол</option>
          <option value="icf">Информированное согласие</option>
          <option value="ib">Брошюра исследователя</option>
          <option value="csr">Отчёт КИ</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">Все статусы</option>
          <option value="ready">Готов</option>
          <option value="processing">В обработке</option>
          <option value="error">Ошибка</option>
        </select>
      </div>

      {versionsQuery.isLoading && (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      )}

      {versionsQuery.data && versionsQuery.data.length === 0 && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">
            Документы ещё не загружены. Перейдите в исследование, чтобы добавить документ.
          </p>
        </div>
      )}

      {versionsQuery.data && versionsQuery.data.length > 0 && (
        <>
          <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {([
                    ["study", "Исследование"],
                    ["type", "Тип документа"],
                    ["title", "Название"],
                    ["version", "Версия"],
                    ["status", "Статус"],
                    ["date", "Дата"],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      className="px-4 py-3 text-left font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700"
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <SortIcon col={key} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((ver) => (
                  <tr key={ver.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/studies/${ver.document.study.id}`}
                        className="text-brand-600 hover:underline font-medium"
                      >
                        {ver.document.study.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {DOC_TYPE_LABELS[ver.document.type] ?? ver.document.type}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/documents/${ver.id}`}
                        className="text-brand-600 hover:underline font-medium"
                      >
                        {ver.document.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {ver.versionLabel || `v${ver.versionNumber}`}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ver.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                      {new Date(ver.createdAt).toLocaleDateString("ru-RU")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-4">
              Ничего не найдено по заданным фильтрам
            </p>
          )}
          <p className="text-xs text-gray-400">
            Показано {filtered.length} из {versionsQuery.data.length}
          </p>
        </>
      )}
    </div>
  );
}
