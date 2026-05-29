/**
 * Чистые builders промтов внутридокументного аудита (intra_audit).
 *
 * Single source of truth: эти функции вызывает И worker-handler
 * (apps/workers/.../intra-doc-audit.ts), И preview-сервис API для выгрузки
 * реальных промтов в .txt. Любое изменение формата промта здесь
 * автоматически отражается в обоих местах — выгруженный .txt идентичен
 * тому, что уходит в LLM.
 *
 * Тексты системных промтов передаются как параметры (резолвятся caller'ом
 * из активного ruleset через loadRulesForType); здесь — только логика сборки
 * (анкоры, zone-разбивка, бюджеты, выбор Variant 1/2).
 */

import type { PromptCall, AnchorableSectionInput } from "./types.js";

/* ═══════════════ Section anchor [S<path>:<type>] ═══════════════ */

export interface AnchorableSection {
  id?: string;
  title: string;
  standardSection?: string | null;
  level?: number | null;
  order?: number | null;
  headingNumber?: string | null;
}

const TYPE_SUFFIX_PATTERN = /^[a-z][a-z0-9_]*$/;

export function buildSectionAnchor(section: AnchorableSection): string {
  const path = section.headingNumber?.trim() || null;
  const typeRaw = section.standardSection?.trim() || null;
  const type = typeRaw && TYPE_SUFFIX_PATTERN.test(typeRaw) ? typeRaw : null;

  if (path) {
    return type ? `[S${path}:${type}]` : `[S${path}]`;
  }
  if (typeof section.order === "number") {
    return type ? `[S#${section.order}:${type}]` : `[S#${section.order}]`;
  }
  return "[S?]";
}

export function parseSectionAnchor(raw: string | null | undefined):
  | { path: string; type: string | null; isOrderFallback: boolean }
  | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\[|\]$/g, "");
  const withoutS = trimmed.startsWith("S") ? trimmed.slice(1) : trimmed;
  const [pathRaw, typeRaw] = withoutS.split(":", 2);
  if (!pathRaw) return null;
  const isOrderFallback = pathRaw.startsWith("#");
  const path = isOrderFallback ? pathRaw.slice(1) : pathRaw;
  if (!/^\d+(\.\d+)*$/.test(path)) return null;
  const type = typeRaw && TYPE_SUFFIX_PATTERN.test(typeRaw) ? typeRaw : null;
  return { path, type, isOrderFallback };
}

/* ═══════════════ Document / zone text ═══════════════ */

export interface ZoneText {
  zone: string;
  titles: string[];
  text: string;
}

