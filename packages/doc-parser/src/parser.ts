import mammoth from "mammoth";
import { randomUUID } from "crypto";
import { detectHeading, type DetectedHeading } from "./heading-detector.js";
import { filterTocChildren } from "./toc-filter.js";
import { parseHtmlTable, isSOATable } from "./table-parser.js";
import { extractFootnotes } from "./footnote-extractor.js";
import JSZip from "jszip";
import { extractDrawingsFromDocumentXml, type Drawing } from "./drawing-parser.js";
import { decodeHtmlEntities } from "./html-entities.js";
import { extractTableGeometry, type TableGeometry } from "./table-geometry.js";
import { extractWordFootnotes } from "./word-footnote-parser.js";
import {
  extractParagraphProperties,
  computeBaseFontSize,
  buildPropsByText,
  fingerprint,
  type ParagraphProperties,
} from "./paragraph-properties.js";
import {
  parseNumberingXml,
  NumberingState,
  cleanRenderedNumber,
  type NumberingDefinitions,
} from "./numbering-parser.js";
import type {
  ParsedDocument,
  ParsedSection,
  ParsedContentBlock,
  ParsedTable,
  ParserOptions,
  SourceAnchor,
} from "./types.js";
import { DEFAULT_PARSER_OPTIONS } from "./types.js";

