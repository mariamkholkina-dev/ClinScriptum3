import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractCellMarkers,
  extractFootnoteDefinitions,
  linkAnchorsToFootnotes,
  type PendingAnchor,
} from "../cell-markers.js";

describe("extractCellMarkers", () => {
  it("1. <sup>1</sup> → numeric marker, empty text", () => {
    expect(extractCellMarkers("<sup>1</sup>")).toEqual({
      cleanText: "",
      markers: ["1"],
    });
  });

  it("2. X<sup>1</sup> → cleanText X, marker 1", () => {
    expect(extractCellMarkers("X<sup>1</sup>")).toEqual({
      cleanText: "X",
      markers: ["1"],
    });
  });

  it("3. X<sup>1,2</sup> → two markers split by comma", () => {
    const result = extractCellMarkers("X<sup>1,2</sup>");
    expect(result.cleanText).toBe("X");
    expect(result.markers).toEqual(["1", "2"]);
  });

  it("4. X¹ (Unicode U+00B9) → marker 1, cleanText X", () => {
    expect(extractCellMarkers("X¹")).toEqual({
      cleanText: "X",
      markers: ["1"],
    });
  });

  it("5. X²³ (Unicode U+00B2 + U+00B3) → markers 2, 3", () => {
    expect(extractCellMarkers("X²³")).toEqual({
      cleanText: "X",
      markers: ["2", "3"],
    });
  });

  it("6. X* → symbol marker", () => {
    expect(extractCellMarkers("X*")).toEqual({
      cleanText: "X",
      markers: ["*"],
    });
  });

  it("7. 'X †' (with space) → symbol marker, cleanText trimmed", () => {
    expect(extractCellMarkers("X †")).toEqual({
      cleanText: "X",
      markers: ["†"],
    });
  });

  it("8. X (1) → parenthesised number is a marker", () => {
    expect(extractCellMarkers("X (1)")).toEqual({
      cleanText: "X",
      markers: ["1"],
    });
  });

  it("9. 'Day 1' → no markers (digit is meaningful text, not a marker)", () => {
    expect(extractCellMarkers("Day 1")).toEqual({
      cleanText: "Day 1",
      markers: [],
    });
  });

  it("10. '1' → standalone numeric cell is a footnote-only marker", () => {
    expect(extractCellMarkers("1")).toEqual({
      cleanText: "",
      markers: ["1"],
    });
  });

  it("11. '1.' → standalone numeric with trailing punctuation", () => {
    expect(extractCellMarkers("1.")).toEqual({
      cleanText: "",
      markers: ["1"],
    });
  });

  it("12. <p>X<sup>1</sup></p><p>(see fn 2)</p> → markers 1 and 2, paren stripped", () => {
    const result = extractCellMarkers(
      "<p>X<sup>1</sup></p><p>(see fn 2)</p>",
    );
    // PAREN_NUMBER_RE removes the whole parenthesised reference, not just the digit.
    expect(result.cleanText).toBe("X");
    expect(result.markers).toEqual(["1", "2"]);
  });

  it("13. &dagger; HTML entity decodes to † marker", () => {
    expect(extractCellMarkers("&dagger;")).toEqual({
      cleanText: "",
      markers: ["†"],
    });
  });

  it("14. empty input → empty result", () => {
    expect(extractCellMarkers("")).toEqual({ cleanText: "", markers: [] });
    expect(extractCellMarkers(null)).toEqual({ cleanText: "", markers: [] });
    expect(extractCellMarkers(undefined)).toEqual({
      cleanText: "",
      markers: [],
    });
  });

  it("15. Cyrillic Х¹ → cleanText Х (Cyrillic), marker 1", () => {
    expect(extractCellMarkers("Х¹")).toEqual({
      cleanText: "Х",
      markers: ["1"],
    });
  });

  it("16. <sup>a</sup> → letter marker", () => {
    expect(extractCellMarkers("<sup>a</sup>")).toEqual({
      cleanText: "",
      markers: ["a"],
    });
  });

  it("17. empty <sup></sup> → no markers", () => {
    expect(extractCellMarkers("<sup></sup>")).toEqual({
      cleanText: "",
      markers: [],
    });
  });

  it("18. number > MAX_FOOTNOTE_NUM is ignored as marker", () => {
    expect(extractCellMarkers("99")).toEqual({
      cleanText: "99",
      markers: [],
    });
  });

  it("19. multiple symbol markers in one cell", () => {
    const result = extractCellMarkers("X*†");
    expect(result.cleanText).toBe("X");
    expect(result.markers).toEqual(["*", "†"]);
  });
});

