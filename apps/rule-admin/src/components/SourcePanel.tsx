"use client";

import { useEffect, useRef } from "react";

export interface SourceContentBlock {
  id: string;
  type: "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";
  content: string;
  rawHtml: string | null;
  order: number;
}

export interface SourceSection {
  id: string;
  title: string;
  level: number;
  contentBlocks?: SourceContentBlock[];
}

interface Props {
  sections: SourceSection[];
  focusedSectionId: string | null;
  /** Опционально — статус загрузки, чтобы показать spinner вместо пустого списка. */
  loading?: boolean;
}

/**
 * Side panel со скроллируемым содержимым всех разделов документа. Используется
 * на /annotate и /expert-review для контекста при выборе зоны. Автоматически
 * плавно скроллит к секции с id === focusedSectionId.
 */
export function SourcePanel({ sections, focusedSectionId, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusedSectionId || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-section-id="${focusedSectionId}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    const container = containerRef.current;
    const elRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const scrollTarget = container.scrollTop + (elRect.top - containerRect.top) - 12;
    container.scrollTo({ top: scrollTarget, behavior: "smooth" });
  }, [focusedSectionId]);

  return (
    <aside className="flex w-[40rem] shrink-0 flex-col border-l border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        Исходник
      </div>
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="py-8 text-center text-sm italic text-gray-400">Загрузка…</p>
        ) : sections.length === 0 ? (
          <p className="py-8 text-center text-sm italic text-gray-400">
            Нет секций для отображения
          </p>
        ) : (
          sections.map((s) => (
            <div
              key={s.id}
              data-section-id={s.id}
              className={`mb-4 rounded-md p-2 ${
                focusedSectionId === s.id ? "ring-2 ring-brand-300 bg-brand-50/30" : ""
              }`}
            >
              <h4
                className="mb-1 font-semibold text-gray-900"
                style={{ fontSize: `${Math.max(0.75, 1 - s.level * 0.08)}rem` }}
              >
                {s.title || "(без названия)"}
              </h4>
              {(s.contentBlocks ?? []).length === 0 ? (
                <p className="text-xs italic text-gray-400">— пустой раздел —</p>
              ) : (
                (s.contentBlocks ?? []).map((b) =>
                  b.rawHtml ? (
                    <div
                      key={b.id}
                      className="prose prose-sm mb-1 max-w-none text-xs"
                      dangerouslySetInnerHTML={{ __html: b.rawHtml }}
                    />
                  ) : (
                    <p key={b.id} className="mb-1 text-xs text-gray-600">
                      {b.content}
                    </p>
                  ),
                )
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
