"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FileText, ArrowLeft } from "lucide-react";

export default function StudyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const studyQuery = trpc.study.getById.useQuery({ id });
  const documentsQuery = trpc.document.listByStudy.useQuery({ studyId: id });

  if (studyQuery.isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!studyQuery.data) return <p className="text-sm text-red-500">Study not found</p>;

  const study = studyQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/studies" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{study.title}</h1>
          <p className="text-sm text-gray-500">Phase {study.phase}</p>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Documents</h2>

        {documentsQuery.isLoading && <p className="text-sm text-gray-500">Loading...</p>}

        {documentsQuery.data && documentsQuery.data.length === 0 && (
          <p className="text-sm text-gray-500">
            No documents yet. Upload a protocol to begin.
          </p>
        )}

        <div className="space-y-3">
          {documentsQuery.data?.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm"
            >
              <div className="rounded-lg bg-green-50 p-2">
                <FileText className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-500 uppercase">{doc.type}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                v{doc.versions[0]?.versionNumber ?? 0}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
