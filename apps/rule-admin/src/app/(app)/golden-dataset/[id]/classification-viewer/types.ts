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
  contentBlocks: ContentBlock[];
}

export type AnomalyType = "empty" | "orphaned" | "duplicate_title" | "short";

export interface DiffEntry {
  type: "missing" | "extra" | "wrong_section";
  sectionTitle: string;
  expected?: { standardSection: string | null };
  actual?: { standardSection: string | null };
  /** Абсолютный индекс в expected.sections — для wrong_section и missing.
      Нужен чтобы quick-fix обновлял ИМЕННО ту запись, на которую matched
      этот entry (важно при дубликатах title в expected). */
  expectedIndex?: number;
  /** ID actual-секции — для wrong_section и extra. Нужен чтобы quick-fix
      менял Section.standardSection ИМЕННО для нужной секции (важно при
      дубликатах title в реальном документе). */
  actualSectionId?: string;
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
