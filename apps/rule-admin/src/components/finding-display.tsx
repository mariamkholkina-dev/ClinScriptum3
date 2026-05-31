"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/cn";
import { ChevronRight, AlertTriangle } from "lucide-react";

/* ──────────────────── Constants ──────────────────── */

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
  info: "INFO",
};

export const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-400 text-yellow-900",
  low: "bg-blue-100 text-blue-700",
  info: "bg-gray-100 text-gray-600",
};

export const SEVERITY_BORDER: Record<string, string> = {
  critical: "border-l-red-600",
  high: "border-l-orange-500",
  medium: "border-l-yellow-400",
  low: "border-l-blue-400",
  info: "border-l-gray-300",
};

/** Значения серьёзности, которые можно выставить при валидации находки.
 *  Единый источник для фильтров и кнопок смены severity на обоих экранах. */
export const SEVERITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "info", label: "Info" },
] as const;

export const STATUS_LABELS: Record<string, string> = {
  pending: "К валидации",
  false_positive: "Ложное срабатывание",
  resolved: "Исправлено",
  rejected: "Игнорировать",
  confirmed: "Подтверждено",
};

export const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  false_positive: "bg-purple-100 text-purple-700",
  resolved: "bg-green-100 text-green-700",
  rejected: "bg-gray-100 text-gray-500",
  confirmed: "bg-blue-100 text-blue-700",
};

/** Все возможные статусы валидации в каноническом порядке — для фильтров,
 *  которые должны показывать все значения, даже если их нет в находках. */
export const STATUS_ORDER = [
  "pending",
  "confirmed",
  "resolved",
  "rejected",
  "false_positive",
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  consistency: "Согласованность",
  logic: "Логика",
  terminology: "Терминология",
  compliance: "Соответствие",
  grammar: "Редакторское",
};

export const TYPE_LABELS: Record<string, string> = {
  editorial: "Редакторская",
  semantic: "Семантическая",
  intra_audit: "Внутренний аудит",
  inter_audit: "Межд. аудит",
};

export const TASK_KIND_LABELS: Record<string, string> = {
  self_check: "Внутренняя проверка",
  cross_check: "Перекрёстная проверка",
  self_editorial: "Редакторская проверка",
};

export const CONFIDENCE_LABELS: Record<string, { label: string; cls: string }> = {
  High: { label: "Высокая", cls: "text-green-700" },
  Medium: { label: "Средняя", cls: "text-amber-600" },
  Low: { label: "Низкая", cls: "text-red-500" },
};

export const QA_VERDICT_LABELS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "Подтверждено QA", cls: "bg-green-100 text-green-800" },
  dismissed: { label: "Отклонено QA", cls: "bg-red-100 text-red-700" },
  adjusted: { label: "Скорректировано QA", cls: "bg-amber-100 text-amber-800" },
  deduplicated: { label: "Дубликат", cls: "bg-gray-200 text-gray-600" },
};

export const ZONE_LABELS: Record<string, string> = {
  synopsis: "Синопсис",
  study_design: "Дизайн исследования",
  study_objectives: "Цели исследования",
  study_population: "Популяция",
  treatments: "Лечение / ИП",
  efficacy_assessments: "Оценка эффективности",
  safety_assessments: "Оценка безопасности",
  statistics: "Статистика",
  visit_schedule: "График процедур (SoA)",
  ethics: "Этика",
  appendices: "Приложения",
  __unclassified__: "Без классификации",
};

export function getZoneLabel(zone: string): string {
  return ZONE_LABELS[zone] ?? zone;
}

export const METHOD_LABELS: Record<string, string> = {
  deterministic: "Детерм.",
  llm: "LLM",
};

export const ISSUE_FAMILY_LABELS: Record<string, string> = {
  PLACEHOLDER: "Плейсхолдер",
  NUMERIC: "Числовое",
  MISSINGNESS: "Пропуск",
  RANGE_CONSISTENCY: "Диапазон",
  EDITORIAL: "Редакторское",
  TIMING_SCHEDULE: "Расписание",
  IP_DOSING: "Дозирование",
  POPULATION_ELIGIBILITY: "Популяция",
  ENDPOINTS_ANALYSIS: "Конечные точки",
  SAFETY_REPORTING: "Безопасность",
  RANDOMIZATION: "Рандомизация",
  BLINDING_UNBLINDING: "Ослепление",
  CROSSREF: "Перекр. ссылка",
  DUPLICATION_CONFLICT: "Дублирование",
  TEXT_CONTRADICTION: "Противоречие",
};

