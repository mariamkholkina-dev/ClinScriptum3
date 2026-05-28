/**
 * Дополнительная дедупликация findings, выходящая за рамки `deduplicateFindings`
 * (которая работает по description/textSnippet). Группируем по одному из трёх
 * приоритетов (в порядке предпочтения):
 *
 *   1. `extraAttributes.dedupKey` — детерминистический ключ от backend
 *      enrichFindingWithCanonical (E3). Включает canonical-значения и
 *      section_id, что покрывает кейсы где LLM описала одну причину разными
 *      словами с разными цитатами (e.g. "60 мг/кг" в одном vs "60 mg/kg"
 *      в другом — после canonicalize дают тот же canonical).
 *
 *   2. Computed key из `sourceRef` (referenceSectionId, targetSectionId)
 *      + `extraAttributes.referenceValueCanonical/targetValueCanonical`.
 *      Используется когда `dedupKey` не записан, но canonical-значения есть.
 *
 *   3. Legacy: `(issueFamily, normalize(anchorQuote))` — для findings
 *      без новых полей (v1 промты).
 *
 * Survivor — finding с максимальной severity. При равной severity — стабильно
 * по id (asc).
 *
 * Sprint 4 + E4 плана улучшения качества intra-audit.
 */

interface MinimalFinding {
  id: string;
  issueFamily?: string | null;
  issueType?: string | null;
  severity?: string | null;
  sourceRef: unknown;
  extraAttributes?: unknown;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function severityRank(s: string | null | undefined): number {
  if (!s) return 0;
  return SEVERITY_RANK[s] ?? 0;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveGroupKey(f: MinimalFinding): string {
  const family = (f.issueFamily ?? "UNKNOWN").toUpperCase();
  const ref = (f.sourceRef ?? {}) as Record<string, unknown>;
  const extra = (f.extraAttributes ?? {}) as Record<string, unknown>;

  // Приоритет 1: явный dedupKey от backend enrichFindingWithCanonical (E3).
  if (typeof extra.dedupKey === "string" && extra.dedupKey.length > 0) {
    return `${family}|DK|${extra.dedupKey}`;
  }

  // Приоритет 2: computed из (section_ids, canonical values) если есть.
  // Эквивалент buildDedupKey, но локально (без import-зависимости от E3).
  const refSection = typeof ref.referenceSectionId === "string" ? ref.referenceSectionId : null;
  const tgtSection = typeof ref.targetSectionId === "string" ? ref.targetSectionId : null;
  const refCanonical = typeof extra.referenceValueCanonical === "string" ? extra.referenceValueCanonical : null;
  const tgtCanonical = typeof extra.targetValueCanonical === "string" ? extra.targetValueCanonical : null;
  if (refCanonical || tgtCanonical) {
    const issueType = typeof f.issueType === "string" ? f.issueType : "unknown";
    const computed = `${issueType}|${refSection ?? "?"}|${tgtSection ?? "?"}|${refCanonical ?? "?"}|${tgtCanonical ?? "?"}`;
    return `${family}|CV|${computed}`;
  }

  // Приоритет 3: legacy — anchor quote.
  const anchorRaw = typeof ref.anchorQuote === "string" ? ref.anchorQuote : "";
  const anchor = normalizeText(anchorRaw);
  if (!anchor) {
    // Без anchor и без canonical — финдинг уникален, не группируется.
    return `__no_anchor__${f.id}`;
  }
  return `${family}|${anchor}`;
}

export function deduplicateByFamilyAndAnchor<T extends MinimalFinding>(findings: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const key = resolveGroupKey(f);
    const existing = groups.get(key);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(key, [f]);
    }
  }

  const result: T[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }
    // Сортируем по убыванию severity. При равной severity — детерминированно
    // по id (string compare), чтобы вывод был стабилен.
    group.sort((a, b) => {
      const ds = severityRank(b.severity) - severityRank(a.severity);
      return ds !== 0 ? ds : a.id.localeCompare(b.id);
    });
    result.push(group[0]!);
  }
  return result;
}

/** Возвращает id finding'ов, которые были отброшены как дубли (для пометки в БД). */
export function pickDuplicateIds<T extends MinimalFinding>(
  before: T[],
  after: T[],
): string[] {
  const keptIds = new Set(after.map((f) => f.id));
  return before.filter((f) => !keptIds.has(f.id)).map((f) => f.id);
}
