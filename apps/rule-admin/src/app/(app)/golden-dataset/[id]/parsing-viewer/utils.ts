import type {
  Section,
  AnomalyType,
  DiffEntry,
  SortKey,
  FilterState,
  ExpectedResults,
} from "./types";

export function buildNumbering(sections: Section[]): Map<string, string> {
  const result = new Map<string, string>();
  const counters: number[] = [];

  for (const s of sections) {
    const lvl = s.level ?? 0;
    while (counters.length > lvl + 1) counters.pop();
    while (counters.length < lvl + 1) counters.push(0);
    counters[lvl]++;
    for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0;

    const parts = counters.slice(0, lvl + 1).filter((v) => v > 0);
    result.set(s.id, parts.length > 0 ? parts.join(".") : String(counters[lvl]));
  }
  return result;
}

export function detectAnomalies(sections: Section[]): Map<string, AnomalyType[]> {
  const result = new Map<string, AnomalyType[]>();
  const titleCount = new Map<string, number>();
  const levelSeen = new Set<number>();

  for (const s of sections) {
    const t = s.title.trim().toLowerCase();
    titleCount.set(t, (titleCount.get(t) ?? 0) + 1);
  }

  for (const s of sections) {
    const anomalies: AnomalyType[] = [];

    if (s.contentBlocks.length === 0) anomalies.push("empty");

    if (s.level > 0 && !levelSeen.has(s.level - 1)) {
      anomalies.push("orphaned");
    }
    levelSeen.add(s.level);

    const t = s.title.trim().toLowerCase();
    if (t && (titleCount.get(t) ?? 0) > 1) anomalies.push("duplicate_title");

    if (
      s.contentBlocks.length === 1 &&
      s.contentBlocks[0].content.length < 20
    ) {
      anomalies.push("short");
    }

    if (anomalies.length > 0) result.set(s.id, anomalies);
  }
  return result;
}

export function sortSections(sections: Section[], key: SortKey): Section[] {
  const copy = [...sections];
  switch (key) {
    case "order":
      return copy.sort((a, b) => a.order - b.order);
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    case "level":
      return copy.sort((a, b) => a.level - b.level || a.order - b.order);
    case "structureStatus":
      return copy.sort((a, b) => a.structureStatus.localeCompare(b.structureStatus) || a.order - b.order);
    case "blockCount":
      return copy.sort((a, b) => b.contentBlocks.length - a.contentBlocks.length || a.order - b.order);
    default:
      return copy;
  }
}

export function filterSections(
  sections: Section[],
  filters: FilterState,
  anomalies: Map<string, AnomalyType[]>,
): Section[] {
  return sections.filter((s) => {
    if (filters.structureStatus && s.structureStatus !== filters.structureStatus) return false;
    if (filters.classificationStatus && s.classificationStatus !== filters.classificationStatus) return false;

    if (filters.level) {
      if (filters.level === "3+") {
        if (s.level < 3) return false;
      } else {
        if (s.level !== Number(filters.level) - 1) return false;
      }
    }

    if (filters.hasContent === "yes" && s.contentBlocks.length === 0) return false;
    if (filters.hasContent === "no" && s.contentBlocks.length > 0) return false;

    if (filters.anomaliesOnly && !anomalies.has(s.id)) return false;

    return true;
  });
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

  // Секции, помеченные экспертом как «не заголовок», исключаем из diff —
  // тогда они не дают ни extra, ни wrong_level. Это каскадно применяется
  // и в diff Классификации (filter там же).
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

    const exactMatch = candidates.find((c) => !matchedActual.has(c.id) && c.level === exp.level);
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
      });
    }
  }

  return entries;
}

export function getVisibleSectionIds(
  sections: Section[],
  collapsedIds: Set<string>,
): Set<string> {
  const visible = new Set<string>();
  let skipBelow = Infinity;

  for (const s of sections) {
    if (s.level > skipBelow) continue;
    skipBelow = Infinity;
    visible.add(s.id);
    if (collapsedIds.has(s.id)) {
      skipBelow = s.level;
    }
  }
  return visible;
}

export function hasChildren(section: Section, sections: Section[]): boolean {
  const idx = sections.indexOf(section);
  if (idx < 0 || idx === sections.length - 1) return false;
  return sections[idx + 1].level > section.level;
}

export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  empty: "Пустая секция",
  orphaned: "Нет родителя",
  duplicate_title: "Дубль заголовка",
  short: "Подозрительно короткая",
};