function parseJsonDescription(desc: string): Record<string, unknown> | null {
  if (!desc || !desc.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(desc);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
  } catch { /* not JSON */ }
  return null;
}

/* ──────────────────── Finding meta extraction ──────────────────── */

/** Извлекает нормализованные атрибуты находки из разрозненных источников
 *  (колонки, extraAttributes, sourceRef, JSON в description). Серьёзность
 *  для intra-audit находок лежит в extraAttributes.severity (колонка
 *  Finding.severity не заполняется), поэтому читаем её ОТТУДА в первую
 *  очередь — это «эффективная» severity, единая для всех экранов. */
export function extractFindingMeta(finding: any) {
  const extra = (finding.extraAttributes ?? {}) as Record<string, unknown>;
  const ref = (finding.sourceRef ?? {}) as Record<string, unknown>;
  const jsonDesc = parseJsonDescription(finding.description ?? "");

  const description = jsonDesc
    ? (jsonDesc.description as string) ?? finding.description
    : finding.description;

  return {
    description,
    severity: (extra.severity as string) ?? (jsonDesc?.severity as string) ?? (finding.severity as string) ?? "info",
    issueType: (extra.issueType as string) ?? (jsonDesc?.issue_type as string) ?? (finding.issueType as string) ?? null,
    issueFamily: (extra.issueFamily as string) ?? (finding.issueFamily as string) ?? null,
    auditCategory: (extra.auditCategory as string) ?? (finding.auditCategory as string) ?? null,
    taskKind: (extra.taskKind as string) ?? (ref.taskKind as string) ?? (jsonDesc?.mode as string) ?? null,
    method: (extra.method as string) ?? null,
    confidence: (extra.confidence as string) ?? (jsonDesc?.confidence as string) ?? undefined,
    contextStatus: (extra.contextStatus as string) ?? (jsonDesc?.context_status as string) ?? undefined,
    qaVerdict: extra.qaVerdict as string | undefined,
    qaReason: extra.qaReason as string | undefined,
    editorialFix: (extra.editorialFix as string) ?? (jsonDesc?.editorial_fix_suggestion as string) ?? undefined,
    block: (extra.block as string) ?? (jsonDesc?.block as string) ?? undefined,
    field: (extra.field as string) ?? (jsonDesc?.field as string) ?? undefined,
    suggestion: (finding.suggestion as string) ?? (jsonDesc?.recommendation as string) ?? (jsonDesc?.suggestion as string) ?? null,
    textSnippet: (ref.textSnippet as string) ?? (jsonDesc?.target_quote as string) ?? (jsonDesc?.source as string) ?? undefined,
    referenceQuote: (ref.referenceQuote as string) ?? (jsonDesc?.reference_quote as string) ?? undefined,
    anchorQuote: ref.anchorQuote as string | undefined,
    targetQuote: ref.targetQuote as string | undefined,
    sectionTitle: ref.sectionTitle as string | undefined,
    zone: (ref.zone as string) ?? (finding.targetZone as string) ?? null,
    anchorZone: (ref.anchorZone as string) ?? (finding.anchorZone as string) ?? null,
    type: finding.type as string,
  };
}

export type FindingMeta = ReturnType<typeof extractFindingMeta>;

/** Эффективная серьёзность находки (extraAttributes.severity → колонка → info). */
export function effectiveSeverity(finding: any): string {
  return extractFindingMeta(finding).severity;
}

/* ──────────────────── Quote helpers (matching + highlight) ──────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Цитата от LLM может содержать «…»/«...», помечающие пропущенный текст.
 *  Бьём на непрерывные фрагменты — каждый ищется/подсвечивается отдельно,
 *  иначе полная цитата никогда не совпадёт с непрерывным текстом раздела. */
function splitQuoteFragments(quote: string): string[] {
  return quote
    .split(/\s*(?:\.{3,}|…)\s*/g)
    .map((f) => f.trim())
    .filter((f) => f.length >= 6);
}

