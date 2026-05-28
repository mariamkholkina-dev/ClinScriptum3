"use client";

/**
 * Compact side-by-side card для пары значений из intra-audit находки.
 *
 * Показывает извлечённые из цитат значения (reference_value / target_value)
 * с указанием секций. Заменяет длинные quote-блоки на структурированный
 * краткий вид:
 *
 *   [S1:synopsis] 12 weeks  ↔  [S2.1:objectives] 24 weeks
 *
 * Если value присутствует только для одной стороны (или вообще отсутствует) —
 * компонент возвращает null. Caller должен показать fallback (полные quotes).
 */

import { ArrowRight } from "lucide-react";

export interface FindingValuePairData {
  referenceSectionId?: string | null;
  targetSectionId?: string | null;
  referenceValueRaw?: string | null;
  targetValueRaw?: string | null;
  referenceValueCanonical?: string | null;
  targetValueCanonical?: string | null;
}

export function FindingValuePair({ data }: { data: FindingValuePairData }) {
  const refVal = data.referenceValueRaw?.trim();
  const tgtVal = data.targetValueRaw?.trim();

  // Минимум: оба значения должны быть. Single-side показывает caller через
  // обычный quote-блок.
  if (!refVal && !tgtVal) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-100 bg-amber-50/50 px-2 py-1.5 text-xs">
      <SidePill
        sectionId={data.referenceSectionId ?? undefined}
        value={refVal}
        canonical={data.referenceValueCanonical ?? undefined}
      />
      <ArrowRight size={12} className="text-amber-600" aria-hidden />
      <SidePill
        sectionId={data.targetSectionId ?? undefined}
        value={tgtVal}
        canonical={data.targetValueCanonical ?? undefined}
      />
    </div>
  );
}

function SidePill({
  sectionId,
  value,
  canonical,
}: {
  sectionId?: string;
  value?: string;
  canonical?: string;
}) {
  const showCanonical = canonical && value && canonical !== value.trim().toLowerCase();
  return (
    <span className="inline-flex items-center gap-1">
      {sectionId && (
        <span
          className="rounded bg-amber-200/60 px-1 py-0.5 font-mono text-[10px] text-amber-900"
          title="section_id (path:type)"
        >
          {sectionId}
        </span>
      )}
      <span className="font-medium text-gray-800">{value ?? "—"}</span>
      {showCanonical && (
        <span
          className="font-mono text-[10px] text-gray-500"
          title="Канонизированная форма значения (для дедупликации)"
        >
          ({canonical})
        </span>
      )}
    </span>
  );
}
