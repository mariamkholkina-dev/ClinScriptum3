"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/cn";
import { ArrowLeft, FileText, ChevronRight } from "lucide-react";

export default function DocumentVersionPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const versionQuery = trpc.document.getVersion.useQuery({ versionId });

  if (versionQuery.isLoading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!versionQuery.data) return <p className="text-sm text-red-500">Document version not found</p>;

  const version = versionQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/studies/${version.document.studyId}`}
          className="text-gray-400 hover:text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{version.document.title}</h1>
          <p className="text-sm text-gray-500">
            Version {version.versionNumber} &middot;{" "}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                version.status === "parsed" && "bg-green-100 text-green-700",
                version.status === "parsing" && "bg-yellow-100 text-yellow-700",
                version.status === "error" && "bg-red-100 text-red-700",
                version.status === "uploading" && "bg-gray-100 text-gray-700"
              )}
            >
              {version.status}
            </span>
          </p>
        </div>
      </div>

      {version.sections.length > 0 && (
        <div className="grid grid-cols-12 gap-6">
          {/* Section navigation */}
          <div className="col-span-4 space-y-1 rounded-lg border bg-white p-4 shadow-sm max-h-[70vh] overflow-auto">
            <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Document Structure
            </h2>
            {version.sections.map((section) => (
              <a
                key={section.id}
                href={`#section-${section.id}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
                style={{ paddingLeft: `${(section.level - 1) * 16 + 8}px` }}
              >
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-gray-400" />
                <span className="truncate">{section.title}</span>
              </a>
            ))}
          </div>

          {/* Content */}
          <div className="col-span-8 space-y-6">
            {version.sections.map((section) => (
              <div
                key={section.id}
                id={`section-${section.id}`}
                className="rounded-lg border bg-white p-6 shadow-sm"
              >
                <div className="flex items-start justify-between mb-4">
                  <h3
                    className={cn(
                      "font-semibold text-gray-900",
                      section.level === 1 && "text-xl",
                      section.level === 2 && "text-lg",
                      section.level >= 3 && "text-base"
                    )}
                  >
                    {section.title}
                  </h3>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      section.status === "validated" && "bg-green-100 text-green-700",
                      section.status === "not_validated" && "bg-gray-100 text-gray-600",
                      section.status === "requires_rework" && "bg-red-100 text-red-700"
                    )}
                  >
                    {section.status}
                  </span>
                </div>

                {section.contentBlocks.map((block) => (
                  <div key={block.id} className="mb-3">
                    {block.type === "paragraph" && (
                      <p className="text-sm text-gray-700 leading-relaxed">{block.content}</p>
                    )}
                    {block.type === "table" && (
                      <div className="overflow-auto rounded border">
                        <pre className="p-3 text-xs text-gray-600 whitespace-pre-wrap">
                          {block.content}
                        </pre>
                      </div>
                    )}
                    {block.type === "list" && (
                      <li className="text-sm text-gray-700 ml-4">{block.content}</li>
                    )}
                    {block.type === "footnote" && (
                      <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-3">
                        {block.content}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {version.sections.length === 0 && version.status === "parsed" && (
        <div className="rounded-lg border bg-white p-8 text-center shadow-sm">
          <FileText className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">No sections parsed from this document.</p>
        </div>
      )}
    </div>
  );
}
