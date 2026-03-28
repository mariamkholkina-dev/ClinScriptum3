"use client";

import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/lib/auth-store";
import Link from "next/link";
import { FlaskConical, FileText, Plus } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuthStore();
  const studiesQuery = trpc.study.list.useQuery();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome, {user?.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your clinical studies and documentation
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-brand-50 p-2">
              <FlaskConical className="h-5 w-5 text-brand-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                {studiesQuery.data?.length ?? "—"}
              </p>
              <p className="text-sm text-gray-500">Studies</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-50 p-2">
              <FileText className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">—</p>
              <p className="text-sm text-gray-500">Documents</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Studies</h2>
          <Link
            href="/studies"
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            New study
          </Link>
        </div>

        {studiesQuery.isLoading && (
          <p className="mt-4 text-sm text-gray-500">Loading...</p>
        )}

        {studiesQuery.data && studiesQuery.data.length === 0 && (
          <p className="mt-4 text-sm text-gray-500">
            No studies yet. Create your first study to get started.
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{study.title}</p>
                    <p className="text-sm text-gray-500">Phase {study.phase}</p>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(study.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
