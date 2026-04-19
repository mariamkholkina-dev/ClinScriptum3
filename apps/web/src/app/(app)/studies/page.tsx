"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FlaskConical, Plus, Search, X } from "lucide-react";

export default function StudiesPage() {
  const utils = trpc.useUtils();
  const studiesQuery = trpc.study.list.useQuery();
  const createMutation = trpc.study.create.useMutation({
    onSuccess: () => {
      utils.study.list.invalidate();
      setShowCreate(false);
      setNewTitle("");
      setNewSponsor("");
      setNewDrug("");
      setNewTherapeuticArea("");
      setNewProtocolTitle("");
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSponsor, setNewSponsor] = useState("");
  const [newDrug, setNewDrug] = useState("");
  const [newTherapeuticArea, setNewTherapeuticArea] = useState("");
  const [newProtocolTitle, setNewProtocolTitle] = useState("");
  const [newPhase, setNewPhase] = useState("");

  const [searchText, setSearchText] = useState("");
  const [filterPhase, setFilterPhase] = useState("");
  const [filterSponsor, setFilterSponsor] = useState("");
  const [filterArea, setFilterArea] = useState("");

  const allStudies = studiesQuery.data ?? [];

  const uniquePhases = useMemo(
    () => [...new Set(allStudies.map((s) => s.phase).filter(Boolean))].sort(),
    [allStudies],
  );
  const uniqueSponsors = useMemo(
    () => [...new Set(allStudies.map((s) => s.sponsor).filter(Boolean) as string[])].sort(),
    [allStudies],
  );
  const uniqueAreas = useMemo(
    () => [...new Set(allStudies.map((s) => s.therapeuticArea).filter(Boolean) as string[])].sort(),
    [allStudies],
  );

  const filteredStudies = useMemo(() => {
    let list = allStudies;
    if (searchText) {
      const q = searchText.toLowerCase();
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.protocolTitle && s.protocolTitle.toLowerCase().includes(q)) ||
          (s.sponsor && s.sponsor.toLowerCase().includes(q)) ||
          (s.drug && s.drug.toLowerCase().includes(q)) ||
          (s.therapeuticArea && s.therapeuticArea.toLowerCase().includes(q)),
      );
    }
    if (filterPhase) list = list.filter((s) => s.phase === filterPhase);
    if (filterSponsor) list = list.filter((s) => s.sponsor === filterSponsor);
    if (filterArea) list = list.filter((s) => s.therapeuticArea === filterArea);
    return list;
  }, [allStudies, searchText, filterPhase, filterSponsor, filterArea]);

  const hasFilters = searchText || filterPhase || filterSponsor || filterArea;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Исследования</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          Новое исследование
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Поиск по номеру, названию, спонсору, препарату..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        {uniquePhases.length > 0 && (
          <select
            value={filterPhase}
            onChange={(e) => setFilterPhase(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все фазы</option>
            {uniquePhases.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        )}
        {uniqueSponsors.length > 1 && (
          <select
            value={filterSponsor}
            onChange={(e) => setFilterSponsor(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все спонсоры</option>
            {uniqueSponsors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {uniqueAreas.length > 1 && (
          <select
            value={filterArea}
            onChange={(e) => setFilterArea(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Все терапевтические области</option>
            {uniqueAreas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button
            onClick={() => { setSearchText(""); setFilterPhase(""); setFilterSponsor(""); setFilterArea(""); }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            <X className="h-3.5 w-3.5" />
            Сбросить
          </button>
        )}
      </div>

      {hasFilters && (
        <p className="text-xs text-gray-500">
          Найдено: {filteredStudies.length} из {allStudies.length}
        </p>
      )}

      {showCreate && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({
              title: newTitle,
              sponsor: newSponsor || undefined,
              drug: newDrug || undefined,
              therapeuticArea: newTherapeuticArea || undefined,
              protocolTitle: newProtocolTitle || undefined,
              phase: newPhase || undefined,
            });
          }}
          className="rounded-lg border bg-white p-4 shadow-sm space-y-3"
        >
          <input
            type="text"
            placeholder="Номер протокола"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="text"
            placeholder="Название протокола"
            value={newProtocolTitle}
            onChange={(e) => setNewProtocolTitle(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="text"
            placeholder="Спонсор"
            value={newSponsor}
            onChange={(e) => setNewSponsor(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="text"
            placeholder="Препарат / МИ"
            value={newDrug}
            onChange={(e) => setNewDrug(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="text"
            placeholder="Терапевтическая область"
            value={newTherapeuticArea}
            onChange={(e) => setNewTherapeuticArea(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <input
            type="text"
            placeholder="Фаза исследования"
            value={newPhase}
            onChange={(e) => setNewPhase(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Создать
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {studiesQuery.isLoading && <p className="text-sm text-gray-500">Загрузка...</p>}

      <div className="space-y-3">
        {filteredStudies.map((study) => (
          <Link
            key={study.id}
            href={`/studies/${study.id}`}
            className="block rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-brand-50 p-2">
                <FlaskConical className="h-5 w-5 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{study.title}</p>
                {study.protocolTitle && (
                  <p className="text-sm text-gray-500 truncate">{study.protocolTitle}</p>
                )}
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {new Date(study.createdAt).toLocaleDateString("ru-RU")}
              </span>
            </div>
            {(study.sponsor || study.drug || study.therapeuticArea || study.phase) && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 pl-11 text-xs text-gray-500">
                {study.sponsor && (
                  <span><span className="text-gray-400">Спонсор:</span> {study.sponsor}</span>
                )}
                {study.drug && (
                  <span><span className="text-gray-400">Препарат / МИ:</span> {study.drug}</span>
                )}
                {study.therapeuticArea && (
                  <span><span className="text-gray-400">Терапевтическая область:</span> {study.therapeuticArea}</span>
                )}
                {study.phase && (
                  <span><span className="text-gray-400">Фаза:</span> {study.phase}</span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
