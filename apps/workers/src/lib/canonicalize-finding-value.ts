/**
 * Канонизация reference_value / target_value из intra-audit находок.
 *
 * LLM возвращает значения "как в цитате" — без нормализации единиц,
 * регистра, пробелов. Эта обёртка приводит их к каноническому виду:
 *   - "60 мг/кг" === "60 mg/kg" === "60mg/kg"
 *   - "12 weeks" === "12 нед." === "12 wks"
 *   - "240" === "240 участников" === "N=240"
 *   - "Full Analysis Set" === "full analysis set"
 *
 * Используется backend-ом после parseLLMFindings для:
 *   1. Сохранения в Finding.extraAttributes (rendering side-by-side в UI);
 *   2. Расчёта dedupKey (объединение дубликатов одной причины);
 *   3. Cascade matching с golden corpus в intra-audit-match.ts.
 */

import { canonicalize as canonicalizeFact } from "@clinscriptum/rules-engine";

/**
 * Маппинг intra-audit issue_type → factKey из rules-engine.
 * Только для issue_types, где у нас есть подходящий canonicaliser.
 *
 * Для остальных типов используется fallback: textCanonical (lowercase + trim + collapse spaces).
 */
const ISSUE_TYPE_TO_FACT_KEY: Record<string, string> = {
  // Sample size — простое число
  sample_size_mismatch: "sample_size",
  sample_size_count_mismatch: "sample_size",
  enrollment_target_mismatch: "sample_size",
  visit_count_mismatch: "sample_size",
  calculation_error_sum: "sample_size",

  // Study duration / time windows / timelines — число + unit времени
  duration_mismatch: "study_duration",
  dosing_duration_mismatch: "study_duration",
  washout_duration_mismatch: "study_duration",
  sae_reporting_timeline_conflict: "study_duration",
  storage_time_mismatch: "study_duration",
  contradiction_time_window: "study_duration",
  contradiction_timepoint: "study_duration",
  soa_visit_window_mismatch: "study_duration",
  soa_timepoint_mismatch: "study_duration",
  endpoint_timeframe_conflict: "study_duration",
  endpoint_timepoint_mismatch: "study_duration",
  pk_sampling_duration_mismatch: "study_duration",
  stability_shelf_life_conflict: "study_duration",

  // Phase
  be_design_mismatch: "study_phase",
};

// \b в JS не работает с кириллицей. Используем lookbehind/lookahead на букву через \p{L}.
const BL = "(?<![\\p{L}])"; // before-letter — нет буквы слева
const AR = "(?![\\p{L}])"; // after-letter — нет буквы справа

const DOSE_UNIT_NORMALIZATIONS: Array<[RegExp, string]> = [
  // Составные единицы — должны идти ДО одиночных
  [new RegExp(`${BL}мкг\\s*\\/\\s*кг${AR}`, "gu"), "mcg/kg"],
  [new RegExp(`${BL}мг\\s*\\/\\s*кг${AR}`, "gu"), "mg/kg"],
  [new RegExp(`${BL}мг\\s*\\/\\s*мл${AR}`, "gu"), "mg/ml"],
  // Одиночные кириллические единицы
  [new RegExp(`${BL}мкг${AR}`, "gu"), "mcg"],
  [new RegExp(`${BL}мг${AR}`, "gu"), "mg"],
  [new RegExp(`${BL}кг${AR}`, "gu"), "kg"],
  [new RegExp(`${BL}мл${AR}`, "gu"), "ml"],
  // microgram synonyms
  [/µg/gu, "mcg"],
  [new RegExp(`${BL}ug${AR}`, "gu"), "mcg"],
];

const DOSE_ISSUE_TYPES = new Set([
  "dose_mismatch",
  "strength_mismatch",
  "concentration_mismatch",
  "frequency_mismatch",
  "magnitude_error",
  "unit_mismatch",
  "unit_conversion_error",
]);

function textCanonical(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»"„""]/g, '"');
}

function canonicalDose(raw: string): string {
  let v = raw.trim().toLowerCase().replace(/\s+/g, " ");
  for (const [pattern, replacement] of DOSE_UNIT_NORMALIZATIONS) {
    v = v.replace(pattern, replacement);
  }
  // Убрать пробел между числом и единицей: "60 mg/kg" → "60mg/kg"
  v = v.replace(/(\d+(?:[.,]\d+)?)\s+(mg|mcg|kg|g|ml|l|mg\/kg)/g, "$1$2");
  // Запятая→точка в десятичных
  v = v.replace(/(\d),(\d)/g, "$1.$2");
  return v;
}

/**
 * Канонизирует одно значение из intra-audit находки.
 *
 * @param issueType — issue_type из находки (определяет тип канонизации)
 * @param raw — значение, как его вернул LLM
 * @returns canonical string или null если raw=null/empty
 */
export function canonicalizeIntraAuditValue(
  issueType: string,
  raw: string | null | undefined,
): string | null {
  if (!raw || !raw.trim()) return null;

  // Dose-like — собственная канонизация (rules-engine не покрывает мг/кг)
  if (DOSE_ISSUE_TYPES.has(issueType)) {
    return canonicalDose(raw);
  }

  const factKey = ISSUE_TYPE_TO_FACT_KEY[issueType];
  if (factKey) {
    const result = canonicalizeFact(factKey, raw);
    return result.canonical || textCanonical(raw);
  }

  // Generic fallback — lowercase + trim + collapse whitespace
  return textCanonical(raw);
}

/**
 * Детерминистический ключ для dedup: одинаковая причина (одна и та же пара
 * canonical-значений на одной и той же паре section_id) → одинаковый ключ.
 *
 * Не используется в текущем dedup (тот по quote-overlap) — нужен для E4
 * (intra-audit-dedup), который будет полагаться на этот ключ.
 */
export function buildDedupKey(args: {
  issueType: string;
  referenceSectionId?: string | null;
  targetSectionId?: string | null;
  referenceCanonical?: string | null;
  targetCanonical?: string | null;
}): string | null {
  const { issueType, referenceSectionId, targetSectionId, referenceCanonical, targetCanonical } = args;
  // Если нет ни canonical, ни section_id — ключ бессмыслен, fallback к quote-overlap
  if (!referenceCanonical && !targetCanonical) return null;
  const parts = [
    issueType,
    referenceSectionId ?? "?",
    targetSectionId ?? "?",
    referenceCanonical ?? "?",
    targetCanonical ?? "?",
  ];
  return parts.join("|");
}

/**
 * Обогащение одной находки canonical-значениями и dedupKey.
 * Удобно вызывать перед prisma.finding.create.
 */
export interface CanonicalEnrichmentInput {
  issueType?: string;
  referenceSectionId?: string;
  targetSectionId?: string;
  referenceValue?: string;
  targetValue?: string;
}

export interface CanonicalEnrichmentOutput {
  referenceValueCanonical: string | null;
  targetValueCanonical: string | null;
  dedupKey: string | null;
}

export function enrichFindingWithCanonical(
  input: CanonicalEnrichmentInput,
): CanonicalEnrichmentOutput {
  const issueType = input.issueType ?? "unknown_issue_type";
  const referenceValueCanonical = canonicalizeIntraAuditValue(issueType, input.referenceValue);
  const targetValueCanonical = canonicalizeIntraAuditValue(issueType, input.targetValue);
  const dedupKey = buildDedupKey({
    issueType,
    referenceSectionId: input.referenceSectionId,
    targetSectionId: input.targetSectionId,
    referenceCanonical: referenceValueCanonical,
    targetCanonical: targetValueCanonical,
  });
  return { referenceValueCanonical, targetValueCanonical, dedupKey };
}