/** Раздел «тестируется» находкой, если его контент реально содержит фрагмент
 *  одной из цитат. Возвращаем только такие разделы — не всю зону. */
export function selectTestedSections(
  meta: FindingMeta,
  sections: { id: string; title: string; standardSection: string | null; content: string }[],
): typeof sections {
  // Зоны находки. zone/anchorZone — это rootZone (первый компонент
  // standardSection, напр. "5"; см. buildZoneTexts). Кандидатов ОГРАНИЧИВАЕМ
  // зонами находки — иначе совпадение цитаты вытаскивало разделы из чужих зон
  // (один и тот же фрагмент встречается в нескольких разделах документа).
  const zones = [meta.anchorZone, meta.zone].filter(
    (z): z is string => typeof z === "string" && z.length > 0,
  );
  const inZone = (s: { standardSection: string | null }) => {
    if (zones.length === 0) return true; // нет инфо о зоне — не ограничиваем
    const root = (s.standardSection ?? "").split(".")[0];
    return zones.some(
      (z) => root === z || s.standardSection === z || (s.standardSection ?? "").startsWith(z + "."),
    );
  };
  const candidates = sections.filter(inZone);

  const quotes = [meta.textSnippet, meta.referenceQuote, meta.anchorQuote, meta.targetQuote]
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0);

  // Зонды по фрагментам цитат (нормализованные, достаточно длинные).
  const probes = quotes
    .flatMap(splitQuoteFragments)
    .map((f) => norm(f).slice(0, 60))
    .filter((p) => p.length >= 12);

  // Внутри зон(ы) сужаем по цитате.
  if (probes.length > 0) {
    const byQuote = candidates.filter((s) => {
      const c = norm(s.content);
      return probes.some((p) => c.includes(p));
    });
    if (byQuote.length > 0) return byQuote;
  }

  // Затем по названию раздела (тоже внутри зон).
  if (meta.sectionTitle) {
    const t = norm(meta.sectionTitle);
    const byTitle = candidates.filter((s) => norm(s.title).includes(t) || t.includes(norm(s.title)));
    if (byTitle.length > 0) return byTitle;
  }

  // Узкого совпадения нет: если зоны заданы — показываем разделы этих зон;
  // если зон нет — ничего (нет ориентира, чужие зоны показывать нельзя).
  return zones.length > 0 ? candidates : [];
}

/** Строит regex'ы, подсвечивающие ПОЛНЫЕ фрагменты цитаты (а не первые 80
 *  символов). Пробелы делаем гибкими (\s+), чтобы переносы строк и двойные
 *  пробелы в тексте раздела не ломали совпадение. */
function buildHighlightRegexes(quotes: string[]): RegExp[] {
  const regexes: RegExp[] = [];
  for (const quote of quotes) {
    for (const fragment of splitQuoteFragments(quote)) {
      const escaped = fragment
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+");
      try {
        regexes.push(new RegExp(`(${escaped})`, "gi"));
      } catch { /* ignore bad regex */ }
    }
  }
  return regexes;
}

/* ──────────────────── Finding badges (list card) ──────────────────── */

/** Бэйджи находки: severity, метод, направление, семейство, QA-вердикт и
 *  (опционально) статус валидации. Общий ряд для карточек на обоих экранах. */
export function FindingBadges({ finding, showStatus = false }: { finding: any; showStatus?: boolean }) {
  const m = extractFindingMeta(finding);
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase shrink-0", SEVERITY_STYLES[m.severity])}>
        {SEVERITY_LABELS[m.severity] ?? m.severity}
      </span>
      {m.method && (
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0",
          m.method === "deterministic" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
        )}>
          {METHOD_LABELS[m.method] ?? m.method}
        </span>
      )}
      {m.taskKind && (
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
          Направление: {TASK_KIND_LABELS[m.taskKind] ?? m.taskKind}
        </span>
      )}
      {m.issueFamily && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 shrink-0">
          {ISSUE_FAMILY_LABELS[m.issueFamily] ?? m.issueFamily}
        </span>
      )}
      {m.qaVerdict && QA_VERDICT_LABELS[m.qaVerdict] && (
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", QA_VERDICT_LABELS[m.qaVerdict].cls)}>
          {QA_VERDICT_LABELS[m.qaVerdict].label}
        </span>
      )}
      {showStatus && (
        <span className={cn("ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0", STATUS_STYLES[finding.status] ?? "bg-gray-100 text-gray-500")}>
          {STATUS_LABELS[finding.status] ?? finding.status}
        </span>
      )}
    </div>
  );
}