export async function parseDocx(
  buffer: Buffer,
  options: Partial<ParserOptions> = {}
): Promise<ParsedDocument> {
  const opts = { ...DEFAULT_PARSER_OPTIONS, ...options };

  const result = await mammoth.convertToHtml({ buffer });
  const html = result.value;

  const rawResult = await mammoth.extractRawText({ buffer });
  const rawText = rawResult.value;

  // Open the DOCX zip once for OOXML extraction. word/document.xml gives us
  // per-paragraph font-size and bold info that mammoth strips by default.
  // Эти данные нужны heading-detection'у и должны быть готовы ДО `splitHtmlElements`.
  let drawings: Drawing[] = [];
  let tableGeometries: TableGeometry[] = [];
  let wordFootnotes: Record<string, string> = {};
  let paragraphProps: ParagraphProperties[] = [];
  let numberingDefs: NumberingDefinitions = { numIdToAbstract: new Map() };
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlEntry = zip.file("word/document.xml");
    if (docXmlEntry) {
      const xml = await docXmlEntry.async("text");
      drawings = extractDrawingsFromDocumentXml(xml);
      tableGeometries = extractTableGeometry(xml);
      paragraphProps = extractParagraphProperties(xml);
    }
    const numEntry = zip.file("word/numbering.xml");
    if (numEntry) {
      const numXml = await numEntry.async("text");
      numberingDefs = parseNumberingXml(numXml);
    }
    const fnEntry = zip.file("word/footnotes.xml");
    if (fnEntry) {
      const fnXml = await fnEntry.async("text");
      const fnMap = extractWordFootnotes(fnXml);
      wordFootnotes = Object.fromEntries(fnMap);
    }
  } catch {
    // OOXML extraction is best-effort; don't fail the whole parse if
    // the buffer isn't a valid DOCX or word/document.xml is missing.
  }

  const baseFontSize = computeBaseFontSize(paragraphProps);
  const propsByText = buildPropsByText(paragraphProps);

  const elements = splitHtmlElements(html, propsByText);
  const numberingState = new NumberingState(numberingDefs);
  const headings: DetectedHeading[] = [];
  const contentBlocks: Array<{ block: ParsedContentBlock; heading: DetectedHeading | null }> = [];
  const tables: ParsedTable[] = [];
  // Список paragraph'ов для возможного LLM-fallback'а (только non-table elements
  // с непустым текстом). Собирается inline в основном loop'е.
  const fallbackParagraphs: import("./types.js").LlmFallbackParagraph[] = [];
  let soaTable: ParsedTable | null = null;
  let blockOrder = 0;

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const text = stripHtml(el.html);

    if (el.tag === "table") {
      const parsed = parseHtmlTable(el.html, i);
      tables.push(parsed);

      const prevText = i > 0 ? stripHtml(elements[i - 1].html) : "";
      if (opts.detectSOA && isSOATable(prevText, parsed.headers)) {
        soaTable = parsed;
      }

      const lastHeading = headings[headings.length - 1] ?? null;
      contentBlocks.push({
        block: {
          type: "table",
          content: parsed.headers.join(" | ") + "\n" + parsed.rows.map((r) => r.join(" | ")).join("\n"),
          rawHtml: el.html,
          order: blockOrder++,
          sourceAnchor: { paragraphIndex: i, textSnippet: text.slice(0, 80) },
          tableAst: {
            headers: parsed.headers,
            rows: parsed.rows,
            footnotes: parsed.footnotes,
          },
        },
        heading: lastHeading,
      });
      continue;
    }

    // Word auto-numbering: дёргаем counter ДО detectHeading чтобы не пропустить
    // ни один номер. Если элемент окажется heading'ом — приклеим номер ниже.
    // Inкрементим в любом случае: numId может относиться к нумерованному
    // bullet-list, и его игнорирование не повлияло бы на heading-нумерацию
    // (numbering.xml per-numId), но проще держать single sweep.
    let autoNumber: string | null = null;
    if (typeof el.numId === "number" && typeof el.ilvl === "number") {
      const rendered = numberingState.next(el.numId, el.ilvl);
      if (rendered !== null) autoNumber = cleanRenderedNumber(rendered);
    }

    const heading = detectHeading(
      text,
      i,
      el.style,
      undefined,
      el.isBold,
      el.fontSize,
      baseFontSize
    );

    if (heading) {
      // Источник 1: автоматическая нумерация Word (резолвили выше).
      // Источник 2: regex по началу title — для случая когда автор сам
      // напечатал «5.4 Заслепление». Не дублируем номер если он уже из
      // auto-numbering (auto-numbered headings обычно НЕ имеют префикса
      // в text, так что коллизии редки).
      if (autoNumber) {
        heading.headingNumber = autoNumber;
      } else {
        const manual = heading.text.match(/^(\d+(?:\.\d+)*\.?)\s+/);
        if (manual) heading.headingNumber = cleanRenderedNumber(manual[1]);
      }
    }

    // Накопить fallback-paragraph'ы для LLM (если потребуется): только
    // non-empty текстовые элементы. Tables идут в `tables`/`contentBlocks`,
    // им heading не приписываем.
    if (text.trim()) {
      fallbackParagraphs.push({
        paragraphIndex: i,
        text,
        isBold: el.isBold,
        fontSize: el.fontSize,
      });
    }

    if (heading && heading.level <= opts.maxHeadingDepth) {
      headings.push(heading);
      continue;
    }

    if (text.trim()) {
      const lastHeading = headings[headings.length - 1] ?? null;
      contentBlocks.push({
        block: {
          type: el.tag === "li" ? "list" : "paragraph",
          content: text,
          rawHtml: el.html,
          order: blockOrder++,
          sourceAnchor: { paragraphIndex: i, textSnippet: text.slice(0, 80) },
        },
        heading: lastHeading,
      });
    }
  }

  /* ───── LLM-fallback heading detection ─────
   *
   * Триггерится ДВУМЯ независимыми условиями:
   *   1. headings.length < llmFallbackThreshold (default 20) — общий low count
   *   2. qualityCount < llmFallbackQualityThreshold (default 10) — где
   *      quality = style/outline/numbered (структурные методы).
   *
   * Второй порог нужен потому что bold-only fallback в heading-detector
   * легко ловит 20+ "псевдо-headings" в плохих DOCX (строки шкал, footnote
   * rows, list items). Они проходят первый порог, но это мусор.
   * Quality-порог обеспечивает что LLM позовётся даже когда headings.length
   * большой, но СТРУКТУРНЫХ headings мало.
   *
   * REPLACE логика:
   *   - LLM result REPLACE'ит rule-based если llmHeadings.length > qualityCount.
   *     То есть LLM выигрывает у quality-headings. Если quality=0 а LLM=3 —
   *     3 > 0 → REPLACE (даже если rule-based bold-only нашёл 30 мусора).
   *   - Сравниваем с qualityCount а не headings.length — bold-only fallback
   *     не должен блокировать REPLACE на хороший LLM result.
   */
  const fallbackThreshold = opts.llmFallbackThreshold ?? 20;
  const qualityThreshold = opts.llmFallbackQualityThreshold ?? 10;
  const qualityCount = headings.filter(
    (h) => h.method === "style" || h.method === "outline" || h.method === "numbered",
  ).length;

  const shouldFallback =
    opts.llmFallback &&
    fallbackParagraphs.length > 0 &&
    (headings.length < fallbackThreshold || qualityCount < qualityThreshold);

  if (shouldFallback) {
    try {
      const llmHeadings = await opts.llmFallback!(fallbackParagraphs);
      // REPLACE если LLM result лучше чем quality-count rule-based'а.
      // Если qualityCount=0 (всё bold-only мусор) — даже LLM=3 > 0 → REPLACE.
      if (llmHeadings.length > qualityCount) {
        // Map paragraphIndex → ParagraphInfo for text lookup
        const byIdx = new Map(fallbackParagraphs.map((p) => [p.paragraphIndex, p]));
        const newHeadings: DetectedHeading[] = [];
        for (const lh of llmHeadings) {
          const para = byIdx.get(lh.paragraphIndex);
          if (!para) continue; // LLM hallucinated index
          if (lh.level < 1 || lh.level > 9) continue; // sanity
          newHeadings.push({
            text: para.text.trim(),
            level: Math.min(lh.level, opts.maxHeadingDepth),
            method: "llm" as DetectedHeading["method"],
            paragraphIndex: lh.paragraphIndex,
          });
        }
        // Sort by paragraphIndex чтобы headings шли в document order
        newHeadings.sort((a, b) => a.paragraphIndex - b.paragraphIndex);

        if (newHeadings.length > qualityCount) {
          headings.length = 0;
          headings.push(...newHeadings);

          // Re-associate contentBlocks с новыми headings.
          for (const cb of contentBlocks) {
            const blockIdx = cb.block.sourceAnchor.paragraphIndex;
            let lastHeading: DetectedHeading | null = null;
            for (const h of headings) {
              if (h.paragraphIndex <= blockIdx) lastHeading = h;
              else break;
            }
            cb.heading = lastHeading;
          }

          // Удалить paragraph'ы-ставшие-headings из contentBlocks.
          const newHeadingIdxSet = new Set(newHeadings.map((h) => h.paragraphIndex));
          const filteredCBs = contentBlocks.filter(
            (cb) => !newHeadingIdxSet.has(cb.block.sourceAnchor.paragraphIndex),
          );
          contentBlocks.length = 0;
          contentBlocks.push(...filteredCBs);
        }
      }
    } catch {
      // LLM-fallback best-effort — на ошибке оставляем rule-based result.
    }
  }

  const footnotes = extractFootnotes(
    elements.map((el, idx) => ({
      text: stripHtml(el.html),
      index: idx,
      isSuperscript: el.html.includes("<sup>"),
    }))
  );

  const filteredHeadings = filterTocChildren(
    headings,
    contentBlocks.map((b) => b.block.sourceAnchor.paragraphIndex),
  );
  const sections = buildSectionTree(filteredHeadings, contentBlocks, opts.maxHeadingDepth);

  let synopsis: ParsedSection | null = null;
  if (opts.detectSynopsis) {
    synopsis =
      findSection(sections, /synopsis/i) ??
      findSection(sections, /protocol\s+synopsis/i) ??
      null;
  }

  const title = extractTitle(rawText, headings);

  return {
    title,
    sections,
    synopsis,
    soaTable,
    footnotes,
    drawings,
    tableGeometries,
    wordFootnotes,
    metadata: {
      totalParagraphs: String(elements.length),
      totalSections: String(countSections(sections)),
      totalTables: String(tables.length),
      totalFootnotes: String(footnotes.length),
      totalDrawings: String(drawings.length),
      totalTableGeometries: String(tableGeometries.length),
      totalWordFootnotes: String(Object.keys(wordFootnotes).length),
      warnings: JSON.stringify(result.messages),
    },
  };
}

