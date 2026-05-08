import mammoth from "mammoth";
import { randomUUID } from "crypto";
import { detectHeading, type DetectedHeading } from "./heading-detector.js";
import { filterTocChildren } from "./toc-filter.js";
import { parseHtmlTable, isSOATable } from "./table-parser.js";
import { extractFootnotes } from "./footnote-extractor.js";
import JSZip from "jszip";
import { extractDrawingsFromDocumentXml, type Drawing } from "./drawing-parser.js";
import { extractTableGeometry, type TableGeometry } from "./table-geometry.js";
import { extractWordFootnotes } from "./word-footnote-parser.js";
import {
  extractParagraphProperties,
  computeBaseFontSize,
  buildPropsByText,
  fingerprint,
  type ParagraphProperties,
} from "./paragraph-properties.js";
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
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlEntry = zip.file("word/document.xml");
    if (docXmlEntry) {
      const xml = await docXmlEntry.async("text");
      drawings = extractDrawingsFromDocumentXml(xml);
      tableGeometries = extractTableGeometry(xml);
      paragraphProps = extractParagraphProperties(xml);
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

    const heading = detectHeading(
      text,
      i,
      el.style,
      undefined,
      el.isBold,
      el.fontSize,
      baseFontSize
    );

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
   * Если rule-based detection нашёл подозрительно мало headings
   * (< llmFallbackThreshold) и caller передал callback `llmFallback` —
   * вызываем его с paragraph'ами документа, REPLACE'им headings на
   * результат, и переассоциируем contentBlocks с новыми headings'ами.
   *
   * Замена (а не merge) — потому что для проблемных DOCX rule-based
   * обычно даёт мусорные headings (строки шкал, footnote-row'ы), их
   * лучше выбросить и довериться LLM. Если caller хочет merge — пусть
   * сам это сделает в callback'е (вернуть union).
   */
  const fallbackThreshold = opts.llmFallbackThreshold ?? 20;
  if (opts.llmFallback && headings.length < fallbackThreshold && fallbackParagraphs.length > 0) {
    try {
      const llmHeadings = await opts.llmFallback(fallbackParagraphs);
      if (llmHeadings.length > headings.length) {
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

        if (newHeadings.length > headings.length) {
          headings.length = 0;
          headings.push(...newHeadings);

          // Re-associate contentBlocks с новыми headings.
          // Block принадлежит heading'у с максимальным paragraphIndex ≤ block.paragraphIndex.
          for (const cb of contentBlocks) {
            const blockIdx = cb.block.sourceAnchor.paragraphIndex;
            let lastHeading: DetectedHeading | null = null;
            for (const h of headings) {
              if (h.paragraphIndex <= blockIdx) lastHeading = h;
              else break;
            }
            cb.heading = lastHeading;
          }

          // Также — paragraph'ы которые ТЕПЕРЬ headings (по LLM) но раньше
          // были contentBlocks: убрать их из contentBlocks (они стали headings,
          // не должны дублироваться как content). Detect by paragraphIndex match.
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
    });
  }

  return elements;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
