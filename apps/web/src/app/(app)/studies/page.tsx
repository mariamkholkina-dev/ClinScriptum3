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
    },
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPhase, setNewPhase] = useState<string>("unknown");

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
            createMutation.mutate({ title: newTitle, phase: newPhase as any });
          }}
          className="rounded-lg border bg-white p-4 shadow-sm space-y-3"
        >
          <input
            type="text"
            placeholder="Название исследования"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            required
            className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <select
            value={newPhase}
            onChange={(e) => setNewPhase(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          >
            <option value="unknown">Не указана</option>
            <option value="I">Фаза I</option>
            <option value="II">Фаза II</option>
            <option value="III">Фаза III</option>
            <option value="IV">Фаза IV</option>
            <option value="I_II">Фаза I/II</option>
            <option value="II_III">Фаза II/III</option>
          </select>
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
            className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="rounded-lg bg-brand-50 p-2">
              <FlaskConical className="h-5 w-5 text-brand-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900">{study.title}</p>
              <p className="text-sm text-gray-500">Фаза {study.phase}</p>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(study.createdAt).toLocaleDateString("ru-RU")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
