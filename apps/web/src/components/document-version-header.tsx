"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Унифицированная шапка экранов версии документа (внутридокументный аудит,
 * ревью находок, факты, находки и т.п.). Формат повторяет страницу документа:
 *
 *   Исследование {studyTitle}
 *   {documentTitle}
 *   Версия {versionLabel} · {stageLabel}
 *
 * Презентационный компонент — данные передаёт вызывающий экран (из getVersion
 * / getAuditFindings / getReview). Справа — опциональные statusBadge и actions.
 */
export function DocumentVersionHeader({
  studyTitle,
  documentTitle,
  versionLabel,
  studyId,
  stageLabel,
  actions,
  backHref,
  statusBadge,
}: {
  studyTitle?: string | null;
  documentTitle?: string | null;
  versionLabel?: string | null;
  studyId?: string | null;
  stageLabel?: string;
  actions?: ReactNode;
  backHref?: string;
  statusBadge?: ReactNode;
}) {
  const href = backHref ?? (studyId ? `/studies/${studyId}` : "/studies");
  return (
    <div className="flex-none border-b bg-white px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={href} className="flex-none text-gray-400 hover:text-gray-600">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            {studyTitle && (
              <p className="truncate text-sm text-gray-500">Исследование {studyTitle}</p>
            )}
            <h1 className="truncate text-xl font-bold text-gray-900">{documentTitle ?? "Документ"}</h1>
            <p className="text-sm text-gray-500">
              Версия {versionLabel ?? "—"}
              {stageLabel && (
                <>
                  {" · "}
                  <span className="font-medium text-gray-600">{stageLabel}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {(actions || statusBadge) && (
          <div className="flex flex-none items-center gap-2">
            {statusBadge}
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