function buildSectionTree(
  headings: DetectedHeading[],
  blocks: Array<{ block: ParsedContentBlock; heading: DetectedHeading | null }>,
  _maxDepth: number
): ParsedSection[] {
  if (headings.length === 0) {
    return [
      {
        id: randomUUID(),
        title: "Document",
        level: 0,
        order: 0,
        contentBlocks: blocks.map((b) => b.block),
        children: [],
        sourceAnchor: { paragraphIndex: 0, textSnippet: "" },
      },
    ];
  }

  const sections: ParsedSection[] = [];
  const stack: ParsedSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextH = headings[i + 1];

    const sectionBlocks = blocks.filter(
      (b) =>
        b.heading === h ||
        (b.block.sourceAnchor.paragraphIndex > h.paragraphIndex &&
          (!nextH || b.block.sourceAnchor.paragraphIndex < nextH.paragraphIndex))
    );

    const section: ParsedSection = {
      id: randomUUID(),
      title: h.text,
      level: h.level,
      order: i,
      contentBlocks: sectionBlocks.map((b) => b.block),
      children: [],
      sourceAnchor: {
        paragraphIndex: h.paragraphIndex,
        textSnippet: h.text.slice(0, 80),
      },
      headingNumber: h.headingNumber ?? null,
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(section);
    } else {
      sections.push(section);
    }

    stack.push(section);
  }

  return sections;
}