/** Содержимое карточки находки под бэйджами: описание, рекомендация, зоны,
 *  превью цитаты. Общее для списков на обоих экранах. */
export function FindingCardBody({ finding }: { finding: any }) {
  const m = extractFindingMeta(finding);
  return (
    <>
      <p className="text-sm font-medium text-gray-900 line-clamp-3">{m.description}</p>

      {m.suggestion && (
        <p className="mt-1 text-xs text-green-700 line-clamp-2">
          <span className="font-medium">→</span> {m.suggestion}
        </p>
      )}

      {(m.zone || m.anchorZone) && (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
          {m.anchorZone && <span className="font-medium">{getZoneLabel(m.anchorZone)}</span>}
          {m.anchorZone && m.zone && <span>→</span>}
          {m.zone && <span className="font-medium">{getZoneLabel(m.zone)}</span>}
        </div>
      )}

      {m.textSnippet && (
        <p className="mt-1 text-[11px] text-gray-400 italic line-clamp-1">
          «{m.textSnippet}»
        </p>
      )}
    </>
  );
}

/* ──────────────────── Finding detail body (right panel) ──────────────────── */

/** Богатая детализация находки: бэйджи, тип/семейство/категория, описание,
 *  рекомендация, правка, зоны, цитаты, QA-вердикт, контекст, мета и разделы.
 *  Без действий пользователя/ревьюера — их добавляет конкретный экран. */
