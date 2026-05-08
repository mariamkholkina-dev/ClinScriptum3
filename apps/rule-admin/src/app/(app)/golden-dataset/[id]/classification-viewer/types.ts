export interface ContentBlock {
  id: string;
  type: "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";
  content: string;
  rawHtml: string | null;
  order: number;
}

export interface Section {
  id: string;
  title: string;
  standardSection: string | null;
  confidence: number | null;
  classifiedBy: string | null;
  algoSection: string | null;
  algoConfidence: number | null;
  llmSection: string | null;
  llmConfidence: number | null;
  level: number;
  order: number;
  structureStatus: "validated" | "not_validated" | "requires_rework";
  classificationStatus: "validated" | "not_validated" | "requires_rework";
  classificationComment: string | null;
  isFalseHeading: boolean;
  contentBlocks: ContentBlock[];
}

export type AnomalyType = "empty" | "orphaned" | "duplicate_title" | "short";

export interface DiffEntry {
  type: "missing" | "extra" | "wrong_section";
  sectionTitle: string;
  expected?: { standardSection: string | null };
  actual?: { standardSection: string | null };
  /** ID реальной секции для extra/wrong_section. Используется для resolve
      дубликатов title — когда несколько секций имеют одинаковое название,
      без id невозможно однозначно сопоставить запись overlay с конкретной
      секцией дерева. */
  actualSectionId?: string;
  /** Позиционный индекс среди секций с тем же title в реальном документе.
      Сохраняется в legacy diff (по JSON expectedResults) и в relational diff
      для дидактически совместимого UX — использует `n-я real-секция → n-я ожидаемая
      секция с тем же title». */
  duplicateIndex?: number;
  /** ID ExpectedSection — заполнен для diff на основе relational expected_sections.
      Используется handleQuickFix для прямого update/delete без поиска по title. */
  expectedSectionId?: string;
}

/** Узел relational ExpectedSection (как возвращает trpc.expectedSection.list). */
export interface ExpectedSectionNode {
  id: string;
  goldenSampleStageStatusId: string;
  parentId: string | null;
  title: string;
  level: number;
  standardSection: string | null;
  order: number;
  realSectionId: string | null;
  matchMethod: string | null;
  /** Hybrid anchor — JSON, не используется напрямую в UI. */
  anchor: unknown;
  children?: ExpectedSectionNode[];
}

export type SortKey =
  | "order"
  | "title"
  | "level"
  | "classificationStatus"
  | "confidence"
  | "algoSection"
  | "llmSection";

export interface FilterState {
  classificationStatus: "" | "validated" | "not_validated" | "requires_rework";
  level: "" | "1" | "2" | "3+";
  hasContent: "" | "yes" | "no";
  anomaliesOnly: boolean;
  disagreement: boolean;
  agreement: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  classificationStatus: "",
  level: "",
  hasContent: "",
  anomaliesOnly: false,
  disagreement: false,
  agreement: false,
};

export interface ExpectedClassificationSection {
  title: string;
  standardSection: string | null;
  confidence?: number;
}

export interface ExpectedClassificationResults {
  sections?: ExpectedClassificationSection[];
}

export interface TaxonomyEntry {
  name: string;
  pattern: string;
  config: {
    type: "zone" | "subzone";
    key: string;
    parentZone?: string;
    canonicalZone: string;
    titleRu: string;
    patterns: string[];
    requirePatterns: string[];
    notKeywords: string[];
  };
}
