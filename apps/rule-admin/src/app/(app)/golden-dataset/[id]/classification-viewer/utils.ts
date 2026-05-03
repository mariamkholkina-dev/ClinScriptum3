import type {
  Section,
  AnomalyType,
  DiffEntry,
  SortKey,
  FilterState,
  ExpectedClassificationResults,
} from "./types";

export { buildNumbering, detectAnomalies, getVisibleSectionIds, getParentChain, hasChildren, ANOMALY_LABELS } from "../parsing-viewer/utils";

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

  // Каскад от Парсинга: секции, помеченные как «не заголовок», игнорируем.
  const realSections = sections.filter((s) => !s.isFalseHeading);

  const entries: DiffEntry[] = [];

  // Группируем real-секции по title с сохранением порядка — для positional
  // matching при дубликатах. Без этого Map<title, Section> теряет все секции
  // кроме последней, и при дубликатах title diff показывал чужой actual.
  const realByTitle = new Map<string, Section[]>();
  for (const s of realSections) {
    const key = s.title.trim().toLowerCase();
    if (!realByTitle.has(key)) realByTitle.set(key, []);
    realByTitle.get(key)!.push(s);
  }

  // Позиционный индекс секции среди дубликатов title — для quickfix.
  const duplicateIndexById = new Map<string, number>();
  for (const list of realByTitle.values()) {
    list.forEach((s, idx) => duplicateIndexById.set(s.id, idx));
  }

  const matchedActual = new Set<string>();

  for (const exp of expected.sections) {
    const key = exp.title.trim().toLowerCase();
    const candidates = realByTitle.get(key) ?? [];
    // Берём n-ю unmatched real-секцию для positional матча.
    const actual = candidates.find((s) => !matchedActual.has(s.id));

    if (!actual) {
      entries.push({
        type: "missing",
        sectionTitle: exp.title,
        expected: { standardSection: exp.standardSection },
      });
      continue;
    }

    matchedActual.add(actual.id);

    if (exp.standardSection != null && actual.standardSection !== exp.standardSection) {
      entries.push({
        type: "wrong_section",
        sectionTitle: exp.title,
        expected: { standardSection: exp.standardSection },
        actual: { standardSection: actual.standardSection },
        actualSectionId: actual.id,
        duplicateIndex: duplicateIndexById.get(actual.id),
      });
    }
  }

  for (const s of realSections) {
    if (!matchedActual.has(s.id)) {
      entries.push({
        type: "extra",
        sectionTitle: s.title,
        actual: { standardSection: s.standardSection },
        actualSectionId: s.id,
        duplicateIndex: duplicateIndexById.get(s.id),
      });
    }
  }

  return entries;
}
