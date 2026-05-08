/**
 * Diff между фактической структурой документа и эталоном (golden sample).
 * Портирован из `apps/rule-admin/src/app/(app)/golden-dataset/[id]/parsing-viewer/utils.ts`.
 *
 * Чистая функция без UI-зависимостей. Принимает плоский список Section[] и
 * иерархический ExpectedResults (sections-tree). Возвращает три типа entries:
 *  - missing: запись есть в эталоне, но нет в документе
 *  - extra: секция есть в документе, но нет в эталоне
 *  - wrong_level: title совпал, но level отличается
 *
 * Секции с `isFalseHeading=true` исключаются из diff — каскадно скрывает их
 * из всех проверок (annotator уже пометил эти строки как «не заголовок»).
 */
import type { Section } from "./types";

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
  /** ID реальной секции в БД (для extra и wrong_level). Нужен для resolve
   *  дубликатов title — несколько секций могут иметь одинаковое название,
   *  и без id нельзя определить какая именно попала в diff. */
  actualSectionId?: string;
}

function flattenExpected(
  sections: ExpectedResults["sections"],
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
  sections: Section[],
  expectedResults: unknown,
): DiffEntry[] {
  if (!expectedResults || typeof expectedResults !== "object") return [];
  const expected = expectedResults as ExpectedResults;
  if (!Array.isArray(expected.sections)) return [];

  const realSections = sections.filter((s) => !s.isFalseHeading);

  const entries: DiffEntry[] = [];
  const flatExpected = flattenExpected(expected.sections);

  const actualByTitle = new Map<string, Section[]>();
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
