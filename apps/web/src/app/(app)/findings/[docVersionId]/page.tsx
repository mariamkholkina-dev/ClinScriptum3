"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { ArrowLeft, AlertTriangle, CheckCircle2, XCircle, Filter } from "lucide-react";

type FindingStatusFilter = "all" | "pending" | "confirmed" | "rejected" | "resolved";
type FindingTypeFilter = "all" | "editorial" | "semantic";

export default function FindingsPage() {
  const { docVersionId } = useParams<{ docVersionId: string }>();
  const [statusFilter, setStatusFilter] = useState<FindingStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<FindingTypeFilter>("all");

  const findingsQuery = trpc.processing.listFindings.useQuery({ docVersionId });
  const updateStatus = trpc.processing.updateFindingStatus.useMutation({
    onSuccess: () => findingsQuery.refetch(),
  });

  const findings = (findingsQuery.data ?? []).filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (typeFilter !== "all" && f.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/documents" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Audit Findings</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <span className="text-sm text-gray-500">Status:</span>
          {(["all", "pending", "confirmed", "rejected", "resolved"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                statusFilter === s
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Type:</span>
          {(["all", "editorial", "semantic"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                typeFilter === t
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {["pending", "confirmed", "rejected", "resolved"].map((status) => {
          const count = (findingsQuery.data ?? []).filter((f) => f.status === status).length;
          return (
            <div key={status} className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-sm text-gray-500 capitalize">{status}</p>
            </div>
          );
        })}
      </div>

      {/* Findings list */}
      {findingsQuery.isLoading && <p className="text-sm text-gray-500">Loading...</p>}

      <div className="space-y-3">
        {findings.map((finding) => (
          <div
            key={finding.id}
            className="rounded-lg border bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      finding.type === "editorial"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-orange-100 text-orange-700"
                    )}
                  >
                    {finding.type}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      finding.status === "pending" && "bg-yellow-100 text-yellow-700",
                      finding.status === "confirmed" && "bg-green-100 text-green-700",
                      finding.status === "rejected" && "bg-red-100 text-red-700",
                      finding.status === "resolved" && "bg-gray-100 text-gray-600"
                    )}
                  >
                    {finding.status}
                  </span>
                  {(finding.extraAttributes as any)?.severity && (
                    <span className="text-xs text-gray-400">
                      Severity: {(finding.extraAttributes as any).severity}
                    </span>
                  )}
                </div>

                <p className="text-sm text-gray-900">{finding.description}</p>

                {finding.suggestion && (
                  <p className="text-sm text-green-700 bg-green-50 rounded p-2">
                    Suggestion: {finding.suggestion}
                  </p>
                )}

                {(finding.sourceRef as any)?.textSnippet && (
                  <p className="text-xs text-gray-500 border-l-2 border-gray-200 pl-3 italic">
                    {(finding.sourceRef as any).textSnippet}
                  </p>
                )}
              </div>

              {finding.status === "pending" && (
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      updateStatus.mutate({ findingId: finding.id, status: "confirmed" })
                    }
                    className="rounded p-1.5 text-green-600 hover:bg-green-50"
                    title="Confirm"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() =>
                      updateStatus.mutate({ findingId: finding.id, status: "rejected" })
                    }
                    className="rounded p-1.5 text-red-600 hover:bg-red-50"
                    title="Reject"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {findings.length === 0 && !findingsQuery.isLoading && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No findings match the current filters.</p>
        </div>
      )}
    </div>
  );
}
