/**
 * Типы для парсинг-панели Word add-in. Соответствуют тому, что возвращает
 * `document.getVersion` (см. apps/api/src/services/document.service.ts).
 *
 * Намеренно дублируем shape из apps/rule-admin parsing-viewer/types.ts
 * — у word-addin нет доступа к tRPC-router-типам (нет AppRouter import),
 * вместо этого используем `trpcCall<T>(...)` с явной типизацией ответа.
 */

export interface ContentBlock {
  id: string;
  type: "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";
  content: string;
  rawHtml: string | null;
  order: number;
}

export type SectionStatus = "validated" | "not_validated" | "requires_rework";

export interface Section {
  id: string;
  title: string;
  standardSection: string | null;
  confidence: number | null;
  classifiedBy: string | null;
  level: number;
  order: number;
  structureStatus: SectionStatus;
  classificationStatus: SectionStatus;
  structureComment?: string | null;
  classificationComment?: string | null;
  isFalseHeading: boolean;
  isManual?: boolean;
  manualCreatedById?: string | null;
  sourceAnchor?: { paragraphIndex?: number; textSnippet?: string; contentBlockId?: string };
  contentBlocks: ContentBlock[];
}

export interface DocumentVersionResponse {
  id: string;
  versionNumber: number;
  versionLabel: string | null;
  status: string;
  document: {
    id: string;
    studyId: string;
    type: string;
    title: string;
    study: { id: string; title: string; tenantId: string };
  };
  sections: Section[];
}
