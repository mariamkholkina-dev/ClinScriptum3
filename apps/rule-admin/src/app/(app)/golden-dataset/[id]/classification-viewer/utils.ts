import type {
  Section,
  AnomalyType,
  DiffEntry,
  SortKey,
  FilterState,
  ExpectedClassificationResults,
} from "./types";

export { buildNumbering, detectAnomalies, getVisibleSectionIds, hasChildren, ANOMALY_LABELS } from "../parsing-viewer/utils";

export function sortSections(sections: Section[], key: SortKey): Section[] {
  const copy = [...sections];
  switch (key) {
    case "order":
      return copy.sort((a, b) => a.order - b.order);
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "ru"));
    case "level":
      return copy.sort((a, b) => a.level - b.level || a.order - b.order);
    case "classificationStatus":
      return copy.sort((a, b) => a.classificationStatus.localeCompare(b.classificationStatus) || a.order - b.order);
    case "confidence":
      return copy.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.order - b.order);
    case "algoSection":
      return copy.sort((a, b) => (a.algoSection ?? "").localeCompare(b.algoSection ?? "") || a.order - b.order);
    case "llmSection":
      return copy.sort((a, b) => (a.llmSection ?? "").localeCompare(b.llmSection ?? "") || a.order - b.order);
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

    if (filters.disagreement) {
      if (s.algoSection === s.llmSection) return false;
    }

    if (filters.agreement) {
      const algo = s.algoSection ?? null;
      const llm = s.llmSection ?? null;
      const final = s.standardSection ?? null;
      if (!(algo != null && algo === llm && algo === final)) return false;
    }

    return true;
  });
}

export function diffClassificationWithExpected(
  sections: Section[],
  expectedResults: unknown,
): DiffEntry[] {
  if (!expectedResults || typeof expectedResults !== "object") return [];
  const expected = expectedResults as ExpectedClassificationResults;
  if (!Array.isArray(expected.sections)) return [];

  const entries: DiffEntry[] = [];

  // Multimap: title → list of actual sections (в порядке появления в документе).
  // Раньше Map<title, Section> хранил ТОЛЬКО последнюю — для документов с
  // дубликатами заголовков (typical в clinical protocols, например подписи
  // Совет по этике на разных уровнях иерархии) extra-entry для первого
  // дубликата никогда не исчезала после quick-fix.
  const actualByTitle = new Map<string, Section[]>();
  for (const s of sections) {
    const key = s.title.trim().toLowerCase();
    const arr = actualByTitle.get(key) ?? [];
    arr.push(s);
    actualByTitle.set(key, arr);
  }

  // Распределяем expected-записи по actual в порядке появления:
  // первая expected с title T → bucket[0], вторая → bucket[1], и т.д.
  // Если expected больше чем actual в bucket — оставшиеся expected = missing.
  // Если actual больше чем expected — оставшиеся actual = extra.
  const matchedActual = new Set<string>();
  const usedFromBucket = new Map<string, number>();

  for (const exp of expected.sections) {
    const key = exp.title.trim().toLowerCase();
    const bucket = actualByTitle.get(key) ?? [];
    const usedSoFar = usedFromBucket.get(key) ?? 0;

    if (usedSoFar >= bucket.length) {
      entries.push({
        type: "missing",
        sectionTitle: exp.title,
        expected: { standardSection: exp.standardSection },
      });
      continue;
    }

    const actual = bucket[usedSoFar];
    usedFromBucket.set(key, usedSoFar + 1);
    matchedActual.add(actual.id);

    if (exp.standardSection != null && actual.standardSection !== exp.standardSection) {
      entries.push({
        type: "wrong_section",
        sectionTitle: exp.title,
        expected: { standardSection: exp.standardSection },
        actual: { standardSection: actual.standardSection },
      });
    }
  }

  for (const s of sections) {
    if (!matchedActual.has(s.id)) {
      entries.push({
        type: "extra",
        sectionTitle: s.title,
        actual: { standardSection: s.standardSection },
      });
    }
  }

  return entries;
}
