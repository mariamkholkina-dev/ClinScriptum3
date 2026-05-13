"use client";

import Link from "next/link";
import { Loader2, AlertCircle, ClipboardCheck, FileText } from "lucide-react";
import { trpc } from "@/lib/trpc";

const STATUS_LABEL: Record<string, string> = {
  pending: "Ожидает",
  in_review: "В работе",
  published: "Опубликовано",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  published: "bg-green-100 text-green-800",
};

const AUDIT_TYPE_LABEL: Record<string, string> = {
  intra_audit: "Внутридокументный",
  inter_audit: "Межд. сравнение",
};

interface DashboardRow {
  id: string;
  docVersionId: string;
  auditType: string;
  status: string;
  reviewer?: { id: string; name?: string | null; email?: string | null } | null;
  createdAt: string | Date;
  documentTitle?: string | null;
  versionLabel?: string | null;
  findingsCount?: number | null;
}

export default function FindingReviewDashboardPage() {
  const dashboardQuery = trpc.findingReview.dashboard.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  if (dashboardQuery.isLoading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Loader2 size={20} className="mx-auto animate-spin" />
        <p className="mt-2 text-sm">Загрузка очереди ревью…</p>
      </div>
    );
  }
  if (dashboardQuery.error) {
    return (
      <div className="m-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
        <AlertCircle size={16} /> {dashboardQuery.error.message}
      </div>
    );
  }

  const reviews = (dashboardQuery.data ?? []) as unknown as DashboardRow[];
  const pending = reviews.filter((r) => r.status !== "published");
  const published = reviews.filter((r) => r.status === "published");

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center gap-3">
        <ClipboardCheck size={22} className="text-gray-600" />
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Ревью замечаний</h1>
          <p className="text-xs text-gray-500">
            Перед публикацией writer&apos;у — qc_operator проходит findings и помечает false
            positives / резко завышенную severity.
          </p>
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          В работе ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-500">
            Нет review в обработке. Они появятся когда запускается intra/inter audit с
            `operatorReviewEnabled=true`.
          </p>
        ) : (
          <ReviewTable rows={pending} />
        )}
      </section>

      {published.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Опубликовано ({published.length})
          </h2>
          <ReviewTable rows={published} />
        </section>
      )}
    </div>
  );
}

function ReviewTable({ rows }: { rows: DashboardRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
          <tr>
            <th className="px-3 py-2">Документ</th>
            <th className="px-3 py-2">Тип</th>
            <th className="px-3 py-2">Статус</th>
            <th className="px-3 py-2 text-right">Замечаний</th>
            <th className="px-3 py-2">Создано</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2">
                <Link
                  href={`/finding-review/${r.id}`}
                  className="flex items-center gap-1 font-medium text-brand-700 hover:underline"
                >
                  <FileText size={14} />
                  {r.documentTitle ?? r.docVersionId.slice(0, 8)}
                  {r.versionLabel && (
                    <span className="ml-1 text-xs text-gray-500">· {r.versionLabel}</span>
                  )}
                </Link>
              </td>
              <td className="px-3 py-2 text-xs text-gray-600">
                {AUDIT_TYPE_LABEL[r.auditType] ?? r.auditType}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-700"}`}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-600">
                {r.findingsCount ?? "—"}
              </td>
              <td className="px-3 py-2 text-xs text-gray-500">
                {new Date(r.createdAt).toLocaleString("ru")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