export function FindingDetailBody({
  finding,
  sections,
}: {
  finding: any;
  sections: { id: string; title: string; standardSection: string | null; content: string }[];
}) {
  const m = extractFindingMeta(finding);

  return (
    <div className="space-y-5">
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("rounded px-2 py-0.5 text-xs font-bold uppercase", SEVERITY_STYLES[m.severity])}>
          {SEVERITY_LABELS[m.severity] ?? m.severity}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLES[finding.status] ?? "bg-gray-100 text-gray-500")}>
          {STATUS_LABELS[finding.status] ?? finding.status}
        </span>
        {m.method && (
          <span className={cn("rounded px-2 py-0.5 text-xs font-medium",
            m.method === "deterministic" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
          )}>
            {m.method === "deterministic" ? "Детерминированный" : m.method === "llm" ? "LLM" : m.method}
          </span>
        )}
        {m.type && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            Тип: {TYPE_LABELS[m.type] ?? m.type}
          </span>
        )}
        {m.taskKind && (
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            Направление: {TASK_KIND_LABELS[m.taskKind] ?? m.taskKind}
          </span>
        )}
        {m.confidence && CONFIDENCE_LABELS[m.confidence] && (
          <span className={cn("text-xs font-medium", CONFIDENCE_LABELS[m.confidence].cls)}>
            Уверенность: {CONFIDENCE_LABELS[m.confidence].label}
          </span>
        )}
      </div>

      {/* Issue type + family + category */}
      {(m.issueType || m.issueFamily || m.auditCategory) && (
        <div className="flex items-center gap-2 flex-wrap">
          {m.issueType && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-violet-50 border border-violet-200 px-2.5 py-1">
              <span className="text-xs text-violet-500">Тип:</span>
              <span className="text-xs font-semibold text-violet-800">{m.issueType}</span>
            </div>
          )}
          {m.issueFamily && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1">
              <span className="text-xs text-amber-500">Семейство:</span>
              <span className="text-xs font-semibold text-amber-800">{ISSUE_FAMILY_LABELS[m.issueFamily] ?? m.issueFamily}</span>
            </div>
          )}
          {m.auditCategory && (
            <div className="inline-flex items-center gap-1.5 rounded-md bg-cyan-50 border border-cyan-200 px-2.5 py-1">
              <span className="text-xs text-cyan-500">Категория:</span>
              <span className="text-xs font-semibold text-cyan-800">{CATEGORY_LABELS[m.auditCategory] ?? m.auditCategory}</span>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 leading-snug">{m.description}</h2>
      </div>

      {/* Suggestion */}
      {m.suggestion && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-green-600 mb-1">Рекомендация</div>
          <p className="text-sm text-green-800">{m.suggestion}</p>
        </div>
      )}

      {/* Editorial fix */}
      {m.editorialFix && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 mb-1">Предлагаемая правка</div>
          <p className="text-sm text-blue-800 font-mono">{m.editorialFix}</p>
        </div>
      )}

      {/* Zones */}
      {(m.zone || m.anchorZone) && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400 text-xs">Зоны:</span>
          {m.anchorZone && (
            <span className="rounded bg-brand-50 border border-brand-200 px-2 py-0.5 text-xs font-medium text-brand-800">
              {getZoneLabel(m.anchorZone)}
            </span>
          )}
          {m.anchorZone && m.zone && <span className="text-gray-400">→</span>}
          {m.zone && (
            <span className="rounded bg-orange-50 border border-orange-200 px-2 py-0.5 text-xs font-medium text-orange-800">
              {getZoneLabel(m.zone)}
            </span>
          )}
        </div>
      )}

      {/* Quotes */}
      {(m.textSnippet || m.referenceQuote || m.anchorQuote || m.targetQuote) && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Цитаты из документа</div>
          {m.textSnippet && (
            <blockquote className="border-l-4 border-gray-300 bg-gray-50 pl-4 py-2 text-sm text-gray-700 italic">
              {m.sectionTitle && <span className="not-italic text-[10px] text-gray-400 block mb-0.5">{m.sectionTitle}</span>}
              {m.textSnippet}
            </blockquote>
          )}
          {m.referenceQuote && (
            <blockquote className="border-l-4 border-blue-300 bg-blue-50 pl-4 py-2 text-sm text-blue-800 italic">
              <span className="not-italic text-[10px] text-blue-400 block mb-0.5">Референсная цитата</span>
              {m.referenceQuote}
            </blockquote>
          )}
          {m.anchorQuote && (
            <blockquote className="border-l-4 border-brand-300 bg-brand-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="not-italic text-[10px] text-brand-400 block mb-0.5">Якорная зона</span>
              {m.anchorQuote}
            </blockquote>
          )}
          {m.targetQuote && (
            <blockquote className="border-l-4 border-orange-300 bg-orange-50 pl-4 py-2 text-sm text-gray-700 italic">
              <span className="not-italic text-[10px] text-orange-400 block mb-0.5">Проверяемая зона</span>
              {m.targetQuote}
            </blockquote>
          )}
        </div>
      )}

      {/* QA Verdict */}
      {m.qaVerdict && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">QA верификация</div>
          <div className="flex items-center gap-2 mb-1">
            {QA_VERDICT_LABELS[m.qaVerdict] && (
              <span className={cn("rounded px-2 py-0.5 text-xs font-medium", QA_VERDICT_LABELS[m.qaVerdict].cls)}>
                {QA_VERDICT_LABELS[m.qaVerdict].label}
              </span>
            )}
          </div>
          {m.qaReason && <p className="text-sm text-gray-700">{m.qaReason}</p>}
        </div>
      )}

      {/* Context status warning */}
      {m.contextStatus && m.contextStatus !== "ok" && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">Недостаточный контекст — результат может быть неточным</p>
        </div>
      )}

      {/* Meta info */}
      {(m.block || m.field) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
          {m.block && <span>Блок: <span className="text-gray-600">{m.block}</span></span>}
          {m.field && <span>Поле: <span className="text-gray-600">{m.field}</span></span>}
        </div>
      )}

      {/* Tested document sections */}
      {sections.length > 0 && (
        <div className="space-y-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Проверяемые разделы</div>
          {sections.map((section) => (
            <SectionPanel
              key={section.id}
              section={section}
              highlightQuotes={[m.textSnippet, m.referenceQuote, m.anchorQuote, m.targetQuote].filter((x): x is string => !!x)}
            />
          ))}
        </div>
      )}

      {sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-400">
            Проверяемые разделы для этой находки не определены
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────── Section Panel ──────────────────── */

/** Лёгкая санитизация HTML раздела (контент — собственный документ тенанта,
 *  admin-UI): вырезаем script/style/iframe и обработчики событий. */
function sanitizeSectionHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
}

