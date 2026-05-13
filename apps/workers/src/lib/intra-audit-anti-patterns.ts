/**
 * Anti-pattern filter для intra-audit findings.
 *
 * Эвристический фильтр для отсева очевидных FP до записи в БД — proxy
 * prompt-tuning'у, который мы не можем сделать без размеченного датасета
 * (см. план Sprint 4b — required Sprint 3 dataset).
 *
 * Logика: если description / suggestion / referenceQuote финдинга
 * содержит «слабую» формулировку (модель неуверена, нет конкретного
 * defect-а в тексте, описание звучит как «совет»), считаем его
 * вероятным FP и **сразу маркируем** `status='false_positive'`,
 * `extraAttributes.qaVerdict='anti_pattern'` вместо записи как `pending`.
 *
 * Пороги намеренно консервативные — лучше пропустить редкий TP, чем
 * утомить writer'а ложными срабатываниями. Эти patterns подобраны
 * на основе LLM-промптов в `intra-doc-audit.ts` («ОТСУТСТВИЕ ≠ ПРОТИВОРЕЧИЕ»
 * и т.д.), а не на real датасете.
 *
 * После Sprint 3 (real datasets) эту эвристику стоит заменить на:
 *  (a) anti-FP few-shot в промпте, или
 *  (b) confidence-scoring + threshold (Sprint 7).
 */

export interface AntiPatternMatch {
  pattern: string;
  matchedText: string;
  field: "description" | "suggestion" | "referenceQuote";
}

interface CompiledPattern {
  re: RegExp;
  label: string;
}

// Cyrillic-safe word boundary: lookbehind/lookahead для буквы Unicode.
// JS `\b` работает только на ASCII; нужны Unicode lookarounds с `u` флагом.
const HEDGING_PATTERNS: CompiledPattern[] = [
  { re: /(?<!\p{L})возможно\s+(не|противоречие|конфликт|расхождение)/iu, label: "hedging:возможно" },
  { re: /(?<!\p{L})мож(ет\s+быть|но\s+предположить)/iu, label: "hedging:может быть" },
  { re: /(?<!\p{L})предположительно(?!\p{L})/iu, label: "hedging:предположительно" },
  { re: /(?<!\p{L})ве?роятно,?\s+(не|конфликт|противоречие)/iu, label: "hedging:вероятно" },
  { re: /(?<!\p{L})кажется,?\s+(не|есть)/iu, label: "hedging:кажется" },
  { re: /(?<!\p{L})возможн[оы]\s+(не\s+)?(стоит|следует|нужно)/iu, label: "hedging:возможно стоит" },
];

const SUGGESTION_LIKE: CompiledPattern[] = [
  { re: /(?<!\p{L})(стоит|следует|нужно|необходимо|рекомендуется)\s+(добавить|уточнить|проверить|изменить|переформулировать)/iu, label: "suggestion-like" },
  { re: /(?<!\p{L})хорошо\s+бы(?!\p{L})/iu, label: "suggestion-like:хорошо бы" },
  { re: /(?<!\p{L})было\s+бы\s+(лучше|хорошо|правильнее)/iu, label: "suggestion-like:было бы" },
];

const MISSINGNESS_WITHOUT_VALUE: CompiledPattern[] = [
  { re: /(?<!\p{L})не\s+(указан[оаы]?|упомянут[оаы]?|представлен[оаы]?)(?!\p{L})/iu, label: "missingness-no-value" },
  { re: /(?<!\p{L})отсутству(ет|ют|ющ)/iu, label: "missingness-absent" },
];

const META_TALK: CompiledPattern[] = [
  { re: /(?<!\p{L})в\s+(тексте|документе|секции)\s+(не\s+ясно|неясно)(?!\p{L})/iu, label: "meta:неясно" },
  { re: /(?<!\p{L})(трудно|сложно)\s+определить(?!\p{L})/iu, label: "meta:трудно определить" },
  { re: /(?<!\p{L})требует(ся)?\s+(дополнительн[аеы]\w*|уточн)/iu, label: "meta:требуется уточнение" },
];

const ALL_PATTERNS: CompiledPattern[] = [
  ...HEDGING_PATTERNS,
  ...SUGGESTION_LIKE,
  ...META_TALK,
];

/** Has digit или конкретное измеримое значение? Если да — missingness patterns ОК. */
function hasConcreteValue(text: string): boolean {
  // цифры, %, единицы измерения, явные значения
  return /\d/.test(text) || /\b(критическ|major|primary|secondary)/i.test(text);
}

interface FindingLike {
  description?: string | null;
  suggestion?: string | null;
  referenceQuote?: string | null;
  sourceRef?: unknown;
}

/**
 * Возвращает первый matched anti-pattern или null. Проверяет description +
 * suggestion + referenceQuote.
 */
export function detectAntiPattern(f: FindingLike): AntiPatternMatch | null {
  const fields: Array<{ field: AntiPatternMatch["field"]; text: string }> = [];
  if (f.description) fields.push({ field: "description", text: f.description });
  if (f.suggestion) fields.push({ field: "suggestion", text: f.suggestion });
  if (f.referenceQuote) fields.push({ field: "referenceQuote", text: f.referenceQuote });

  for (const { field, text } of fields) {
    // Plain patterns (hedging / suggestion-like / meta)
    for (const p of ALL_PATTERNS) {
      const m = text.match(p.re);
      if (m) {
        return { pattern: p.label, matchedText: m[0], field };
      }
    }
    // Missingness-without-value: фразы об отсутствии БЕЗ конкретного значения.
    // Если в тексте есть цифра/измеримое значение — это «настоящий defect», пропускаем.
    if (!hasConcreteValue(text)) {
      for (const p of MISSINGNESS_WITHOUT_VALUE) {
        const m = text.match(p.re);
        if (m) {
          return { pattern: p.label, matchedText: m[0], field };
        }
      }
    }
  }
  return null;
}

/** Список всех patterns с labels — для debug/audit/UI. */
export function listAntiPatterns(): string[] {
  return [...ALL_PATTERNS, ...MISSINGNESS_WITHOUT_VALUE].map((p) => p.label);
}
