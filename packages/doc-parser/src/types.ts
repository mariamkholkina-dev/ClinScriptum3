import type { Drawing } from "./drawing-parser.js";
import type { TableGeometry } from "./table-geometry.js";

export interface ParsedDocument {
  title: string;
  sections: ParsedSection[];
  synopsis: ParsedSection | null;
  soaTable: ParsedTable | null;
  footnotes: ParsedFootnote[];
  /**
   * Graphic shapes (arrows, lines, brackets, images) extracted from
   * `word/document.xml`. Empty when the parser is invoked without a
   * DOCX buffer (e.g. unit tests on plain HTML). Used by SoA detection
   * to find cells that are marked by an overlaying arrow rather than
   * a text X.
   */
  drawings: Drawing[];
  /**
   * EMU geometry of every top-level `<w:tbl>` in document order. Used
   * by `mapDrawingsToCells` to decide which drawings overlay which
   * cells. Empty when the parser was called without a DOCX buffer.
   */
  tableGeometries: TableGeometry[];
  /**
   * Bodies of `<w:footnote w:id="N">` from `word/footnotes.xml`,
   * indexed by `id`. Empty when the file is missing or the parser
   * was called without a DOCX buffer.
   */
  wordFootnotes: Record<string, string>;
  metadata: Record<string, string>;
}

export interface ParsedSection {
  id: string;
  title: string;
  level: number;
  order: number;
  contentBlocks: ParsedContentBlock[];
  children: ParsedSection[];
  sourceAnchor: SourceAnchor;
  /** Иерархический номер заголовка как рендерит Word. См. DetectedHeading.headingNumber. */
  headingNumber?: string | null;
}

export interface ParsedContentBlock {
  type: ContentBlockType;
  content: string;
  rawHtml?: string;
  order: number;
  sourceAnchor: SourceAnchor;
  tableAst?: TableAst;
}

export interface TableAst {
  headers: string[];
  rows: string[][];
  footnotes: string[];
}

export type ContentBlockType = "paragraph" | "table" | "table_cell" | "footnote" | "list" | "image";

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  sourceAnchor: SourceAnchor;
  footnotes: string[];
}

export interface ParsedFootnote {
  id: string;
  marker: string;
  content: string;
  sourceAnchor: SourceAnchor;
}

export interface SourceAnchor {
  paragraphIndex: number;
  textSnippet: string;
  sectionPath?: string[];
}

/**
 * Описание элемента документа для LLM-fallback heading detection.
 * paragraphIndex — позиция в `elements` массиве parser'а (= порядок появления
 * в HTML mammoth output'е, ≈ document order).
 */
export interface LlmFallbackParagraph {
  paragraphIndex: number;
  text: string;
  isBold?: boolean;
  fontSize?: number;
}

/** Возврат LLM-fallback'а — список paragraphIndex'ов и их level'ов. */
export interface LlmDetectedHeading {
  paragraphIndex: number;
  level: number;
}

export type LlmHeadingFallback = (
  paragraphs: LlmFallbackParagraph[],
) => Promise<LlmDetectedHeading[]>;

export interface ParserOptions {
  maxHeadingDepth: number;
  detectSynopsis: boolean;
  detectSOA: boolean;
  ignoreHeadersFooters: boolean;
  /**
   * Опциональный callback. Вызывается когда rule-based heading detection
   * нашёл слишком мало "качественных" заголовков. Получает все paragraph'ы
   * документа, должен вернуть paragraphIndex+level для каждого
   * детектированного heading'а. Используется для плохо-оформленных DOCX.
   *
   * Параметры (provider, model, prompt, валидация) живут в caller'е —
   * парсер не зависит от llm-gateway.
   */
  llmFallback?: LlmHeadingFallback;
  /** Общий порог: если headings.length < threshold → fallback. Default 20. */
  llmFallbackThreshold?: number;
  /**
   * Quality-порог: считаем только headings с method ∈ {style,outline,numbered}.
   * Если qualityCount < qualityThreshold → fallback. Default 10.
   *
   * Зачем нужен: bold-only fallback ловит много "псевдо-заголовков" в плохих
   * DOCX (строки шкал типа `1 - Здоров`, `2 - Пограничное`). Они проходят как
   * headings, headings.length становится >= threshold, LLM не вызывается. Но
   * это мусор. Quality-threshold ловит этот сценарий: если у документа мало
   * структурных headings (style/outline/numbered) и в основном bold-only —
   * нужен LLM-fallback.
   */
  llmFallbackQualityThreshold?: number;
}

export const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  maxHeadingDepth: 4,
  detectSynopsis: true,
  detectSOA: true,
  ignoreHeadersFooters: true,
};
