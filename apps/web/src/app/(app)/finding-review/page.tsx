"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import {
  ClipboardCheck,
  Clock,
  FileSearch,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const AUDIT_TYPE_LABELS: Record<string, string> = {
  intra_audit: "Внутридокументный",
  inter_audit: "Междокументный",
};

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: "Ожидает ревью", bg: "bg-amber-100", color: "text-amber-700" },
  in_review: { label: "На проверке", bg: "bg-blue-100", color: "text-blue-700" },
  published: { label: "Опубликовано", bg: "bg-green-100", color: "text-green-700" },
};

export default function FindingReviewDashboard() {
  const { data: reviews, isLoading } = trpc.findingReview.dashboard.useQuery();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Ревью findings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Документы, ожидающие проверки findings перед публикацией конечному пользователю
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : !reviews || reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16">
          <CheckCircle2 className="h-12 w-12 text-green-300 mb-3" />
          <p className="text-lg font-medium text-gray-500">Нет документов на ревью</p>
          <p className="text-sm text-gray-400 mt-1">
            Все findings проверены и опубликованы
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            const status = STATUS_STYLES[review.status] ?? STATUS_STYLES.pending;
            return (
              <Link
                key={review.id}
                href={`/finding-review/${review.id}`}
                className="flex items-center gap-4 rounded-xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex-none">
                  <div className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-lg",
                    review.status === "pending" ? "bg-amber-50" : "bg-blue-50"
                  )}>
                    {review.status === "pending" ? (
                      <Clock className="h-5 w-5 text-amber-600" />
                    ) : (
                      <FileSearch className="h-5 w-5 text-blue-600" />
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {review.documentTitle}
                    </p>
                    <span className="text-xs text-gray-400">{review.versionLabel}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-gray-500">
                      {review.studyTitle}
                    </span>
                    <span className="text-xs text-gray-300">|</span>
                    <span className="text-xs text-gray-500">
                      {AUDIT_TYPE_LABELS[review.auditType] ?? review.auditType}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-none">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{review.findingsCount}</p>
                    <p className="text-[10px] text-gray-400 uppercase">findings</p>
                  </div>

                  <span className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap",
                    status.bg,
                    status.color
                  )}>
                    {status.label}
                  </span>

                  {review.reviewer && (
                    <span className="text-xs text-gray-400 truncate max-w-[120px]">
                      {review.reviewer.name}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
