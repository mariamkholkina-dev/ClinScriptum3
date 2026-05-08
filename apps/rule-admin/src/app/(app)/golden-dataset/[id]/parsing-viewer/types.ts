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
   * - `missing`   — в эталоне есть запись, но в документе совсем нет соответствующей
   *                 секции (на этапе hybrid-anchor relink этого почти не бывает —
   *                 обычно превращается в `orphaned`). Оставлен для обратной
   *                 совместимости со старыми JSON-эталонами и legacy-логики.
   * - `orphaned`  — `ExpectedSection.realSectionId === null` после relink: эталон
   *                 существует, но парсер больше не находит соответствующую секцию.
   *                 UI предлагает «Восстановить anchor» (pin к новой) или
   *                 «Удалить из эталона».
   * - `extra`     — секция есть в документе, но не привязана ни к одному
   *                 ExpectedSection.
   * - `wrong_level` — ExpectedSection и Section связаны, но уровень не совпадает.
   * - `wrong_order` — задел на будущее, пока не используется.
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
  /** ID записи в `ExpectedSection` (для orphaned/missing/wrong_level) — нужен
      для quick-fix мутаций (delete / pin / update). */
  expectedSectionId?: string;
  /** Для orphaned — сохранённый anchor, чтобы UI мог показать paragraphIndex
      или snippet и помочь эксперту найти куда привязать заново. */
  expectedAnchor?: ExpectedAnchor;
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

/* ─── Legacy JSON expected_results (deprecated) ─────────────────────────
 * Сохранены для обратной совместимости — пока на JSON опираются другие
 * viewer'ы (classification, annotate). Новый relational endpoint —
 * `trpc.expectedSection.list` — возвращает `ExpectedSectionNode[]` ниже. */
export interface ExpectedSectionLegacy {
  title: string;
  level: number;
  order?: number;
  children?: ExpectedSectionLegacy[];
}

export interface ExpectedResults {
  sections?: ExpectedSectionLegacy[];
}

/* ─── Relational ExpectedSection (the new shape) ────────────────────────
 * Структура совпадает с возвратом `expectedSection.list` из tRPC:
 * корни верхнего уровня, дети нанизаны через `children`. */
export interface ExpectedAnchor {
  paragraphIndex?: number;
  textSnippet?: string;
  occurrenceIndex?: number;
  contentBlockDigest?: string;
}

export interface ExpectedSectionNode {
  id: string;
  goldenSampleStageStatusId: string;
  parentId: string | null;
  order: number;
  title: string;
  level: number;
  anchor: ExpectedAnchor | null;
  standardSection: string | null;
  /** `null` => orphaned (relink не нашёл живую секцию). */
  realSectionId: string | null;
  matchMethod: "paragraph" | "digest" | "snippet" | "title_occurrence" | null;
  matchedAt: Date | string | null;
  children: ExpectedSectionNode[];
}
