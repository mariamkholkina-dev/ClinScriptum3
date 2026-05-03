import { describe, it, expect } from "vitest";
import { extractWordFootnotes } from "../word-footnote-parser.js";

const FOOTNOTES_XML_HEADER =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">';

describe("extractWordFootnotes", () => {
  it("extracts simple text footnote by id", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Performed at screening only.</w:t></w:r></w:p></w:footnote>' +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.get("1")).toBe("Performed at screening only.");
    expect(map.size).toBe(1);
  });

  it("skips separator footnotes (id=-1, id=0, w:type='separator')", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:t>SEP</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="0" w:type="continuationSeparator"><w:p><w:r><w:t>CONT</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:t>Real footnote.</w:t></w:r></w:p></w:footnote>' +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.has("-1")).toBe(false);
    expect(map.has("0")).toBe(false);
    expect(map.get("1")).toBe("Real footnote.");
  });

  it("concatenates multi-run text across w:r boundaries", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="2"><w:p>' +
      '<w:r><w:t>Before introduction</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> of the drug.</w:t></w:r>' +
      "</w:p></w:footnote>" +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.get("2")).toBe("Before introduction of the drug.");
  });

  it("returns empty map on malformed XML", () => {
    expect(extractWordFootnotes("<<<not xml>>>").size).toBe(0);
    expect(extractWordFootnotes("").size).toBe(0);
  });

  it("preserves Cyrillic text", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="3"><w:p><w:r><w:t>До введения исследуемого препарата</w:t></w:r></w:p></w:footnote>' +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.get("3")).toBe("До введения исследуемого препарата");
  });

  it("ignores empty footnote bodies", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="4"><w:p></w:p></w:footnote>' +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.has("4")).toBe(false);
  });

  it("survives multi-paragraph footnote body", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="5">' +
      '<w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>' +
      "</w:footnote>" +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    const v = map.get("5");
    expect(v).toContain("First paragraph.");
    expect(v).toContain("Second paragraph.");
  });

  it("handles a list of footnotes in document order", () => {
    const xml =
      FOOTNOTES_XML_HEADER +
      '<w:footnote w:id="1"><w:p><w:r><w:t>A</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="2"><w:p><w:r><w:t>B</w:t></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="3"><w:p><w:r><w:t>C</w:t></w:r></w:p></w:footnote>' +
      "</w:footnotes>";
    const map = extractWordFootnotes(xml);
    expect(map.size).toBe(3);
    expect(map.get("1")).toBe("A");
    expect(map.get("2")).toBe("B");
    expect(map.get("3")).toBe("C");
  });
});
