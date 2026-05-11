import { describe, it, expect } from "vitest";
import { parseNumberingXml, NumberingState, cleanRenderedNumber } from "../numbering-parser.js";

describe("parseNumberingXml", () => {
  it("returns empty defs for missing input", () => {
    expect(parseNumberingXml(null).numIdToAbstract.size).toBe(0);
    expect(parseNumberingXml(undefined).numIdToAbstract.size).toBe(0);
    expect(parseNumberingXml("").numIdToAbstract.size).toBe(0);
  });

  it("parses a single-level abstractNum and resolves numId", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;
    const defs = parseNumberingXml(xml);
    expect(defs.numIdToAbstract.size).toBe(1);
    const abs = defs.numIdToAbstract.get(1);
    expect(abs?.levels.get(0)?.format).toBe("%1.");
    expect(abs?.levels.get(0)?.start).toBe(1);
  });

  it("parses multi-level numbering with nested format strings", () => {
    const xml = `<?xml version="1.0"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="5">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:lvlText w:val="%1."/>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:lvlText w:val="%1.%2"/>
    </w:lvl>
    <w:lvl w:ilvl="2">
      <w:start w:val="1"/>
      <w:lvlText w:val="%1.%2.%3"/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="7">
    <w:abstractNumId w:val="5"/>
  </w:num>
</w:numbering>`;
    const defs = parseNumberingXml(xml);
    const abs = defs.numIdToAbstract.get(7);
    expect(abs?.levels.size).toBe(3);
    expect(abs?.levels.get(2)?.format).toBe("%1.%2.%3");
  });
});

describe("NumberingState.next", () => {
  const xml = `<?xml version="1.0"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:lvlText w:val="%1."/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:lvlText w:val="%1.%2"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:lvlText w:val="%1.%2.%3"/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

  it("renders sequential numbers at top level", () => {
    const state = new NumberingState(parseNumberingXml(xml));
    expect(state.next(1, 0)).toBe("1.");
    expect(state.next(1, 0)).toBe("2.");
    expect(state.next(1, 0)).toBe("3.");
  });

  it("renders nested numbers and tracks parent counter", () => {
    const state = new NumberingState(parseNumberingXml(xml));
    expect(state.next(1, 0)).toBe("1.");
    expect(state.next(1, 1)).toBe("1.1");
    expect(state.next(1, 1)).toBe("1.2");
    expect(state.next(1, 2)).toBe("1.2.1");
    expect(state.next(1, 0)).toBe("2.");
    // deeper levels were reset when ilvl=0 advanced
    expect(state.next(1, 1)).toBe("2.1");
  });

  it("returns null for unknown numId", () => {
    const state = new NumberingState(parseNumberingXml(xml));
    expect(state.next(999, 0)).toBeNull();
  });

  it("returns null for unknown ilvl in known numId", () => {
    const state = new NumberingState(parseNumberingXml(xml));
    expect(state.next(1, 9)).toBeNull();
  });
});

describe("cleanRenderedNumber", () => {
  it("strips trailing dots, parens, colons, spaces", () => {
    expect(cleanRenderedNumber("1.")).toBe("1");
    expect(cleanRenderedNumber("1.2.3.")).toBe("1.2.3");
    expect(cleanRenderedNumber("1)")).toBe("1");
    expect(cleanRenderedNumber("1.2: ")).toBe("1.2");
  });

  it("preserves internal dots between levels", () => {
    expect(cleanRenderedNumber("1.2.3")).toBe("1.2.3");
  });
});