/** Подсвечивает фрагменты цитат прямо в HTML раздела, НЕ ломая разметку:
 *  обрабатываем только текстовые узлы (между тегами), совпадения оборачиваем
 *  в <mark>. Теги и атрибуты не трогаем. Цитата, разорванная тегом (ячейки
 *  таблицы, переносы), может не подсветиться — это допустимый компромисс. */
function highlightHtml(html: string, quotes: string[]): string {
  const regexes = buildHighlightRegexes(quotes);
  if (regexes.length === 0) return html;
  return html
    .split(/(<[^>]+>)/)
    .map((token) => {
      if (token.startsWith("<")) return token; // тег — оставляем как есть
      let t = token;
      // Маркеры-плейсхолдеры (как в text-режиме), чтобы regex не цеплялся
      // за уже вставленные <mark>; финальную разметку собираем в конце.
      for (const re of regexes) t = t.replace(re, "%%HL_START%%$1%%HL_END%%");
      return t.replace(/%%HL_START%%/g, "<mark>").replace(/%%HL_END%%/g, "</mark>");
    })
    .join("");
}

// Классы для HTML-раздела: видимые таблицы, абзацы, списки + подсветка цитат (<mark>).
const HTML_CONTENT_CLASSES =
  "px-4 pb-4 text-sm text-gray-700 leading-relaxed max-h-96 overflow-auto " +
  "[&_table]:border-collapse [&_table]:my-2 [&_table]:w-full " +
  "[&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top " +
  "[&_th]:border [&_th]:border-gray-300 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50 [&_th]:text-left " +
  "[&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_mark]:bg-yellow-200 [&_mark]:text-inherit [&_mark]:underline [&_mark]:decoration-red-500 [&_mark]:decoration-2 [&_mark]:underline-offset-2";

export function SectionPanel({
  section,
  highlightQuotes,
}: {
  section: { title: string; standardSection: string | null; content: string; contentHtml?: string | null };
  highlightQuotes: string[];
}) {
  const [expanded, setExpanded] = useState(true);

  const highlightText = useCallback(
    (text: string) => {
      const regexes = buildHighlightRegexes(highlightQuotes);
      if (regexes.length === 0) return text;
      let result = text;
      for (const re of regexes) {
        result = result.replace(re, "%%HL_START%%$1%%HL_END%%");
      }
      return result;
    },
    [highlightQuotes],
  );

  const rendered = highlightText(section.content);
  const parts = rendered.split(/(%%HL_START%%|%%HL_END%%)/);
  let inHighlight = false;

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50"
      >
        <div>
          <span className="text-sm font-semibold text-gray-900">
            Раздел «{section.title}»
          </span>
          {section.standardSection && (
            <span className="ml-2 text-xs text-gray-400">[{section.standardSection}]</span>
          )}
        </div>
        <ChevronRight className={cn("h-4 w-4 text-gray-400 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        // HTML-режим: видны таблицы/переносы строк (контент из rawHtml). Цитаты
        // подсвечиваем в текстовых узлах (highlightHtml) — разметку не ломаем.
        section.contentHtml ? (
          <div
            className={HTML_CONTENT_CLASSES}
            dangerouslySetInnerHTML={{
              __html: highlightHtml(sanitizeSectionHtml(section.contentHtml), highlightQuotes),
            }}
          />
        ) : (
          <div className="px-4 pb-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
            {parts.map((part, idx) => {
              if (part === "%%HL_START%%") {
                inHighlight = true;
                return null;
              }
              if (part === "%%HL_END%%") {
                inHighlight = false;
                return null;
              }
              if (inHighlight) {
                return (
                  <span key={idx} className="bg-yellow-200 underline decoration-red-500 decoration-2 underline-offset-2">
                    {part}
                  </span>
                );
              }
              return <span key={idx}>{part}</span>;
            })}
          </div>
        )
      )}
    </div>
  );
}
