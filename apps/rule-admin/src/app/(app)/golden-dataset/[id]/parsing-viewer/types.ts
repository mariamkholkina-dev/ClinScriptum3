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
  level: number;
  order: number;
  structureStatus: "validated" | "not_validated" | "requires_rework";
  classificationStatus: "validated" | "not_validated" | "requires_rework";
  structureComment?: string | null;
  classificationComment?: string | null;
  isFalseHeading: boolean;
  isManual?: boolean;
  manualCreatedById?: string | null;
  sourceAnchor?: { paragraphIndex?: number; textSnippet?: string; contentBlockId?: string };
  contentBlocks: ContentBlock[];
}

export type AnomalyType = "empty" | "orphaned" | "duplicate_title" | "short";

export interface DiffEntry {
  /**
   * `orphaned` появляется только при relational diff (PR E):
   * запись в эталоне есть, но `realSectionId === null` после re-parse —
   * автомэтч не нашёл подходящей секции в новом дереве, нужно re-pin'нуть.
   */
  type: "missing" | "extra" | "wrong_level" | "wrong_order" | "orphaned";
  sectionTitle: string;
  expected?: { level: number; order: number };
  actual?: { level: number; order: number };
  /** ID реальной секции в БД (для extra и wrong_level). Используется
      для resolve дубликатов title — несколько секций могут иметь
      одинаковое название, и без id нельзя определить какая именно
      попала в diff. */
  actualSectionId?: string;
  /** ID `ExpectedSection` в БД (для wrong_level, missing, orphaned).
      Нужен для прицельного update / delete / pin без поиска по title. */
  expectedSectionId?: string;
}

export type SortKey = "order" | "title" | "level" | "structureStatus" | "blockCount";

export interface FilterState {
  structureStatus: "" | "validated" | "not_validated" | "requires_rework";
  classificationStatus: "" | "validated" | "not_validated" | "requires_rework";
  level: "" | "1" | "2" | "3+";
  hasContent: "" | "yes" | "no";
  anomaliesOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  structureStatus: "",
  classificationStatus: "",
  level: "",
  hasContent: "",
  anomaliesOnly: false,
};

/** @deprecated Старая JSON-форма. Используется только в legacy `diffWithExpected`
    (classification-viewer / annotate page до миграции). Новая relational-форма —
    `ExpectedSectionNode`. */
export interface ExpectedSection {
  title: string;
  level: number;
  order?: number;
  children?: ExpectedSection[];
}

/** @deprecated См. `ExpectedSection`. */
export interface ExpectedResults {
  sections?: ExpectedSection[];
}

/**
 * Relational expected section (PR #92 + PR E). Дерево, где каждый узел —
 * запись в БД (`ExpectedSection`) с anchor'ом и опциональной привязкой к
 * реальной секции (`realSectionId`). Когда `realSectionId === null` после
 * re-parse — это «orphaned» (anchor не нашёл подходящей секции).
 */
export interface ExpectedAnchor {
  paragraphIndex?: number;
  textSnippet?: string;
  occurrenceIndex?: number;
  contentBlockDigest?: string;
}

export interface ExpectedSectionNode {
  id: string;
  title: string;
  level: number;
  standardSection: string | null;
  anchor: ExpectedAnchor;
  realSectionId: string | null;
  matchMethod: string | null;
  parentId: string | null;
  order: number;
  children: ExpectedSectionNode[];
}
