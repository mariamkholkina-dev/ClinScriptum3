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
  contentBlocks: ContentBlock[];
}

export type AnomalyType = "empty" | "orphaned" | "duplicate_title" | "short";

export interface DiffEntry {
  type: "missing" | "extra" | "wrong_level" | "wrong_order";
  sectionTitle: string;
  expected?: { level: number; order: number };
  actual?: { level: number; order: number };
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

export interface ExpectedSection {
  title: string;
  level: number;
  order?: number;
  children?: ExpectedSection[];
}

export interface ExpectedResults {
  sections?: ExpectedSection[];
}
