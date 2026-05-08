import { describe, it, expect } from "vitest";
import {
  extractParagraphProperties,
  computeBaseFontSize,
  fingerprint,
  buildPropsByText,
  type ParagraphProperties,
} from "../paragraph-properties.js";

const minimalDocXml = (bodyContent: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyContent}</w:body>
</w:document>`;

describe("extractParagraphProperties", () => {
  it("extracts paragraphs with no properties (defaults)", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:t>Hello world</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second line</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props).toHaveLength(2);
    expect(props[0]).toMatchObject({ paragraphIndex: 0, text: "Hello world", isBold: false });
    expect(props[1]).toMatchObject({ paragraphIndex: 1, text: "Second line", isBold: false });
    expect(props[0].fontSize).toBeUndefined();
  });

  it("extracts font size in halfpoints → pt", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>Big text</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>Normal</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].fontSize).toBe(16); // 32 / 2
    expect(props[1].fontSize).toBe(11);
  });

  it("detects bold via <w:b/> self-closing", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold heading</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].isBold).toBe(true);
  });

  it("detects bold OFF via <w:b w:val=\"0\"/>", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].isBold).toBe(false);
  });

  it("isBold=true if ≥80% of chars are bold (mixed bold/non-bold runs)", () => {
    // 10 bold chars + 1 non-bold char = 91% bold → isBold=true
    const xml = minimalDocXml(`
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t>HelloWorld</w:t></w:r>
        <w:r><w:t>!</w:t></w:r>
      </w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].text).toBe("HelloWorld!");
    expect(props[0].isBold).toBe(true);
  });

  it("isBold=false when bold runs cover <80% chars", () => {
    // 5 bold + 20 non-bold = 20% bold → isBold=false
    const xml = minimalDocXml(`
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r>
        <w:r><w:t>: this is the rest of the body text content</w:t></w:r>
      </w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].isBold).toBe(false);
  });

  it("uses MAX size across runs in paragraph", () => {
    const xml = minimalDocXml(`
      <w:p>
        <w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Small </w:t></w:r>
        <w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>BIG</w:t></w:r>
      </w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props[0].fontSize).toBe(16); // max of 10 and 16 → 16
  });

  it("walks paragraphs inside tables (recursively)", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:t>Before table</w:t></w:r></w:p>
      <w:tbl>
        <w:tr>
          <w:tc>
            <w:p><w:r><w:t>Cell paragraph</w:t></w:r></w:p>
          </w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:r><w:t>After table</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props.map((p) => p.text)).toEqual([
      "Before table",
      "Cell paragraph",
      "After table",
    ]);
    expect(props.map((p) => p.paragraphIndex)).toEqual([0, 1, 2]);
  });

  it("skips empty paragraphs", () => {
    const xml = minimalDocXml(`
      <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
      <w:p></w:p>
      <w:p><w:r><w:t>World</w:t></w:r></w:p>
    `);
    const props = extractParagraphProperties(xml);
    expect(props).toHaveLength(2);
    expect(props.map((p) => p.text)).toEqual(["Hello", "World"]);
  });

  it("returns empty array for malformed XML (no fail)", () => {
    expect(extractParagraphProperties("<not-xml>")).toEqual([]);
    expect(extractParagraphProperties("")).toEqual([]);
  });
});

describe("computeBaseFontSize", () => {
  it("returns 12 default if <5 paragraphs with fontSize", () => {
    const props: ParagraphProperties[] = [
      { paragraphIndex: 0, text: "a", fontSize: 14, isBold: false },
      { paragraphIndex: 1, text: "b", fontSize: 14, isBold: false },
    ];
    expect(computeBaseFontSize(props)).toBe(12);
  });

  it("returns median for 5+ paragraphs", () => {
    const props: ParagraphProperties[] = [
      { paragraphIndex: 0, text: "a", fontSize: 11, isBold: false },
      { paragraphIndex: 1, text: "b", fontSize: 11, isBold: false },
      { paragraphIndex: 2, text: "c", fontSize: 11, isBold: false },
      { paragraphIndex: 3, text: "d", fontSize: 14, isBold: false },
      { paragraphIndex: 4, text: "e", fontSize: 18, isBold: false },
    ];
    expect(computeBaseFontSize(props)).toBe(11);
  });

  it("ignores paragraphs without fontSize", () => {
    const props: ParagraphProperties[] = [
      { paragraphIndex: 0, text: "a", fontSize: 11, isBold: false },
      { paragraphIndex: 1, text: "b", fontSize: 11, isBold: false },
      { paragraphIndex: 2, text: "c", isBold: false },
      { paragraphIndex: 3, text: "d", isBold: false },
      { paragraphIndex: 4, text: "e", fontSize: 11, isBold: false },
      { paragraphIndex: 5, text: "f", fontSize: 11, isBold: false },
      { paragraphIndex: 6, text: "g", fontSize: 11, isBold: false },
    ];
    expect(computeBaseFontSize(props)).toBe(11);
  });
});

describe("fingerprint", () => {
  it("normalises whitespace and case, truncates to 80 chars", () => {
    expect(fingerprint("  Hello   World  ")).toBe("hello world");
    expect(fingerprint("ABC".repeat(50))).toHaveLength(80);
  });
  it("returns empty string for empty input", () => {
    expect(fingerprint("")).toBe("");
    expect(fingerprint("   ")).toBe("");
  });
});

describe("buildPropsByText", () => {
  it("collisions queued in OOXML order", () => {
    const props: ParagraphProperties[] = [
      { paragraphIndex: 0, text: "Same", fontSize: 14, isBold: false },
      { paragraphIndex: 1, text: "Different", fontSize: 11, isBold: false },
      { paragraphIndex: 2, text: "Same", fontSize: 18, isBold: true },
    ];
    const map = buildPropsByText(props);
    const sameQ = map.get("same");
    expect(sameQ).toHaveLength(2);
    expect(sameQ![0].fontSize).toBe(14);
    expect(sameQ![1].fontSize).toBe(18);
    expect(map.get("different")).toHaveLength(1);
  });
});
