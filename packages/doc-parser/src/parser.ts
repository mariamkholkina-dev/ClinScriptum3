import mammoth from "mammoth";
import { randomUUID } from "crypto";
import { detectHeading, type DetectedHeading } from "./heading-detector.js";
import { parseHtmlTable, isSOATable } from "./table-parser.js";
import { extractFootnotes } from "./footnote-extractor.js";
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

  const elements = splitHtmlElements(html);
  const headings: DetectedHeading[] = [];
  const contentBlocks: Array<{ block: ParsedContentBlock; heading: DetectedHeading | null }> = [];
  const tables: ParsedTable[] = [];
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
      12
    );

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

  const footnotes = extractFootnotes(
    elements.map((el, idx) => ({
      text: stripHtml(el.html),
      index: idx,
      isSuperscript: el.html.includes("<sup>"),
    }))
  );

  const sections = buildSectionTree(headings, contentBlocks, opts.maxHeadingDepth);

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
    metadata: {
      totalParagraphs: String(elements.length),
      totalSections: String(countSections(sections)),
      totalTables: String(tables.length),
      totalFootnotes: String(footnotes.length),
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

function splitHtmlElements(html: string): HtmlElement[] {
  const elements: HtmlElement[] = [];
  const pattern = /<(p|h[1-6]|table|li|ol|ul)[^>]*>(.*?)<\/\1>/gis;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const innerHtml = match[0];

    const styleMatch = tag.match(/^h(\d)$/);
    const isBold = /<strong|<b[\s>]/i.test(innerHtml);

    elements.push({
      tag,
      html: innerHtml,
      style: styleMatch ? `heading ${styleMatch[1]}` : undefined,
      isBold,
    });
  }

  return elements;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
