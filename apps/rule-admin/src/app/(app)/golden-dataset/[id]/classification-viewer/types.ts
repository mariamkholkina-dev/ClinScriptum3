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
      секцией дерева и обновить нужную позицию в expected.sections. */
  actualSectionId?: string;
  /** Позиционный индекс среди секций с тем же title в реальном документе.
      Нужен handleQuickFix для обновления соответствующей по позиции записи
      в expected.sections (которая упорядочена тем же positional matching'ом). */
  duplicateIndex?: number;
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
