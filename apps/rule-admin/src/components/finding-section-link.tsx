"use client";

/**
 * Компактный inline chip с section_id из intra-audit находки.
 *
 * Минимальная версия: показывает строку section_id в моноширинном шрифте
 * (например "S2.1:objectives") c `select-all` CSS, чтобы было удобно
 * скопировать. Tooltip объясняет назначение.
 *
 * TODO: после добавления docVersionId в payload — превратить в реальный
 * link на просмотр секции в parsing-viewer или встроенный preview.
 */

import { Hash } from "lucide-react";

export function FindingSectionLink({
  sectionId,
  label,
}: {
  sectionId: string;
  label?: string;
}) {
  return (
    <span
      className="inline-flex select-all items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
      title={`section_id: ${sectionId}. Двойной клик чтобы выделить и скопировать.`}
    >
      <Hash size={10} className="text-slate-400" />
      {sectionId}
      {label && <span className="ml-1 font-sans text-slate-500">— {label}</span>}
    </span>
  );
}
