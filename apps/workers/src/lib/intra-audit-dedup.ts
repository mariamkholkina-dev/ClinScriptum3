/**
 * Дополнительная дедупликация findings, выходящая за рамки `deduplicateFindings`
 * (которая работает по description/textSnippet). Здесь группируем по
 * `(issueFamily, normalize(anchorQuote))` и оставляем одного с максимальной
 * severity. Покрывает кейс, когда LLM выдала 5 разных формулировок одной
 * проблемы в одном и том же месте.
 *
 * Sprint 4 плана улучшения качества intra-audit (failure-mode dashboard).
 */

interface MinimalFinding {
  id: string;
  issueFamily?: string | null;
  severity?: string | null;
  sourceRef: unknown;
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

export function deduplicateByFamilyAndAnchor<T extends MinimalFinding>(findings: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const f of findings) {
    const family = (f.issueFamily ?? "UNKNOWN").toUpperCase();
    const ref = (f.sourceRef ?? {}) as Record<string, unknown>;
    const anchorRaw = typeof ref.anchorQuote === "string" ? ref.anchorQuote : "";
    const anchor = normalizeText(anchorRaw);
    if (!anchor) {
      // Без anchorQuote — не группируем, оставляем как уникальный.
      groups.set(`__no_anchor__${f.id}`, [f]);
      continue;
    }
    const key = `${family}|${anchor}`;
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
