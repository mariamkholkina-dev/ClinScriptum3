/**
 * Integration test for the LLM-fallback heading detection path in `parseDocx`.
 *
 * Builds a minimal valid DOCX (zip with `[Content_Types].xml` + `word/document.xml`)
 * that has paragraphs but NO Heading-styles and NO numbered patterns. Without
 * llmFallback the parser finds 0-1 headings; with llmFallback it returns
 * structured sections.
 */
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { parseDocx } from "../parser.js";
import type { LlmFallbackParagraph } from "../types.js";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function makeDocumentXml(paragraphs: Array<{ text: string; bold?: boolean }>): string {
  const ps = paragraphs
    .map((p) => {
      const rPr = p.bold ? "<w:rPr><w:b/></w:rPr>" : "";
      return `<w:p><w:r>${rPr}<w:t>${p.text}</w:t></w:r></w:p>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${ps}</w:body>
</w:document>`;
}

async function buildDocx(paragraphs: Array<{ text: string; bold?: boolean }>): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.folder("_rels")!.file(".rels", RELS_XML);
  zip.folder("word")!.file("document.xml", makeDocumentXml(paragraphs));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseDocx — LLM heading fallback", () => {
  it("does NOT call llmFallback when rule-based finds enough headings", async () => {
    // 25 параграфов, все жирные с bold-only fallback подхватятся (>= 20 порог)
    const paragraphs = Array.from({ length: 25 }, (_, i) => ({
      text: `Section Title ${i + 1}`,
      bold: true,
    }));
    const buffer = await buildDocx(paragraphs);

    const llmFallback = vi.fn().mockResolvedValue([]);
    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    expect(llmFallback).not.toHaveBeenCalled();
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it("calls llmFallback when rule-based finds <threshold headings", async () => {
    // 5 параграфов без bold/heading-style — rule-based не найдёт ничего
    const paragraphs = [
      { text: "Введение текста параграфа без особого форматирования." },
      { text: "Цели исследования: текст параграфа." },
      { text: "Дизайн: ещё текст." },
      { text: "Безопасность: текст без жирности." },
      { text: "Statistics: more body text." },
    ];
    const buffer = await buildDocx(paragraphs);

    const llmFallback = vi.fn().mockResolvedValue([]);
    await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    expect(llmFallback).toHaveBeenCalledTimes(1);
    const arg = llmFallback.mock.calls[0][0] as LlmFallbackParagraph[];
    expect(arg.length).toBeGreaterThanOrEqual(5);
    expect(arg.every((p) => typeof p.text === "string" && typeof p.paragraphIndex === "number"))
      .toBe(true);
  });

  it("REPLACES rule-based headings with LLM result when LLM returns more", async () => {
    const paragraphs = [
      { text: "Введение раздел." },
      { text: "Цели исследования." },
      { text: "Дизайн исследования." },
      { text: "Описание дизайна. Подробности." },
      { text: "Популяция пациентов." },
    ];
    const buffer = await buildDocx(paragraphs);

    // LLM отметит индексы 0, 1, 2, 4 как top-level headings
    const llmFallback = vi.fn().mockImplementation(async (paras: LlmFallbackParagraph[]) => {
      const targets = ["Введение раздел.", "Цели исследования.", "Дизайн исследования.", "Популяция пациентов."];
      return paras
        .filter((p) => targets.includes(p.text.trim()))
        .map((p) => ({ paragraphIndex: p.paragraphIndex, level: 1 }));
    });

    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    expect(llmFallback).toHaveBeenCalled();
    // Должно быть 4 секции, все level=1, с titles в правильном порядке
    expect(result.sections.length).toBe(4);
    expect(result.sections.map((s) => s.title)).toEqual([
      "Введение раздел.",
      "Цели исследования.",
      "Дизайн исследования.",
      "Популяция пациентов.",
    ]);
    expect(result.sections.every((s) => s.level === 1)).toBe(true);
  });

  it("KEEPS rule-based headings when LLM returns equal or fewer", async () => {
    // 5 жирных параграфов — bold-only fallback найдёт ~5 headings
    const paragraphs = Array.from({ length: 5 }, (_, i) => ({
      text: `Heading ${i + 1}`,
      bold: true,
    }));
    const buffer = await buildDocx(paragraphs);

    // LLM возвращает только 1 heading — не лучше rule-based
    const llmFallback = vi.fn().mockResolvedValue([{ paragraphIndex: 0, level: 1 }]);
    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    expect(llmFallback).toHaveBeenCalled();
    // Rule-based должно быть сохранено (5 headings, не 1)
    expect(result.sections.length).toBeGreaterThan(1);
  });

  it("FILTERS LLM hallucinated paragraphIndex (out of range)", async () => {
    const paragraphs = [
      { text: "Real paragraph 1." },
      { text: "Real paragraph 2." },
      { text: "Real paragraph 3." },
    ];
    const buffer = await buildDocx(paragraphs);

    // LLM возвращает invalid индексы — нет такой para
    const llmFallback = vi.fn().mockResolvedValue([
      { paragraphIndex: 0, level: 1 },
      { paragraphIndex: 999, level: 1 }, // hallucinated
      { paragraphIndex: 1, level: 1 },
    ]);
    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    // Должно быть 2 секции (не 3, hallucinated отфильтрован)
    expect(result.sections.length).toBe(2);
  });

  it("survives llmFallback throwing — keeps rule-based result", async () => {
    const paragraphs = [
      { text: "Body paragraph 1." },
      { text: "Body paragraph 2." },
    ];
    const buffer = await buildDocx(paragraphs);

    const llmFallback = vi.fn().mockRejectedValue(new Error("LLM connection error"));
    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    // Не падает, возвращает rule-based result (даже если 0 sections)
    expect(result).toBeDefined();
    expect(Array.isArray(result.sections)).toBe(true);
  });

  it("removes paragraphs that became headings from contentBlocks", async () => {
    const paragraphs = [
      { text: "Раздел 1." }, // станет heading
      { text: "Тело параграфа под разделом 1, с длинным текстом для контента." },
      { text: "Раздел 2." }, // станет heading
      { text: "Тело параграфа под разделом 2." },
    ];
    const buffer = await buildDocx(paragraphs);

    const llmFallback = vi.fn().mockImplementation(async (paras: LlmFallbackParagraph[]) => {
      return paras
        .filter((p) => p.text.trim().startsWith("Раздел"))
        .map((p) => ({ paragraphIndex: p.paragraphIndex, level: 1 }));
    });
    const result = await parseDocx(buffer, { llmFallback, llmFallbackThreshold: 20 });

    expect(result.sections.length).toBe(2);
    // Каждая секция должна содержать ОДИН content block (тело своего раздела),
    // и НЕ содержать "Раздел N." как content (он стал heading)
    for (const s of result.sections) {
      const blockTexts = s.contentBlocks.map((b) => b.content);
      expect(blockTexts.some((t) => t.startsWith("Раздел "))).toBe(false);
    }
  });
});
