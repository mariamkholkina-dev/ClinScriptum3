"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FlaskConical, Plus } from "lucide-react";

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
        {studiesQuery.data?.map((study) => (
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
