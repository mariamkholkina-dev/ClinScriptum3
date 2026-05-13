"use client";

import { Loader2 } from "lucide-react";

/**
 * Sprint 2b — показывает текст исходной секции с подсветкой `anchorQuote`.
 * Помогает аннотатору быстро понять контекст finding'а без переключения
 * в Word/документ.
 */

export interface SectionForContext {
  id: string;
  title: string;
  standardSection: string | null;
  content: string;
}

interface Props {
  sections: SectionForContext[] | undefined;
  isLoading: boolean;
  anchorZone: string | null;
  anchorQuote: string | null;
  targetZone?: string | null;
  targetQuote?: string | null;
}

/** Простой fuzzy-match: ищет section с standardSection == anchorZone (case-insensitive).
 *  Если не найдена, fallback на section, title которой содержит подстроку. */
export function findRelevantSection(
  sections: SectionForContext[],
  zone: string | null,
): SectionForContext | null {
  if (!zone) return null;
  const z = zone.trim().toUpperCase();
  // 1. exact match on standardSection
  for (const s of sections) {
    if (s.standardSection && s.standardSection.trim().toUpperCase() === z) return s;
  }
  // 2. title contains zone keyword
  for (const s of sections) {
    if (s.title.toUpperCase().includes(z)) return s;
  }
  return null;
}

/** Подсвечивает все вхождения `quote` в `text`. Регистр-независимо.
 *  Возвращает массив React-нод. */
function highlight(text: string, quote: string | null | undefined): React.ReactNode[] {
  if (!quote || !quote.trim()) return [text];
  const needle = quote.trim();
  // Простое case-insensitive поиск с сохранением original casing для нod'ов.
  const haystack = text;
  const lcText = haystack.toLowerCase();
  const lcNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match = lcText.indexOf(lcNeedle, cursor);
  let key = 0;
  while (match >= 0) {
    if (match > cursor) parts.push(haystack.slice(cursor, match));
    parts.push(
      <mark key={`m-${key++}`} className="bg-yellow-200 px-0.5">
        {haystack.slice(match, match + needle.length)}
      </mark>,
    );
    cursor = match + needle.length;
    match = lcText.indexOf(lcNeedle, cursor);
  }
  if (cursor < haystack.length) parts.push(haystack.slice(cursor));
  return parts;
}

export function SectionContextPanel({
  sections,
  isLoading,
  anchorZone,
  anchorQuote,
  targetZone,
  targetQuote,
}: Props) {
  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-500">
        <Loader2 size={12} className="animate-spin" /> загрузка секции…
      </div>
    );
  }
  if (!sections || sections.length === 0) {
    return (
      <p className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-400 italic">
        Секции не загружены — документ ещё не парсился?
      </p>
    );
  }

  const anchorSection = findRelevantSection(sections, anchorZone);
  const targetSection = targetZone ? findRelevantSection(sections, targetZone) : null;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
      <ContextBlock
        label="Anchor"
        zone={anchorZone}
        section={anchorSection}
        quote={anchorQuote}
      />
      {targetZone && (
        <ContextBlock
          label="Target"
          zone={targetZone}
          section={targetSection}
          quote={targetQuote ?? null}
        />
      )}
    </div>
  );
}

function ContextBlock({
  label,
  zone,
  section,
  quote,
}: {
  label: string;
  zone: string | null;
  section: SectionForContext | null;
  quote: string | null;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
          {label}
        </span>
        <span className="text-[10px] text-gray-500">
          zone: <span className="font-mono">{zone ?? "—"}</span>
        </span>
        {section && (
          <span className="text-[10px] text-gray-500">
            · секция: <span className="italic">{section.title}</span>
          </span>
        )}
      </div>
      {section ? (
        <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-[11px] leading-relaxed text-gray-800">
          {highlight(section.content, quote)}
        </div>
      ) : (
        <p className="rounded border border-gray-200 bg-white p-2 text-[11px] italic text-gray-400">
          Секция для zone={zone ?? "—"} не найдена. Возможно, parsing/classification ещё не
          определил этот стандартный раздел.
        </p>
      )}
    </div>
  );
}
