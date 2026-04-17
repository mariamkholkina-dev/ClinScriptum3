import { describe, it, expect } from "vitest";
import { extractFootnotes } from "../footnote-extractor.js";

describe("extractFootnotes", () => {
  it("extracts marker-based footnotes with asterisk", () => {
    const paragraphs = [
      { text: "*: This is a footnote explaining the assessment schedule", index: 0 },
    ];
    const result = extractFootnotes(paragraphs);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].marker).toBe("*");
    expect(result[0].content).toContain("footnote");
  });

  it("extracts marker-based footnotes with dagger", () => {
    const paragraphs = [
      { text: "†. This applies to all treatment groups in the study", index: 5 },
    ];
    const result = extractFootnotes(paragraphs);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].marker).toBe("†");
  });

  it("extracts numbered footnotes", () => {
    const paragraphs = [
      { text: "1) The primary endpoint is measured at baseline and Week 24", index: 3 },
    ];
    const result = extractFootnotes(paragraphs);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].marker).toBe("1");
  });

  it("filters out short content (< 5 chars)", () => {
    const paragraphs = [
      { text: "* N/A", index: 0 },
    ];
    const result = extractFootnotes(paragraphs);
    expect(result).toHaveLength(0);
  });

  it("extracts superscript references", () => {
    const paragraphs = [
      { text: "See reference <sup>3</sup> for details", index: 2, isSuperscript: true },
    ];
    const result = extractFootnotes(paragraphs);
    const refs = result.filter((f) => f.id.startsWith("fn-ref-"));
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].marker).toBe("3");
  });

  it("extracts bracketed references", () => {
    const paragraphs = [
      { text: "As noted in [5] previously", index: 1, isSuperscript: true },
    ];
    const result = extractFootnotes(paragraphs);
    const refs = result.filter((f) => f.id.startsWith("fn-ref-"));
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].marker).toBe("5");
  });

  it("does not extract superscript references when isSuperscript is false", () => {
    const paragraphs = [
      { text: "Text with <sup>1</sup> reference", index: 0, isSuperscript: false },
    ];
    const result = extractFootnotes(paragraphs);
    const refs = result.filter((f) => f.id.startsWith("fn-ref-"));
    expect(refs).toHaveLength(0);
  });

  it("handles empty input", () => {
    const result = extractFootnotes([]);
    expect(result).toHaveLength(0);
  });

  it("assigns unique IDs to each footnote", () => {
    const paragraphs = [
      { text: "* First: This is the first footnote with enough content", index: 0 },
      { text: "† Second: This is the second footnote with enough content", index: 1 },
    ];
    const result = extractFootnotes(paragraphs);
    const ids = result.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes correct sourceAnchor", () => {
    const paragraphs = [
      { text: "*. Important footnote has source anchor info for tracking", index: 7 },
    ];
    const result = extractFootnotes(paragraphs);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].sourceAnchor.paragraphIndex).toBe(7);
  });
});
