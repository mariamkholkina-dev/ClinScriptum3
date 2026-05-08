/**
 * Сравнение реальной структуры секций с эталоном (`expected_results.sections`).
 *
 * Порт логики из `apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/utils.ts`.
 * В word-addin нет доступа к rule-admin, поэтому типы дублируются локально —
 * как и `Section`/`DocumentVersionResponse` в `./types.ts`.
 *
 * Алгоритм:
 *  1. Секции с `isFalseHeading=true` исключаем (то же поведение, что в rule-admin).
 *  2. Уплощаем дерево `expected.sections` (учитываем `children`).
 *  3. Группируем реальные секции по lowercase(title).
 *  4. Для каждой ожидаемой:
 *     - нет ни одной реальной с таким title → `missing`.
 *     - есть, level совпадает → match (нет diff).
 *     - есть, level отличается → `wrong_level`.
 *  5. Реальные секции, не сматченные ни с одной ожидаемой → `extra`.
 */

export interface ExpectedSection {
  title: string;
  level: number;
  order?: number;
  children?: ExpectedSection[];
}

export interface ExpectedResults {
  sections?: ExpectedSection[];
}

export interface DiffEntry {
  type: "missing" | "extra" | "wrong_level";
  sectionTitle: string;
  expected?: { level: number; order: number };
  actual?: { level: number; order: number };
  /** ID реальной секции в БД (для extra и wrong_level). Нужен чтобы
   *  отличить дубликаты title и для quick-fix actions. */
  actualSectionId?: string;
}

/** Минимальный shape реальной секции, нужный для diff. Определён локально,
 *  чтобы модуль был независимым. На практике сюда попадает `Section` из ./types.ts. */
interface SectionLike {
  id: string;
  title: string;
  level: number;
  order: number;
  isFalseHeading: boolean;
}

function flattenExpected(
  sections: ExpectedSection[] | undefined,
  parentLevel = 0,
): Array<{ title: string; level: number }> {
  if (!sections) return [];
  const result: Array<{ title: string; level: number }> = [];
  for (const s of sections) {
    result.push({ title: s.title, level: s.level ?? parentLevel });
    if (s.children) {
      result.push(...flattenExpected(s.children, (s.level ?? parentLevel) + 1));
    }
  }
  return result;
}

export function diffWithExpected(
  sections: SectionLike[],
  expectedResults: unknown,
): DiffEntry[] {
  if (!expectedResults || typeof expectedResults !== "object") return [];
  const expected = expectedResults as ExpectedResults;
  if (!Array.isArray(expected.sections)) return [];

  const realSections = sections.filter((s) => !s.isFalseHeading);

  const entries: DiffEntry[] = [];
  const flatExpected = flattenExpected(expected.sections);

  const actualByTitle = new Map<string, SectionLike[]>();
  for (const s of realSections) {
    const key = s.title.trim().toLowerCase();
    if (!actualByTitle.has(key)) actualByTitle.set(key, []);
    actualByTitle.get(key)!.push(s);
  }

  const matchedActual = new Set<string>();

  for (const exp of flatExpected) {
    const key = exp.title.trim().toLowerCase();
    const candidates = actualByTitle.get(key);
    if (!candidates || candidates.length === 0) {
      entries.push({
        type: "missing",
        sectionTitle: exp.title,
        expected: { level: exp.level, order: 0 },
      });
      continue;
    }

    const exactMatch = candidates.find(
      (c) => !matchedActual.has(c.id) && c.level === exp.level,
    );
    const anyMatch = exactMatch ?? candidates.find((c) => !matchedActual.has(c.id));

    if (!anyMatch) {
      entries.push({
        type: "missing",
        sectionTitle: exp.title,
        expected: { level: exp.level, order: 0 },
      });
    } else {
      matchedActual.add(anyMatch.id);
      if (anyMatch.level !== exp.level) {
        entries.push({
          type: "wrong_level",
          sectionTitle: exp.title,
          expected: { level: exp.level, order: 0 },
          actual: { level: anyMatch.level, order: anyMatch.order },
          actualSectionId: anyMatch.id,
        });
      }
    }
  }

  for (const s of realSections) {
    if (!matchedActual.has(s.id)) {
      entries.push({
        type: "extra",
        sectionTitle: s.title,
        actual: { level: s.level, order: s.order },
        actualSectionId: s.id,
      });
    }
  }

  return entries;
}
