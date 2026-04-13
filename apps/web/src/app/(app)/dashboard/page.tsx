"use client";

import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/lib/auth-store";
import Link from "next/link";
import { FlaskConical, FileText } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuthStore();
  const studiesQuery = trpc.study.list.useQuery();
  const docsQuery = trpc.document.listAll.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Главная
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Дашборд клинических документов
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/studies"
          className="rounded-xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-brand-50 p-2">
              <FlaskConical className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {studiesQuery.data?.length ?? "—"}
              </p>
              <p className="text-sm text-gray-500">Исследования</p>
            </div>
          </div>
        </Link>

        <Link
          href="/documents"
          className="rounded-xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {docsQuery.data?.length ?? "—"}
              </p>
              <p className="text-sm text-gray-500">Документы</p>
            </div>
          </div>
        </Link>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Последние исследования</h2>

        {studiesQuery.isLoading && (
          <p className="mt-4 text-sm text-gray-500">Загрузка...</p>
        )}

        {studiesQuery.data && studiesQuery.data.length === 0 && (
          <p className="mt-4 text-sm text-gray-500">
            Исследований пока нет. Создайте первое, чтобы начать работу.
          </p>
        )}

        {studiesQuery.data && studiesQuery.data.length > 0 && (
          <div className="mt-4 space-y-3">
            {studiesQuery.data.slice(0, 5).map((study) => (
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
        )}
      </div>
    </div>
  );
}