function findSection(sections: ParsedSection[], pattern: RegExp): ParsedSection | undefined {
  for (const s of sections) {
    if (pattern.test(s.title)) return s;
    const child = findSection(s.children, pattern);
    if (child) return child;
  }
  return undefined;
}

function countSections(sections: ParsedSection[]): number {
  return sections.reduce((sum, s) => sum + 1 + countSections(s.children), 0);
}

function extractTitle(rawText: string, headings: DetectedHeading[]): string {
  const titleHeading = headings.find((h) => h.level === 1);
  if (titleHeading) return titleHeading.text;

  const firstLine = rawText.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim().slice(0, 200) ?? "Untitled Document";
}

interface HtmlElement {
  tag: string;
  html: string;
  style?: string;
  isBold?: boolean;
  fontSize?: number;
  numId?: number;
  ilvl?: number;
  pStyle?: string;
}

function splitHtmlElements(
  html: string,
  propsByText: Map<string, ParagraphProperties[]>,
): HtmlElement[] {
  const elements: HtmlElement[] = [];
  const pattern = /<(p|h[1-6]|table|li|ol|ul)[^>]*>(.*?)<\/\1>/gis;

  // Каждый text fingerprint → массив props в OOXML-порядке. Пройденные
  // используем consume-style: shift() при первом совпадении, чтобы при
  // повторяющемся тексте каждое HTML-вхождение получало свой OOXML-набор.
  // Передаём map by reference и модифицируем; вызывающий парсер уже не
  // переиспользует map после splitHtmlElements.

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[0];

    const styleMatch = tag.match(/^h(\d)$/);
    const htmlBold = /<strong|<b[\s>]/i.test(innerHtml);

    // Lookup OOXML props by text fingerprint — даёт нам реальный fontSize
    // (mammoth его теряет) и более точный isBold (по доле жирных символов
    // в параграфе, а не просто наличие <strong>).
    const text = stripHtml(innerHtml);
    const fp = fingerprint(text);
    let ooxmlProps: ParagraphProperties | undefined;
    if (fp) {
      const queue = propsByText.get(fp);
      if (queue && queue.length > 0) ooxmlProps = queue.shift();
    }

    // OOXML bold предпочитаем (более надёжный), HTML — fallback
    const isBold = ooxmlProps?.isBold ?? htmlBold;
    const fontSize = ooxmlProps?.fontSize;

    elements.push({
      tag,
      html: innerHtml,
      style: styleMatch ? `heading ${styleMatch[1]}` : undefined,
      isBold,
      fontSize,
      numId: ooxmlProps?.numId,
      ilvl: ooxmlProps?.ilvl,
      pStyle: ooxmlProps?.pStyle,
    });
  }

  return elements;
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}