export function buildFullDocumentText(sections: AnchorableSectionInput[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    const anchor = buildSectionAnchor({
      title: section.title,
      standardSection: section.standardSection ?? null,
      headingNumber: section.headingNumber ?? null,
      order: section.order ?? null,
    });
    parts.push(`\n## ${anchor} ${section.title}\n`);
    for (const block of section.contentBlocks) {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

export function buildZoneTexts(sections: AnchorableSectionInput[]): ZoneText[] {
  const zoneMap = new Map<string, { titles: string[]; parts: string[] }>();
  for (const s of sections) {
    const zone = s.standardSection ?? "__unclassified__";
    const rootZone = zone.split(".")[0];
    if (!zoneMap.has(rootZone)) {
      zoneMap.set(rootZone, { titles: [], parts: [] });
    }
    const entry = zoneMap.get(rootZone)!;
    entry.titles.push(s.title);
    const anchor = buildSectionAnchor({
      title: s.title,
      standardSection: s.standardSection ?? null,
      headingNumber: s.headingNumber ?? null,
      order: s.order ?? null,
    });
    entry.parts.push(`## ${anchor} ${s.title}\n${s.contentBlocks.map((b) => b.content).join("\n")}`);
  }
  return Array.from(zoneMap.entries()).map(([zone, data]) => ({
    zone,
    titles: data.titles,
    text: data.parts.join("\n\n"),
  }));
}

/* ═══════════════ Cross-check pair detection ═══════════════ */

// Пары зон для авто-cross-check (когда study.crossCheckPairs не задан вручную).
// ВАЖНО: ключи ДОЛЖНЫ совпадать с актуальной таксономией standardSection
// (см. taxonomy.yaml top-level зоны: overview, synopsis, design, ip, population,
// procedures, endpoints, safety, statistics, data_management, ethics, admin,
// appendix). Старые ключи (study_design/study_objectives/study_population/
// treatments/efficacy_assessments/safety_assessments/visit_schedule/appendices)
// устарели после миграции таксономии — из-за них resolveCrossCheckPairs
// отбрасывал почти все пары (выживала только synopsis↔statistics), и cross_check
// в zone-режиме фактически не работал.
export const ZONE_AFFINITY_MAP: [string, string][] = [
  // Синопсис резюмирует весь протокол — сверяется со всеми ключевыми зонами.
  ["synopsis", "overview"],
  ["synopsis", "design"],
  ["synopsis", "endpoints"],
  ["synopsis", "population"],
  ["synopsis", "ip"],
  ["synopsis", "safety"],
  ["synopsis", "statistics"],
  ["synopsis", "procedures"],
  // Цели/обзор ↔ конечные точки.
  ["overview", "endpoints"],
  // Конечные точки ↔ как измеряются (статистика, процедуры).
  ["endpoints", "statistics"],
  ["endpoints", "procedures"],
  // Дизайн ↔ процедуры / популяция / приложения.
  ["design", "procedures"],
  ["design", "population"],
  ["design", "appendix"],
  // Безопасность ↔ препарат / процедуры / популяция / этика.
  ["safety", "ip"],
  ["safety", "procedures"],
  ["safety", "population"],
  ["safety", "ethics"],
  // Популяция ↔ статистика (размер выборки).
  ["population", "statistics"],
  // Исследуемый препарат ↔ процедуры (введение/график).
  ["ip", "procedures"],
  // Управление данными ↔ статистика / процедуры.
  ["data_management", "statistics"],
  ["data_management", "procedures"],
];

export function detectCrossCheckPairs(availableZones: Set<string>): [string, string][] {
  return ZONE_AFFINITY_MAP.filter(
    ([a, b]) => availableZones.has(a) && availableZones.has(b),
  );
}

export function resolveCrossCheckPairs(
  configuredPairs: [string, string][] | null | undefined,
  availableZones: Set<string>,
): [string, string][] {
  if (configuredPairs && configuredPairs.length > 0) {
    return configuredPairs.filter(
      ([a, b]) => availableZones.has(a) && availableZones.has(b),
    );
  }
  return detectCrossCheckPairs(availableZones);
}

/* ═══════════════ LLM-check call assembly ═══════════════ */

export interface IntraAuditCheckPrompts {
  /** "full_doc_self_check_prompt" — Variant 1 (полный документ, 3 вызова). */
  fullDocSelfCheck: string;
  /** "full_doc_cross_check_prompt" — Variant 1. */
  fullDocCrossCheck: string;
  /** "full_doc_editorial_prompt" — Variant 1. */
  fullDocEditorial: string;
  /** "self_check_prompt" — Variant 2 (zone-based). */
  selfCheck: string;
  /** "cross_check_prompt" — Variant 2. */
  crossCheck: string;
  /** "editorial_prompt" — Variant 2. */
  editorial: string;
}

export interface BuildIntraAuditCheckOptions {
  sections: AnchorableSectionInput[];
  prompts: IntraAuditCheckPrompts;
  /** getInputBudgetChars(llmConfig). */
  inputBudget: number;
  /** ctx.auditMode: "auto" | "single_call" | "zone_based". */
  auditMode?: string;
  /** ctx.crossCheckPairs (ручные пары) либо null/undefined для auto. */
  crossCheckPairs?: [string, string][] | null;
}

export interface IntraAuditCheckPlan {
  variant: 1 | 2;
  calls: PromptCall[];
}

const FULL_DOC_PHASES: Array<{ name: string; promptKey: keyof IntraAuditCheckPrompts; userPrefix: string }> = [
  {
    name: "full_doc_self_check",
    promptKey: "fullDocSelfCheck",
    userPrefix: "Проведи SELF-CHECK аудит следующего клинического протокола:\n\n",
  },
  {
    name: "full_doc_cross_check",
    promptKey: "fullDocCrossCheck",
    userPrefix: "Проведи CROSS-CHECK аудит следующего клинического протокола, сверяя разделы между собой:\n\n",
  },
  {
    name: "full_doc_editorial",
    promptKey: "fullDocEditorial",
    userPrefix: "Проведи EDITORIAL (редакторскую) проверку следующего клинического протокола:\n\n",
  },
];

/**
 * Воспроизводит ТОЧНО task-construction уровня llm_check intra-audit handler'а:
 * выбор Variant 1 (полный документ, 3 фокусных вызова) vs Variant 2 (zone-based),
 * нарезку по бюджету, формирование system+user каждого реального вызова.
 */
export function buildIntraAuditCheckCalls(opts: BuildIntraAuditCheckOptions): IntraAuditCheckPlan {
  const { sections, prompts, inputBudget, auditMode = "auto", crossCheckPairs } = opts;

  const fullDocText = buildFullDocumentText(sections);
  // Влезает ли полный документ + самый длинный из 3 фокусных промтов в бюджет.
  const longestFullDocPrompt = Math.max(
    prompts.fullDocSelfCheck.length,
    prompts.fullDocCrossCheck.length,
    prompts.fullDocEditorial.length,
  );
  const totalPromptSize = longestFullDocPrompt + fullDocText.length + 200;
  const fitsInContext = totalPromptSize <= inputBudget;

  const useVariant1 =
    auditMode === "single_call" ? fitsInContext :
    auditMode === "zone_based" ? false :
    fitsInContext;

  if (useVariant1) {
    /* Variant 1: полный документ, 3 фокусных вызова (self/cross/editorial) */
    return {
      variant: 1,
      calls: FULL_DOC_PHASES.map((phase) => ({
        stage: "intra_audit",
        level: "llm_check",
        label: phase.name,
        system: prompts[phase.promptKey],
        user: `${phase.userPrefix}${fullDocText}`,
        meta: { kind: phase.name, phase: phase.name },
      })),
    };
  }

  /* Variant 2: zone-based */
  const zones = buildZoneTexts(sections);
  const zoneMap = new Map(zones.map((z) => [z.zone, z]));
  const availableZones = new Set(zones.map((z) => z.zone));
  const pairs = resolveCrossCheckPairs(crossCheckPairs, availableZones);

  const longestZonePrompt = Math.max(
    prompts.selfCheck.length,
    prompts.crossCheck.length,
    prompts.editorial.length,
  );
  const contentBudget = inputBudget - longestZonePrompt - 500;
  const calls: PromptCall[] = [];

  for (const zone of zones) {
    const zoneText = zone.text.slice(0, contentBudget);
    calls.push({
      stage: "intra_audit",
      level: "llm_check",
      label: `self_check:${zone.zone}`,
      system: prompts.selfCheck,
      user: `ЗОНА: ${zone.zone} (секции: ${zone.titles.join(", ")})\n\n${zoneText}`,
      meta: { kind: "self_check", targetZone: zone.zone },
    });
    calls.push({
      stage: "intra_audit",
      level: "llm_check",
      label: `editorial:${zone.zone}`,
      system: prompts.editorial,
      user: `ЗОНА: ${zone.zone}\n\n${zoneText}`,
      meta: { kind: "self_editorial", targetZone: zone.zone },
    });
  }

  for (const [anchorKey, targetKey] of pairs) {
    const anchor = zoneMap.get(anchorKey);
    const target = zoneMap.get(targetKey);
    if (!anchor || !target) continue;
    const halfBudget = Math.floor(contentBudget / 2);
    const anchorText = anchor.text.slice(0, halfBudget);
    const targetText = target.text.slice(0, halfBudget);
    calls.push({
      stage: "intra_audit",
      level: "llm_check",
      label: `cross_check:${anchorKey}→${targetKey}`,
      system: prompts.crossCheck,
      user: `РЕФЕРЕНСНАЯ ЗОНА (${anchorKey}):\n${anchorText}\n\n---\n\nПРОВЕРЯЕМАЯ ЗОНА (${targetKey}):\n${targetText}`,
      meta: { kind: "cross_check", targetZone: targetKey, anchorZone: anchorKey },
    });
  }

  return { variant: 2, calls };
}