describe("extractFootnoteDefinitions", () => {
  it("1. period separator: '1. text'", () => {
    expect(
      extractFootnoteDefinitions(
        "<p>1. Performed at screening only.</p>",
      ),
    ).toEqual([{ marker: "1", text: "Performed at screening only." }]);
  });

  it("2. two paragraphs with symbol markers", () => {
    const result = extractFootnoteDefinitions(
      "<p>* Optional</p><p>† If indicated</p>",
    );
    expect(result).toEqual([
      { marker: "*", text: "Optional" },
      { marker: "†", text: "If indicated" },
    ]);
  });

  it("3. closing-paren separator: '1) text'", () => {
    expect(extractFootnoteDefinitions("<p>1) text</p>")).toEqual([
      { marker: "1", text: "text" },
    ]);
  });

  it("4. colon separator: '1: text'", () => {
    expect(extractFootnoteDefinitions("<p>1: text</p>")).toEqual([
      { marker: "1", text: "text" },
    ]);
  });

  it("5. em-dash separator: '* — по показаниям'", () => {
    expect(
      extractFootnoteDefinitions("<p>* — по показаниям</p>"),
    ).toEqual([{ marker: "*", text: "по показаниям" }]);
  });

  it("6. en-dash separator: '1 – до введения...'", () => {
    expect(
      extractFootnoteDefinitions(
        "<p>1 – до введения препарата</p>",
      ),
    ).toEqual([{ marker: "1", text: "до введения препарата" }]);
  });

  it("7. multiline paragraph with <br>", () => {
    const result = extractFootnoteDefinitions(
      "<p>1. first<br>* second</p>",
    );
    expect(result).toEqual([
      { marker: "1", text: "first" },
      { marker: "*", text: "second" },
    ]);
  });

  it("8. abbreviation glossary: 'ТЗ – телефонный звонок' → ignored", () => {
    expect(
      extractFootnoteDefinitions(
        "<p>ТЗ – телефонный звонок</p>",
      ),
    ).toEqual([]);
  });

  it("9. abbreviation with parens: 'MFI-20 (Multidimensional...) - ...' → ignored", () => {
    expect(
      extractFootnoteDefinitions(
        "<p>MFI-20 (Multidimensional Fatigue Inventory) - шкала</p>",
      ),
    ).toEqual([]);
  });

  it("10. duplicate marker → first wins, second ignored with warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = extractFootnoteDefinitions(
      "<p>1. first definition</p><p>1. second definition</p>",
    );
    expect(result).toEqual([
      { marker: "1", text: "first definition" },
    ]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("11. null/empty input → empty array", () => {
    expect(extractFootnoteDefinitions(null)).toEqual([]);
    expect(extractFootnoteDefinitions("")).toEqual([]);
  });

  it("12. paragraph without recognised marker → empty", () => {
    expect(extractFootnoteDefinitions("<p>Just some text</p>")).toEqual(
      [],
    );
  });
});

describe("linkAnchorsToFootnotes", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("creates footnotes from definitions in given order", () => {
    const anchors: PendingAnchor[] = [
      { marker: "1", targetType: "cell", rowIndex: 0, colIndex: 1 },
    ];
    const result = linkAnchorsToFootnotes(anchors, [
      { marker: "1", text: "First" },
      { marker: "*", text: "Optional" },
    ]);
    expect(result.footnotes).toEqual([
      { marker: "1", markerOrder: 0, text: "First", source: "detected" },
      { marker: "*", markerOrder: 1, text: "Optional", source: "detected" },
    ]);
  });

  it("creates orphan footnotes for anchors without matching definitions", () => {
    const anchors: PendingAnchor[] = [
      { marker: "2", targetType: "col", colIndex: 3 },
    ];
    const result = linkAnchorsToFootnotes(anchors, []);
    expect(result.footnotes).toEqual([
      { marker: "2", markerOrder: 0, text: "", source: "detected" },
    ]);
  });

  it("definitions take precedence; orphan markers come after", () => {
    const anchors: PendingAnchor[] = [
      { marker: "*", targetType: "cell", rowIndex: 1, colIndex: 1 },
      { marker: "†", targetType: "row", rowIndex: 2 },
    ];
    const result = linkAnchorsToFootnotes(anchors, [
      { marker: "*", text: "Note A" },
    ]);
    expect(result.footnotes.map((f) => f.marker)).toEqual(["*", "†"]);
    expect(result.footnotes[0].text).toBe("Note A");
    expect(result.footnotes[1].text).toBe("");
  });

  it("each anchor gets a footnoteMarker reference and confidence", () => {
    const anchors: PendingAnchor[] = [
      { marker: "1", targetType: "cell", rowIndex: 0, colIndex: 0 },
      { marker: "*", targetType: "row", rowIndex: 5 },
    ];
    const result = linkAnchorsToFootnotes(anchors, []);
    expect(result.anchors).toEqual([
      {
        marker: "1",
        targetType: "cell",
        rowIndex: 0,
        colIndex: 0,
        footnoteMarker: "1",
        confidence: 1.0,
      },
      {
        marker: "*",
        targetType: "row",
        rowIndex: 5,
        footnoteMarker: "*",
        confidence: 1.0,
      },
    ]);
  });

  it("duplicate anchor markers do not create duplicate footnotes", () => {
    const anchors: PendingAnchor[] = [
      { marker: "1", targetType: "cell", rowIndex: 0, colIndex: 1 },
      { marker: "1", targetType: "cell", rowIndex: 1, colIndex: 1 },
      { marker: "1", targetType: "row", rowIndex: 0 },
    ];
    const result = linkAnchorsToFootnotes(anchors, []);
    expect(result.footnotes).toHaveLength(1);
    expect(result.anchors).toHaveLength(3);
  });
});
